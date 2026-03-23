<?php

/**
 * Kafka Consumer → Solr Indexer
 * Reads from Kafka topic and pushes to Solr in batches
 * Features: DLQ, deduplication, partial updates, schema inference
 *
 * Usage: php consumer.php
 */

require_once __DIR__ . '/vendor/autoload.php';

use Monolog\Logger;
use Monolog\Handler\StreamHandler;

// ── Logger ────────────────────────────────────────────────────────────────────
$log = new Logger('consumer');
$log->pushHandler(new StreamHandler('php://stdout', Logger::DEBUG));

// ── Config ────────────────────────────────────────────────────────────────────
$kafkaBroker = getenv('KAFKA_BROKER') ?: '127.0.0.1:9092';
$topic       = getenv('KAFKA_TOPIC')  ?: 'solr-data';
$dlqTopic    = $topic . '-dlq';
$solrUrl     = getenv('SOLR_URL')     ?: 'http://localhost:8983/solr/csvcore';
$groupId     = getenv('KAFKA_GROUP')  ?: 'solr-indexer-group';
$batchSize   = (int)(getenv('BATCH_SIZE') ?: 1000);
$commitWithin = (int)(getenv('COMMIT_WITHIN') ?: 5000);

$log->info("🚀 Consumer starting", [
    'broker'  => $kafkaBroker,
    'topic'   => $topic,
    'group'   => $groupId,
    'solr'    => $solrUrl,
    'batch'   => $batchSize,
]);

// ── Kafka Consumer Config ─────────────────────────────────────────────────────
$conf = new RdKafka\Conf();
$conf->set('metadata.broker.list', $kafkaBroker);
$conf->set('group.id', $groupId);
$conf->set('auto.offset.reset', 'earliest');
$conf->set('enable.auto.commit', 'false');       // Manual commit after successful Solr index
$conf->set('session.timeout.ms', '30000');
$conf->set('max.poll.interval.ms', '300000');
$conf->set('socket.timeout.ms', '60000');
$conf->set('fetch.wait.max.ms', '500');

$conf->setErrorCb(function ($kafka, $err, $reason) use ($log) {
    $log->error("Kafka error: $reason", ['code' => $err]);
});

$conf->setRebalanceCb(function (RdKafka\KafkaConsumer $kafka, $err, array $partitions = null) use ($log) {
    switch ($err) {
        case RD_KAFKA_RESP_ERR__ASSIGN_PARTITIONS:
            $log->info("✅ Partition assigned", ['count' => count($partitions ?? [])]);
            $kafka->assign($partitions);
            break;
        case RD_KAFKA_RESP_ERR__REVOKE_PARTITIONS:
            $log->info("⚠️  Partition revoked");
            $kafka->assign(null);
            break;
        default:
            $log->error("Rebalance error: $err");
            break;
    }
});

// ── Setup Consumer ────────────────────────────────────────────────────────────
$consumer = new RdKafka\KafkaConsumer($conf);
$consumer->subscribe([$topic]);

// ── DLQ Producer ─────────────────────────────────────────────────────────────
$dlqConf = new RdKafka\Conf();
$dlqConf->set('metadata.broker.list', $kafkaBroker);
$dlqProducer = new RdKafka\Producer($dlqConf);
$dlqKafkaTopic = $dlqProducer->newTopic($dlqTopic);

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSolrSuffix(mixed $value): string
{
    if (is_int($value))   return '_i';
    if (is_float($value)) return '_f';
    if (is_bool($value))  return '_b';
    if (is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}T/', $value)) return '_dt';
    return '_s';
}

function sanitizeKey(string $key): string
{
    $key = preg_replace('/[^a-zA-Z0-9_]/', '_', $key);
    $key = preg_replace('/_+/', '_', $key);
    return trim($key, '_');
}

function buildSolrDoc(array $data): array
{
    $doc = [];

    foreach ($data as $rawKey => $value) {
        $cleanKey  = sanitizeKey((string)$rawKey);
        $cleanValue = ($value === null) ? '' : $value;

        // Special reserved fields
        if (in_array($cleanKey, ['source_file', '_source_file'])) {
            $doc['source_file_s'] = $cleanValue;
            continue;
        }
        if ($cleanKey === 'ingested_at' || $cleanKey === '_ingested_at') {
            $doc['ingested_at_dt'] = $cleanValue;
            continue;
        }
        if ($cleanKey === 'id') {
            // stored separately
            continue;
        }

        $suffix = getSolrSuffix($value);
        
        // Force _dt for date-related fields even if they are strings
        $isDateField = preg_match('/(date|price_change|violation_time)/i', $cleanKey);
        if ($isDateField && $suffix === '_s' && preg_match('/^\d{4}-\d{2}-\d{2}T/', (string)$value)) {
            $suffix = '_dt';
        }

        $doc[$cleanKey . $suffix] = $cleanValue;
    }

    // Build stable ID for deduplication
    $productId = $data['product_id'] ?? $data['id'] ?? null;
    $sourceFile = $data['_source_file'] ?? $data['source_file'] ?? 'unknown';
    $doc['id'] = 'doc_' . md5($sourceFile . '_' . ($productId ?? uniqid()));

    return $doc;
}

