<?php

/**
 * Kafka Producer — CSV → Kafka
 * Reads all CSV files from ./csv/ and sends to Kafka topic
 *
 * Usage: php producer.php [csv_folder]
 */

require_once __DIR__ . '/vendor/autoload.php';

use Monolog\Logger;
use Monolog\Handler\StreamHandler;

// ── Logger ────────────────────────────────────────────────────────────────────
$log = new Logger('producer');
$log->pushHandler(new StreamHandler('php://stdout', Logger::DEBUG));

// ── Config ────────────────────────────────────────────────────────────────────
$kafkaBroker = getenv('KAFKA_BROKER') ?: '127.0.0.1:9092';
$topic       = getenv('KAFKA_TOPIC')  ?: 'solr-data';
$csvFolder   = $argv[1]              ?? (__DIR__ . '/csv');
$batchSize   = (int)(getenv('BATCH_SIZE') ?: 500);
$maxRetries  = 3;

$log->info("🚀 Producer starting", [
    'broker'  => $kafkaBroker,
    'topic'   => $topic,
    'folder'  => $csvFolder,
    'batch'   => $batchSize,
]);

// ── Kafka Config ──────────────────────────────────────────────────────────────
$conf = new RdKafka\Conf();
$conf->set('metadata.broker.list', $kafkaBroker);
$conf->set('socket.timeout.ms', '60000');
$conf->set('queue.buffering.max.ms', '200');
$conf->set('queue.buffering.max.messages', '100000');
$conf->set('batch.num.messages', '1000');
$conf->set('compression.codec', 'snappy');
$conf->set('message.send.max.retries', (string)$maxRetries);
$conf->set('retry.backoff.ms', '1000');
$conf->set('acks', '1');  // Leader ack only for speed

// Delivery report callback
$conf->setDrMsgCb(function (RdKafka\Producer $kafka, RdKafka\Message $message) use ($log) {
    if ($message->err) {
        $log->error("❌ Delivery failed: " . $message->errstr(), ['offset' => $message->offset]);
    }
});

$conf->setErrorCb(function ($kafka, $err, $reason) use ($log) {
    $log->error("Kafka error: $reason", ['code' => $err]);
});

// ── Producer Setup ────────────────────────────────────────────────────────────
$producer  = new RdKafka\Producer($conf);
$kafkaTopic = $producer->newTopic($topic);

// ── Helpers ───────────────────────────────────────────────────────────────────

function autocast(string $value): mixed
{
    $value = trim($value);
    if ($value === '') return null;

    $cleanValue = str_replace(',', '', $value);

    if (ctype_digit($cleanValue)) return (int)$cleanValue;
    if (preg_match('/^-\d+$/', $cleanValue)) return (int)$cleanValue;
    if (is_numeric($cleanValue) && str_contains($cleanValue, '.')) return (float)$cleanValue;
    if (strtolower($value) === 'true')  return true;
    if (strtolower($value) === 'false') return false;

    // Try date detection
    // 1. ISO-ish (YYYY-MM-DD...)
    if (preg_match('/^\d{4}-\d{2}-\d{2}/', $value)) {
        $ts = strtotime($value);
        if ($ts !== false) return date('Y-m-d\TH:i:s\Z', $ts);
    }
    // 2. User's format (DD/MM/YYYY HH:MM)
    if (preg_match('/^\d{1,2}\/\d{1,2}\/\d{4}/', $value)) {
        // Try multiple common slash formats, prioritize DD/MM/YYYY
        $fmts = ['d/m/Y H:i', 'd/m/Y', 'm/d/Y H:i', 'm/d/Y'];
        foreach ($fmts as $f) {
            $dt = DateTime::createFromFormat($f, $value);
            if ($dt !== false) return $dt->format('Y-m-d\TH:i:s\Z');
        }
    }

    return $value;
}

function validateSchema(array $headers): bool
{
    return count(array_filter($headers, fn($h) => !empty(trim($h)))) > 0;
}

// ── Main Loop ─────────────────────────────────────────────────────────────────
$csvFiles = glob($csvFolder . '/*.csv');

if (empty($csvFiles)) {
    $log->warning("⚠️  No CSV files found in: $csvFolder");
    exit(0);
}

$totalSent = 0;
$totalErrors = 0;

foreach ($csvFiles as $csvFile) {
    $fileName = basename($csvFile);
    $log->info("📂 Processing: $fileName");

    $handle = @fopen($csvFile, 'r');
    if (!$handle) {
        $log->error("Cannot open file: $fileName");
        continue;
    }

    $rawHeader = fgetcsv($handle);
    if (!$rawHeader) {
        $log->warning("Empty file: $fileName");
        fclose($handle);
        continue;
    }

    $header = array_map('trim', $rawHeader);

    // Schema validation
    if (!validateSchema($header)) {
        $log->error("Invalid schema in: $fileName");
        fclose($handle);
        continue;
    }

    $log->info("📋 Columns: " . implode(', ', $header));

    $count    = 0;
    $pending  = 0;
    $rowNumber = 1;

    while (($row = fgetcsv($handle)) !== false) {
        $rowNumber++;

        // Skip malformed rows
        if (count($row) !== count($header)) {
            $log->warning("Row $rowNumber skipped — column count mismatch", [
                'expected' => count($header),
                'got'      => count($row),
            ]);
            continue;
        }

        $raw  = array_combine($header, $row);
        $data = [];

        foreach ($raw as $key => $value) {
            $data[$key] = autocast((string)($value ?? ''));
        }

        $data['_source_file'] = $fileName;
        $data['_ingested_at'] = date('Y-m-d\TH:i:s\Z');

        $key     = (string)($data['product_id'] ?? $data['id'] ?? $count);
        $payload = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $kafkaTopic->produce(RD_KAFKA_PARTITION_UA, 0, $payload, $key);
        $pending++;
        $count++;

        // Flush every batch
        if ($pending >= $batchSize) {
            $producer->flush(10000);
            $log->info("📤 Flushed batch", ['file' => $fileName, 'count' => $count]);
            $pending = 0;
        }
    }

    // Flush remaining
    if ($pending > 0) {
        $producer->flush(15000);
    }

    fclose($handle);
    $totalSent += $count;
    $log->info("✅ Done: $fileName", ['records' => $count]);
}

// Final flush
$producer->flush(30000);

$log->info("🎉 Producer finished", [
    'total_sent'   => $totalSent,
    'total_errors' => $totalErrors,
]);
