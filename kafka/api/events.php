<?php
/**
 * SSE Endpoint: Ingestion Progress Stream
 * Streams status from storage/ingestion_status.json
 */

header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('Connection: keep-alive');
header('Access-Control-Allow-Origin: *'); // Allow from React dev server

$statusFile = __DIR__ . '/../storage/ingestion_status.json';

// Function to send SSE data
function sendMsg($data) {
    echo "data: " . json_encode($data) . "\n\n";
    if (ob_get_level() > 0) ob_flush();
    flush();
}

$lastStatus = '';

// Run for 30 seconds max (browser will reconnect)
$expiry = time() + 30;

while (time() < $expiry) {
    if (file_exists($statusFile)) {
        $content = file_get_contents($statusFile);
        if ($content !== $lastStatus) {
            $data = json_decode($content, true);
            sendMsg($data);
            $lastStatus = $content;
            
            // If completed, we can stop early after sending one last message
            if (isset($data['status']) && $data['status'] === 'completed') {
                // Keep open for a bit to ensure UI catches it
                sleep(2);
                break;
            }
        }
    } else {
        sendMsg(['status' => 'idle']);
    }

    if (connection_aborted()) break;
    
    sleep(1);
}