function sendBatchToSolr(array $batch, string $solrUrl, int $commitWithin, Logger $log): bool
{
    if (empty($batch)) return true;

    $url = "$solrUrl/update/json/docs?commitWithin=$commitWithin&overwrite=true";

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => $url,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($batch, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if ($curlErr) {
        $log->error("cURL error: $curlErr");
        return false;
    }
    if ($httpCode !== 200) {
        $log->error("Solr error HTTP $httpCode", ['response' => substr($response, 0, 300)]);
        return false;
    }

    $log->info("✅ Indexed batch", ['docs' => count($batch)]);
    return true;
}

function sendToDlq(RdKafka\Producer $dlqProducer, mixed $dlqTopic, string $payload, string $reason, Logger $log): void
{
    $wrapper = json_encode([
        'original_payload' => $payload,
        'error_reason'     => $reason,
        'failed_at'        => date('c'),
    ]);
    $dlqTopic->produce(RD_KAFKA_PARTITION_UA, 0, $wrapper);
    $dlqProducer->flush(5000);
    $log->warning("📤 Sent to DLQ: $reason");
}

// ── Main Consume Loop ─────────────────────────────────────────────────────────
$batch         = [];
$totalIndexed  = 0;
$totalErrors   = 0;
$msgBuffer     = [];    // Keep messages for commit after success

$log->info("🎧 Listening for messages...");

while (true) {
    $message = $consumer->consume(3000);

    switch ($message->err) {
        case RD_KAFKA_RESP_ERR_NO_ERROR:
            $payload = $message->payload;

            $data = json_decode($payload, true);

            if (!$data || !is_array($data)) {
                $log->warning("Invalid JSON payload, sending to DLQ");
                sendToDlq($dlqProducer, $dlqKafkaTopic, $payload, 'invalid_json', $log);
                $consumer->commitAsync($message);
                $totalErrors++;
                break;
            }

            try {
                $doc = buildSolrDoc($data);
                $batch[]    = $doc;
                $msgBuffer[] = $message;
            } catch (Throwable $e) {
                $log->error("Doc build failed: " . $e->getMessage());
                sendToDlq($dlqProducer, $dlqKafkaTopic, $payload, $e->getMessage(), $log);
                $totalErrors++;
                break;
            }

            if (count($batch) >= $batchSize) {
                $success = sendBatchToSolr($batch, $solrUrl, $commitWithin, $log);
                if ($success) {
                    // Commit all offsets in this batch
                    foreach ($msgBuffer as $msg) {
                        $consumer->commitAsync($msg);
                    }
                    $totalIndexed += count($batch);
                    $log->info("📦 Total indexed: $totalIndexed");

                    // Update ingestion status
                    $statusFile = __DIR__ . '/storage/ingestion_status.json';
                    if (file_exists($statusFile)) {
                        $status = json_decode(file_get_contents($statusFile), true);
                        $status['indexed_rows'] = $totalIndexed;
                        $status['status'] = ($status['total_rows'] > 0 && $totalIndexed >= $status['total_rows']) ? 'completed' : 'indexing';
                        file_put_contents($statusFile, json_encode($status));
                    }
                } else {
                    // Send entire batch to DLQ on failure
                    foreach ($batch as $doc) {
                        sendToDlq($dlqProducer, $dlqKafkaTopic, json_encode($doc), 'solr_batch_failure', $log);
                    }
                    $totalErrors += count($batch);
                    
                    // Update status with error
                    $statusFile = __DIR__ . '/storage/ingestion_status.json';
                    if (file_exists($statusFile)) {
                        $status = json_decode(file_get_contents($statusFile), true);
                        $status['status'] = 'error';
                        $status['error']  = "Failed to index a batch of " . count($batch) . " rows.";
                        file_put_contents($statusFile, json_encode($status));
                    }
                }
                $batch     = [];
                $msgBuffer = [];
            }
            break;

        case RD_KAFKA_RESP_ERR__PARTITION_EOF:
            // Flush remaining batch on EOF
            if (!empty($batch)) {
                $success = sendBatchToSolr($batch, $solrUrl, $commitWithin, $log);
                if ($success) {
                    foreach ($msgBuffer as $msg) {
                        $consumer->commitAsync($msg);
                    }
                    $totalIndexed += count($batch);
                    $log->info("📦 Final flush: $totalIndexed total");

                    // Update final ingestion status
                    $statusFile = __DIR__ . '/storage/ingestion_status.json';
                    if (file_exists($statusFile)) {
                        $status = json_decode(file_get_contents($statusFile), true);
                        $status['indexed_rows'] = $totalIndexed;
                        $status['status'] = 'completed';
                        file_put_contents($statusFile, json_encode($status));
                    }
                }
                $batch     = [];
                $msgBuffer = [];
            }
            $log->debug("Partition EOF — waiting for new messages...");
            break;

        case RD_KAFKA_RESP_ERR__TIMED_OUT:
            // Flush pending batch on timeout too
            if (!empty($batch)) {
                $log->info("⏰ Timeout flush", ['pending' => count($batch)]);
                $success = sendBatchToSolr($batch, $solrUrl, $commitWithin, $log);
                if ($success) {
                    foreach ($msgBuffer as $msg) {
                        $consumer->commitAsync($msg);
                    }
                    $totalIndexed += count($batch);
                }
                $batch     = [];
                $msgBuffer = [];
            }
            break;

        default:
            $log->error("Kafka error: " . $message->errstr(), ['code' => $message->err]);
            break;
    }
}
