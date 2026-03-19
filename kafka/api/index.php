<?php
/**
 * Dynamic Reporting API
 * Routes: /api/query, /api/schema, /api/facets, /api/aggregations,
 *         /api/views, /api/views/default, /api/produce, /api/health
 */

require_once __DIR__ . '/../vendor/autoload.php';

use Monolog\Logger;
use Monolog\Handler\StreamHandler;

// ── CORS ───────────────────────────────────────────────────────────────────────
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ── Config ─────────────────────────────────────────────────────────────────────
$solrUrl    = getenv('SOLR_URL')    ?: 'http://solr:8983/solr/csvcore';
$kafkaBroker = getenv('KAFKA_BROKER') ?: 'kafka:9092';
$redisHost  = getenv('REDIS_HOST')  ?: 'redis';
$redisPort  = (int)(getenv('REDIS_PORT') ?: 6379);
$cacheTtl   = (int)(getenv('CACHE_TTL')  ?: 60);   // seconds

$log = new Logger('api');
$log->pushHandler(new StreamHandler('php://stderr', Logger::WARNING));

// ── Redis connection (lazy, optional) ─────────────────────────────────────────
function getRedis(): ?\Predis\Client {
    static $redis = null;
    static $tried = false;
    if ($tried) return $redis;
    $tried = true;
    try {
        global $redisHost, $redisPort;
        $redis = new \Predis\Client(['host' => $redisHost, 'port' => $redisPort, 'timeout' => 1]);
        $redis->ping();
    } catch (\Throwable $e) {
        $redis = null;
    }
    return $redis;
}

function cacheGet(string $key): ?array {
    $r = getRedis();
    if (!$r) return null;
    try {
        $val = $r->get($key);
        return $val ? json_decode($val, true) : null;
    } catch (\Throwable $e) { return null; }
}

function cacheSet(string $key, array $data, int $ttl): void {
    $r = getRedis();
    if (!$r) return;
    try { $r->setex($key, $ttl, json_encode($data)); } catch (\Throwable $e) {}
}

function cacheKey(string $prefix, array $params): string {
    return $prefix . ':' . md5(json_encode($params));
}

// ── Router ─────────────────────────────────────────────────────────────────────
$uri    = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];
$uri    = preg_replace('#^/api#', '', $uri);

switch (true) {
    case $uri === '/query'          && $method === 'POST':   handleQuery($solrUrl);                break;
    case $uri === '/schema'         && $method === 'GET':    handleSchema($solrUrl);               break;
    case $uri === '/facets'         && $method === 'POST':   handleFacets($solrUrl);               break;
    case $uri === '/aggregations'   && $method === 'POST':   handleAggregations($solrUrl);         break;
    case $uri === '/views'          && $method === 'GET':    handleGetViews();                     break;
    case $uri === '/views'          && $method === 'POST':   handleSaveView();                     break;
    case $uri === '/views'          && $method === 'DELETE': handleDeleteView();                   break;
    case $uri === '/views/default'  && $method === 'POST':   handleSetDefaultView();               break;
    case $uri === '/produce'        && $method === 'POST':   handleProduce($kafkaBroker);          break;
    case $uri === '/health'         && $method === 'GET':    handleHealth($solrUrl);               break;
    default:
        http_response_code(404);
        json(['error' => 'Not found', 'path' => $uri]);
}

// ── Query ──────────────────────────────────────────────────────────────────────
function handleQuery(string $solrUrl): void
{
    global $cacheTtl;
    $body = getBody();

    $rows    = (int)($body['rows']   ?? 50);
    $page    = (int)($body['page']   ?? 1);
    $start   = ($page - 1) * $rows;
    $sort    = $body['sort']         ?? 'score desc';
    $q       = $body['q']            ?? '*:*';
    $fields  = $body['fields']       ?? ['*'];
    $filters = $body['filters']      ?? [];
    $dateCompare = $body['dateCompare'] ?? null;

    $fqs = buildFilterQueries($filters);

    $params = [
        'q'      => $q,
        'rows'   => $rows,
        'start'  => $start,
        'sort'   => $sort,
        'fl'     => implode(',', $fields),
        'wt'     => 'json',
        'indent' => 'false',
    ];
    if (!empty($fqs)) $params['fq'] = $fqs;

    if ($dateCompare) {
        json(executeDateCompare($solrUrl, $params, $dateCompare));
        return;
    }

    // Cache non-paginated results
    $cKey  = cacheKey('query', $params);
    $cached = cacheGet($cKey);
    if ($cached) { json($cached); return; }

    $response = solrRequest($solrUrl . '/select', $params);
    $data = json_decode($response, true);

    $result = [
        'total'  => $data['response']['numFound'] ?? 0,
        'page'   => $page,
        'rows'   => $rows,
        'docs'   => $data['response']['docs']     ?? [],
        'facets' => $data['facet_counts']          ?? null,
        'timing' => $data['responseHeader']['QTime'] ?? null,
    ];
    cacheSet($cKey, $result, $cacheTtl);
    json($result);
}

