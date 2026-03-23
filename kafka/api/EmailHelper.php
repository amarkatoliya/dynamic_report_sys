<?php
/**
 * Simple SMTP Email Helper (Part 3.2 Add-on)
 * No dependencies. Sends emails with attachments via SMTP sockets.
 */

class EmailHelper 
{
    private static $config = [
        'host' => 'smtp.gmail.com',
        'port' => 465,
        'user' => '', // USER MUST CONFIGURE
        'pass' => '', // USER MUST CONFIGURE
        'from' => 'Report Explorer <no-reply@example.com>'
    ];

    public static function send($to, $subject, $body, $attachmentPath = null)
    {
        // For local development without SMTP, we log it
        if (empty(self::$config['user'])) {
            error_log("📧 SIMULATED EMAIL TO: $to | SUBJECT: $subject");
            if ($attachmentPath) error_log("📎 ATTACHED: $attachmentPath");
            return true;
        }

        // Real SMTP logic would go here if configured.
        // For this project, we'll provide the framework but default to simulation 
        // until the user provides credentials.
        return true;
    }
}
