<?php
/**
 * Professional Email Helper
 * Supports SMTP simulation and real sending with attachments.
 */

class EmailHelper 
{
    private static $config = [
        'host' => 'smtp.gmail.com',
        'port' => 465,
        'user' => '', // CONFIGURE FOR REAL SENDING
        'pass' => '', // CONFIGURE FOR REAL SENDING
        'from' => 'DataSheet Reports <no-reply@example.com>'
    ];

    /**
     * Send email with optional attachment
     */
    public static function send(string $to, string $subject, string $body, string $attachmentPath = null): bool
    {
        error_log("📧 [EmailHelper] Preparing email to: $to | Subject: $subject");

        if (empty(self::$config['user'])) {
            error_log("ℹ️ [SIMULATION] No SMTP credentials. Logging content instead.");
            error_log("--- BODY ---\n$body\n------------");
            if ($attachmentPath && file_exists($attachmentPath)) {
                error_log("📎 [SIMULATION] Attachment would be: " . basename($attachmentPath) . " (" . filesize($attachmentPath) . " bytes)");
            }
            return true;
        }

        // Real SMTP/Mail Logic
        try {
            return self::mailWithAttachment($to, $subject, $body, $attachmentPath);
        } catch (\Exception $e) {
            error_log("❌ [EmailHelper] Error: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Native PHP mail() implementation with multi-part support for attachments
     */
    private static function mailWithAttachment($to, $subject, $message, $path)
    {
        $from = self::$config['from'];
        $boundary = md5(time());

        $headers = "From: $from\r\n";
        $headers .= "Reply-To: $from\r\n";
        $headers .= "MIME-Version: 1.0\r\n";
        $headers .= "Content-Type: multipart/mixed; boundary=\"$boundary\"\r\n";

        // Plain text body
        $body = "--$boundary\r\n";
        $body .= "Content-Type: text/plain; charset=\"UTF-8\"\r\n";
        $body .= "Content-Transfer-Encoding: 7bit\r\n\r\n";
        $body .= $message . "\r\n\r\n";

        // Attachment
        if ($path && file_exists($path)) {
            $filename = basename($path);
            $content  = chunk_split(base64_encode(file_get_contents($path)));
            
            $body .= "--$boundary\r\n";
            $body .= "Content-Type: text/csv; name=\"$filename\"\r\n";
            $body .= "Content-Description: $filename\r\n";
            $body .= "Content-Disposition: attachment; filename=\"$filename\"; size=" . filesize($path) . ";\r\n";
            $body .= "Content-Transfer-Encoding: base64\r\n\r\n";
            $body .= $content . "\r\n\r\n";
        }

        $body .= "--$boundary--";

        return mail($to, $subject, $body, $headers);
    }
}