// ── Schema ─────────────────────────────────────────────────────────────────────
function handleSchema(string $solrUrl): void
{
    $excludedFields = ['id', 'score', '_version_', '_root_', '_nest_path_', '_nest_parent_'];

    $cKey = 'schema:v3';  // bumped — forces cache refresh
    $cached = cacheGet($cKey);
    if ($cached) { json($cached); return; }

    // Sample 20 docs to collect ALL possible field names (some docs may have empty cols)
    $sampleResp = solrGet($solrUrl . '/select?q=*:*&rows=20&wt=json');
    $sampleData = json_decode($sampleResp, true);
    $sampleDocs = $sampleData['response']['docs'] ?? [];

    $fields = [];
    $seen   = [];

    foreach ($sampleDocs as $sampleDoc) {
        foreach ($sampleDoc as $key => $val) {
            if (str_starts_with($key, '_')) continue;
            if (in_array($key, $excludedFields)) continue;
            if (isset($seen[$key])) continue;
            $seen[$key] = true;
            $fields[] = [
                'name'       => $key,
                'label'      => formatLabel($key),
                'type'       => inferType($key),
                'sortable'   => true,
                'filterable' => true,
            ];
        }
    }

    if (empty($fields)) {
        $response = solrGet($solrUrl . '/schema/fields?wt=json&indent=false');
        $data = json_decode($response, true);
        foreach (($data['fields'] ?? []) as $field) {
            $name = $field['name'];
            if (str_starts_with($name, '_')) continue;
            if (in_array($name, $excludedFields)) continue;
            $fields[] = [
                'name'       => $name,
                'label'      => formatLabel($name),
                'type'       => inferType($name),
                'sortable'   => true,
                'filterable' => true,
            ];
        }
    }

    $result = ['fields' => $fields];
    cacheSet($cKey, $result, 300);  // schema cached 5 min
    json($result);
}

// ── Facets ─────────────────────────────────────────────────────────────────────
function handleFacets(string $solrUrl): void
{
    global $cacheTtl;
    $body   = getBody();
    $fields = $body['fields'] ?? [];
    $limit  = (int)($body['limit'] ?? 50);
    $prefix = $body['prefix'] ?? '';
    $fqs    = buildFilterQueries($body['filters'] ?? []);

    if (empty($fields)) { json(['facets' => []]); return; }

    $cKey = cacheKey('facets', ['fields' => $fields, 'limit' => $limit, 'fqs' => $fqs]);
    $cached = cacheGet($cKey);
    if ($cached) { json($cached); return; }

    $params = [
        'q'              => '*:*',
        'rows'           => 0,
        'facet'          => 'true',
        'facet.limit'    => $limit,
        'facet.mincount' => 1,
        'wt'             => 'json',
    ];
    foreach ($fields as $f) $params['facet.field'][] = $f;
    if ($prefix) $params['facet.prefix'] = $prefix;
    if (!empty($fqs)) $params['fq'] = $fqs;

    $response = solrRequest($solrUrl . '/select', $params);
    $data = json_decode($response, true);

    $facets = [];
    foreach ($data['facet_counts']['facet_fields'] ?? [] as $field => $values) {
        $facets[$field] = [];
        for ($i = 0; $i < count($values); $i += 2) {
            $facets[$field][] = ['value' => $values[$i], 'count' => $values[$i + 1]];
        }
    }

    $result = ['facets' => $facets];
    cacheSet($cKey, $result, $cacheTtl);
    json($result);
}

// ── Aggregations (Sum / Avg / Count / Min / Max) ────────────────────────────────
function handleAggregations(string $solrUrl): void
{
    global $cacheTtl;
    $body   = getBody();
    $fields = $body['fields'] ?? [];
    $fqs    = buildFilterQueries($body['filters'] ?? []);

    if (empty($fields)) { json(['aggregations' => []]); return; }

    $cKey = cacheKey('agg', ['fields' => $fields, 'fqs' => $fqs]);
    $cached = cacheGet($cKey);
    if ($cached) { json($cached); return; }

    $params = [
        'q'    => '*:*',
        'rows' => 0,
        'wt'   => 'json',
        'stats'        => 'true',
        'stats.calcdistinct' => 'true',
    ];
    foreach ($fields as $f) $params['stats.field'][] = $f;
    if (!empty($fqs)) $params['fq'] = $fqs;

    $response = solrRequest($solrUrl . '/select', $params);
    $data = json_decode($response, true);

    $aggs = [];
    foreach ($data['stats']['stats_fields'] ?? [] as $field => $stats) {
        $aggs[$field] = [
            'count'  => $stats['count']  ?? 0,
            'sum'    => $stats['sum']    ?? 0,
            'min'    => $stats['min']    ?? null,
            'max'    => $stats['max']    ?? null,
            'mean'   => $stats['mean']   ?? null,
            'stddev' => $stats['stddev'] ?? null,
        ];
    }

    $result = ['aggregations' => $aggs];
    cacheSet($cKey, $result, $cacheTtl);
    json($result);
}

