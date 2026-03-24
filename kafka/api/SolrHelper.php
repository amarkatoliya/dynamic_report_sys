<?php
/**
 * Shared Solr & Filtering Logic
 */

class SolrHelper
{
    public static function getSolrUrl(): string
    {
        return getenv('SOLR_URL') ?: 'http://solr:8983/solr/csvcore';
    }

    public static function request(string $url, array $params): string
    {
        $qs = [];
        foreach ($params as $k => $v) {
            if (is_array($v)) {
                foreach ($v as $val) {
                    $qs[] = urlencode($k) . '=' . rawurlencode((string)$val);
                }
            } else {
                $qs[] = urlencode($k) . '=' . rawurlencode((string)$v);
            }
        }
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => implode('&', $qs),
            CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
        ]);
        $resp = curl_exec($ch);
        $err  = curl_error($ch);
        curl_close($ch);
        
        if ($err) throw new \RuntimeException("cURL: $err");
        return $resp;
    }

    public static function buildFilterQueries(array $filters): array
    {
        $fqs = [];
        foreach ($filters as $filter) {
            $fq = self::buildSingleFilter($filter);
            if ($fq) $fqs[] = $fq;
        }
        return $fqs;
    }

    public static function buildSingleFilter(array $filter): ?string
    {
        $field = $filter['field'] ?? null;
        $type  = $filter['type']  ?? 'text';
        $value = $filter['value'] ?? null;
        
        if ($type === 'nested') {
            $children = $filter['children'] ?? [];
            $groupOp  = $filter['groupOp']  ?? 'AND';
            $parts    = [];
            foreach ($children as $child) {
                $childFq = self::buildSingleFilter($child);
                if ($childFq) $parts[] = $childFq;
            }
            if (empty($parts)) return null;
            return '(' . implode(" $groupOp ", $parts) . ')';
        }

        if (!$field) return null;

        $fmtValue = function($v) use ($field) {
            if (!$v || $v === '*') return $v;
            if (str_ends_with($field, '_dt')) {
                $ts = strtotime($v);
                return $ts ? date('Y-m-d\TH:i:s\Z', $ts) : $v;
            }
            return addslashes($v);
        };

        switch ($type) {
            case 'equals':     return "$field:\"" . addslashes($value) . "\"";
            case 'not_equals': return "-$field:\"" . addslashes($value) . "\"";
            case 'is_null':    return "-$field:[* TO *]";
            case 'not_null':   return "$field:[* TO *]";
            case 'multi_select':
                if (!is_array($value) || empty($value)) return null;
                $vals = array_map(fn($v) => '"' . addslashes($v) . '"', $value);
                return "$field:(" . implode(' OR ', $vals) . ")";
            case 'range':
                $min = $filter['min'] ?? '*';
                $max = $filter['max'] ?? '*';
                return "$field:[$min TO $max]";
            case 'date_range':
                $from = $filter['from'] ?? '*';
                $to   = $filter['to']   ?? '*';
                if ($from !== '*' && $from) {
                    $ts = strtotime($from);
                    if ($ts) $from = date('Y-m-d\TH:i:s\Z', $ts);
                }
                if ($to !== '*' && $to) {
                    $ts = strtotime($to);
                    if ($ts) $to = date('Y-m-d\T23:59:59\Z', $ts);
                }
                return "$field:[$from TO $to]";
            case 'gt':
            case 'after':      return "$field:{" . $fmtValue($value) . " TO *]";
            case 'gte':        return "$field:[" . $fmtValue($value) . " TO *]";
            case 'lt':
            case 'before':     return "$field:[* TO " . $fmtValue($value) . "}";
            case 'lte':        return "$field:[* TO " . $fmtValue($value) . "]";
            case 'starts_with': return "$field:" . addslashes($value) . '*';
            case 'ends_with':   return "$field:*" . addslashes($value);
            case 'text':
            default:           return "$field:*" . addslashes($value) . '*';
        }
    }

    public static function get(string $url): string
    {
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
        ]);
        $resp = curl_exec($ch);
        curl_close($ch);
        return $resp ?: '';
    }
}
