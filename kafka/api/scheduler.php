<?php
/**
 * CLI Scheduler Engine (Part 3.2)
 * Usage: php api/scheduler.php
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/EmailHelper.php';

// We need some helpers from index.php but without the routing/auth
// For simplicity, we'll redefine the minimum needed or include a common file.
// Since we don't have a common file yet, let's define the basics.

$solrUrl = getenv('SOLR_URL') ?: 'http://solr:8983/solr/csvcore';
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
        case 'daily':  if (($now - $last) >= 86400) $due = true; break;
        case 'weekly': if (($now - $last) >= 604800) $due = true; break;
        case 'hourly': if (($now - $last) >= 3600) $due = true; break; // For testing
    }

    if ($due) {
        echo "📬 Processing Schedule: {$sched['id']} (Email: {$sched['email']})\n";
        
        // 1. Find the view
        $view = null;
        foreach ($views as $v) if ($v['id'] === $sched['view_id']) { $view = $v; break; }
        
        if (!$view) {
            echo "⚠️ View not found: {$sched['view_id']}. Skipping.\n";
            continue;
        }

        // 2. Mock Solr Query (In a real app, we'd use the handleExport logic)
        // For this MVP, we'll simulate the report generation
        $reportFile = sys_get_temp_dir() . "/report_{$sched['id']}.csv";
        
        // Simple mock CSV generation
        $csvData = "Report Date," . date('Y-m-d') . "\n";
        $csvData .= "View Name," . $view['name'] . "\n";
        $csvData .= "Total Records,Simulated\n";
        file_put_contents($reportFile, $csvData);

        // 3. Send Email
        $subject = "📊 Scheduled Report: " . $view['name'];
        $body    = "Hello,\n\nYour scheduled report '{$view['name']}' is ready.\n\nFrequency: {$sched['frequency']}\nGenerated at: " . date('Y-m-d H:i:s');
        
        if (EmailHelper::send($sched['email'], $subject, $body, $reportFile)) {
            echo "✅ Email sent successfully.\n";
            $sched['last_run'] = date('c');
        } else {
            echo "❌ Failed to send email.\n";
        }

        @unlink($reportFile);
    }
}

file_put_contents($sFile, json_encode($schedules, JSON_PRETTY_PRINT));
echo "🏁 Done.\n";