// ── Views ──────────────────────────────────────────────────────────────────────
function viewsFile(): string { return __DIR__ . '/../storage/views.json'; }
function loadViews(): array  {
    $f = viewsFile();
    return file_exists($f) ? (json_decode(file_get_contents($f), true) ?? []) : [];
}
function saveViews(array $views): void {
    @mkdir(dirname(viewsFile()), 0777, true);
    file_put_contents(viewsFile(), json_encode($views, JSON_PRETTY_PRINT));
}

function handleGetViews(): void
{
    json(['views' => loadViews()]);
}

function handleSaveView(): void
{
    $body = getBody();
    if (empty($body['name'])) { http_response_code(400); json(['error' => 'name required']); return; }

    $views = loadViews();
    $isDefault = !empty($body['is_default']);

    // If this is default, unset any previous default
    if ($isDefault) {
        $views = array_map(function($v) { $v['is_default'] = false; return $v; }, $views);
    }

    $view = [
        'id'         => 'view_' . uniqid(),
        'name'       => $body['name'],
        'columns'    => $body['columns'] ?? [],
        'filters'    => $body['filters'] ?? [],
        'sort'       => $body['sort']    ?? null,
        'created_at' => date('c'),
        'is_default' => $isDefault,
        'version'    => 1,
    ];
    $views[] = $view;
    saveViews($views);
    json(['success' => true, 'view' => $view]);
}

function handleDeleteView(): void
{
    $body = getBody();
    $id   = $body['id'] ?? null;
    if (!$id) { http_response_code(400); json(['error' => 'id required']); return; }
    $views = array_values(array_filter(loadViews(), fn($v) => $v['id'] !== $id));
    saveViews($views);
    json(['success' => true]);
}

function handleSetDefaultView(): void
{
    $body = getBody();
    $id   = $body['id'] ?? null;
    if (!$id) { http_response_code(400); json(['error' => 'id required']); return; }
    $views = array_map(function($v) use ($id) {
        $v['is_default'] = ($v['id'] === $id);
        return $v;
    }, loadViews());
    saveViews($views);
    json(['success' => true]);
}

// ── Produce ────────────────────────────────────────────────────────────────────
function handleProduce(string $kafkaBroker): void
{
    exec('php /app/producer.php /app/csv > /tmp/producer.log 2>&1 &');
    json(['success' => true, 'message' => 'Producer triggered']);
}

// ── Health ─────────────────────────────────────────────────────────────────────
function handleHealth(string $solrUrl): void
{
    $solrOk = false;
    try {
        $r = solrGet($solrUrl . '/admin/ping?wt=json');
        $d = json_decode($r, true);
        $solrOk = ($d['status'] ?? '') === 'OK';
    } catch (\Throwable $e) {}

    $redisOk = getRedis() !== null;

    json([
        'status' => 'ok',
        'time'   => date('c'),
        'solr'   => $solrOk  ? 'ok' : 'error',
        'redis'  => $redisOk ? 'ok' : 'unavailable',
    ]);
}

// ── Filter Builder ─────────────────────────────────────────────────────────────
function buildFilterQueries(array $filters): array
{
    $fqs = [];
    foreach ($filters as $filter) {
        $fq = buildSingleFilter($filter);
        if ($fq) $fqs[] = $fq;
    }
    return $fqs;
}

