<?php
/**
 * CLI Scheduler Engine (Part 3.2 Upgrade)
 * Usage: php api/scheduler.php
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/EmailHelper.php';
require_once __DIR__ . '/SolrHelper.php';

$solrUrl = SolrHelper::getSolrUrl();
$sFile   = __DIR__ . '/../storage/schedules.json';
$vFile   = __DIR__ . '/../storage/views.json';

if (!file_exists($sFile)) exit("No schedules file.\n");
$schedules = json_decode(file_get_contents($sFile), true) ?: [];
$views     = json_decode(file_get_contents($vFile), true) ?: [];

echo "🚀 Starting Scheduler [" . date('Y-m-d H:i:s') . "]\n";

foreach ($schedules as &$sched) {
    $now = time();
    $last = $sched['last_run'] ? strtotime($sched['last_run']) : 0;
    $due = false;

    switch ($sched['frequency']) {
        case 'daily':  if (($now - $last) >= 86400)  $due = true; break;
        case 'weekly': if (($now - $last) >= 604800) $due = true; break;
        case 'hourly': if (($now - $last) >= 3600)   $due = true; break;
    }

    if ($due) {
        echo "📬 Processing Schedule: {$sched['id']} for View ID: {$sched['view_id']}\n";
        
        // 1. Find the view configuration
        $view = null;
        foreach ($views as $v) if ($v['id'] === $sched['view_id']) { $view = $v; break; }
        
        if (!$view) {
            echo "⚠️ View not found: {$sched['view_id']}. Skipping.\n";
            continue;
        }

        // 2. Generate REAL CSV from Solr
        $reportFile = sys_get_temp_dir() . "/report_" . bin2hex(random_bytes(4)) . ".csv";
        $fp = fopen($reportFile, 'w');
        fprintf($fp, chr(0xEF).chr(0xBB).chr(0xBF)); // BOM for Excel

        $cols = !empty($view['columns']) ? $view['columns'] : ['id', 'score'];
        fputcsv($fp, $cols);

        $cursor = '*';
        $sort   = ($view['sort'] ?? 'score desc') . ', id asc';
        $filters = $view['filters'] ?? [];
        $search  = $view['search'] ?? '';

        echo "🔍 Querying Solr for '{$view['name']}'...\n";
        $count = 0;
        try {
            while (true) {
                $params = [
                    'q'          => $search ? ('_text_:(' . $search . ')') : '*:*',
                    'rows'       => 1000,
                    'sort'       => $sort,
                    'cursorMark' => $cursor,
                    'fl'         => implode(',', $cols),
                    'fq'         => SolrHelper::buildFilterQueries($filters),
                    'wt'         => 'json'
                ];

                $response = SolrHelper::request($solrUrl . '/select', $params);
                $res = json_decode($response, true);
                $docs = $res['response']['docs'] ?? [];
                if (empty($docs)) break;

                foreach ($docs as $doc) {
                    $row = array_map(fn($c) => $doc[$c] ?? '', $cols);
                    fputcsv($fp, $row);
                    $count++;
                }

                if (($res['nextCursorMark'] ?? null) === $cursor) break;
                $cursor = $res['nextCursorMark'] ?? null;
                if (!$cursor) break;
            }
            fclose($fp);
            echo "📊 Generated report with $count records.\n";

            // 3. Send Email
            $subject = "📊 Scheduled Report: " . $view['name'];
            $body    = "Hello,\n\nYour scheduled report '{$view['name']}' is ready.\n\n"
                     . "Total Records: $count\n"
                     . "Frequency: {$sched['frequency']}\n"
                     . "Generated at: " . date('Y-m-d H:i:s') . "\n\n"
                     . "Best regards,\nDataSheet Platform";
            
            if (EmailHelper::send($sched['email'], $subject, $body, $reportFile)) {
                echo "✅ Email sent to {$sched['email']}\n";
                $sched['last_run'] = date('c');
            } else {
                echo "❌ Failed to send email.\n";
            }
        } catch (\Exception $e) {
            echo "🔥 Error processing schedule: " . $e->getMessage() . "\n";
            @fclose($fp);
        }

        @unlink($reportFile);
    }
}

file_put_contents($sFile, json_encode($schedules, JSON_PRETTY_PRINT));
echo "🏁 Scheduler run complete.\n";
