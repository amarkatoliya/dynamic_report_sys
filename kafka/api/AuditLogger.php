<?php

/**
 * Simple file-based Audit Logger
 */
class AuditLogger
{
    private static string $logFile = __DIR__ . '/../storage/audit.json';

    public static function log(string $action, string $userId = 'system', string $status = 'SUCCESS', array $details = []): void
    {
        $logDir = dirname(self::$logFile);
        if (!is_dir($logDir)) {
            mkdir($logDir, 0777, true);
        }

        $logs = [];
        if (file_exists(self::$logFile)) {
            $logs = json_decode(file_get_contents(self::$logFile), true) ?? [];
        }

        $event = [
            'timestamp' => date('c'),
            'user_id'   => $userId,
            'action'    => $action,
            'status'    => $status,
            'details'   => $details,
            'ip'        => $_SERVER['REMOTE_ADDR'] ?? 'unknown'
        ];

        // Prepend new logs to stay at top
        array_unshift($logs, $event);
        
        // Keep last 1000 logs
        $logs = array_slice($logs, 0, 1000);

        file_put_contents(self::$logFile, json_encode($logs, JSON_PRETTY_PRINT));
    }
}