function buildSingleFilter(array $filter): ?string
{
    $field = $filter['field'] ?? null;
    $type  = $filter['type']  ?? 'text';
    $value = $filter['value'] ?? null;
    $op    = $filter['op']    ?? 'AND';

    // Nested group: (A AND B) OR C
    if ($type === 'nested') {
        $children = $filter['children'] ?? [];
        $parts    = [];
        foreach ($children as $child) {
            $childFq = buildSingleFilter($child);
            if ($childFq) $parts[] = $childFq;
        }
        if (empty($parts)) return null;
        return '(' . implode(" $op ", $parts) . ')';
    }

    if (!$field || $value === null || $value === '') {
        // range/date_range might have no value but min/max/from/to
        if ($type !== 'range' && $type !== 'date_range') return null;
    }

    switch ($type) {
        case 'range':
            $min = $filter['min'] ?? '*';
            $max = $filter['max'] ?? '*';
            if ($min === '' || $min === null) $min = '*';
            if ($max === '' || $max === null) $max = '*';
            if ($min === '*' && $max === '*') return null;
            return "$field:[$min TO $max]";

        case 'date_range':
            $from = $filter['from'] ?? '*';
            $to   = $filter['to']   ?? '*';
            if ($from === '' || $from === null) $from = '*';
            if ($to   === '' || $to   === null) $to   = '*';
            if ($from === '*' && $to === '*') return null;
            if ($from !== '*') $from = date('Y-m-d\TH:i:s\Z', strtotime($from));
            if ($to   !== '*') $to   = date('Y-m-d\TH:i:s\Z', strtotime($to));
            return "$field:[$from TO $to]";

        case 'multi_select':
            $vals    = is_array($value) ? $value : [$value];
            if (empty($vals)) return null;
            $escaped = array_map(fn($v) => '"' . addslashes($v) . '"', $vals);
            return "$field:(" . implode(' OR ', $escaped) . ')';

        case 'boolean':
            return "$field:" . ($value ? 'true' : 'false');

        default: // text
            if ($value === null || $value === '') return null;
            return "$field:*" . addslashes($value) . '*';
    }
}

// ── Date Compare ───────────────────────────────────────────────────────────────
function executeDateCompare(string $solrUrl, array $params, array $dateCompare): array
{
    $currentResult = json_decode(solrRequest($solrUrl . '/select', $params), true);

    $compareField = $dateCompare['field'] ?? 'ingested_at_dt';
    $compareType  = $dateCompare['type']  ?? 'previous_period';
    $from = strtotime($dateCompare['from'] ?? '-30 days');
    $to   = strtotime($dateCompare['to']   ?? 'now');
    $diff = $to - $from;

    if ($compareType === 'previous_period') {
        $cFrom = date('Y-m-d\TH:i:s\Z', $from - $diff);
        $cTo   = date('Y-m-d\TH:i:s\Z', $from);
    } else {
        $cFrom = date('Y-m-d\TH:i:s\Z', strtotime('-1 year', $from));
        $cTo   = date('Y-m-d\TH:i:s\Z', strtotime('-1 year', $to));
    }

    $compareParams        = $params;
    $compareParams['fq'][] = "$compareField:[$cFrom TO $cTo]";
    $compareResult = json_decode(solrRequest($solrUrl . '/select', $compareParams), true);

    $currentTotal = $currentResult['response']['numFound'] ?? 0;
    $compareTotal = $compareResult['response']['numFound'] ?? 0;
    $absDiff      = $currentTotal - $compareTotal;
    $pctChange    = $compareTotal > 0 ? round(($absDiff / $compareTotal) * 100, 2) : null;

    return [
        'current'    => ['total' => $currentTotal, 'docs' => $currentResult['response']['docs'] ?? []],
        'compare'    => ['total' => $compareTotal,  'docs' => $compareResult['response']['docs'] ?? []],
        'difference' => ['absolute' => $absDiff, 'percentage' => $pctChange],
    ];
}

// ── Solr Helpers ───────────────────────────────────────────────────────────────
function solrRequest(string $url, array $params): string
{
    $qs = [];
    foreach ($params as $k => $v) {
        if (is_array($v)) {
            foreach ($v as $val) {
                $qs[] = rawurlencode($k) . '=' . rawurlencode((string)$val);
            }
        } else {
            $qs[] = rawurlencode($k) . '=' . rawurlencode((string)$v);
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

function solrGet(string $url): string
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

// ── Utils ──────────────────────────────────────────────────────────────────────
function inferType(string $name): string
{
    if (str_ends_with($name, '_i'))   return 'integer';
    if (str_ends_with($name, '_f'))   return 'float';
    if (str_ends_with($name, '_b'))   return 'boolean';
    if (str_ends_with($name, '_dt'))  return 'date';
    if (str_ends_with($name, '_s'))   return 'string';
    if (str_ends_with($name, '_txt')) return 'string';
    return 'string';
}

function formatLabel(string $name): string
{
    $name = preg_replace('/(_s|_i|_f|_b|_dt|_txt)$/', '', $name);
    $name = str_replace('_', ' ', $name);
    return ucwords($name);
}

function getBody(): array
{
    return json_decode(file_get_contents('php://input'), true) ?? [];
}

function json(mixed $data): void
{
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}