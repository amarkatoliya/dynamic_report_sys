<?php
/**
 * Dynamic Reporting API
 * Routes: /api/query, /api/schema, /api/facets, /api/aggregations,
 *         /api/views, /api/views/default, /api/produce, /api/health
 */

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/JwtHelper.php';
require_once __DIR__ . '/AuditLogger.php';

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

// ── Auth & Audit Helpers ────────────────────────────────────────────────────────
function getUser(): ?array {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!str_starts_with($auth, 'Bearer ')) return null;
    $token = substr($auth, 7);
    return JwtHelper::validate($token);
}

function requireAuth(string $role = null): array {
    $user = getUser();
    if (!$user) {
        http_response_code(401);
        json(['error' => 'Unauthorized']);
    }
    if ($role && ($user['role'] ?? '') !== $role) {
        http_response_code(403);
        json(['error' => 'Forbidden']);
    }
    return $user;
}

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
    case $uri === '/login'          && $method === 'POST':   handleLogin();                        break;
    case $uri === '/query'          && $method === 'POST':   handleQuery($solrUrl);                break;
    case $uri === '/schema'         && $method === 'GET':    handleSchema($solrUrl);               break;
    case $uri === '/facets'         && $method === 'POST':   handleFacets($solrUrl);               break;
    case $uri === '/chart-data'     && $method === 'POST':   handleChartData($solrUrl);            break;
    case $uri === '/aggregations'   && $method === 'POST':   handleAggregations($solrUrl);         break;
    case $uri === '/export'         && $method === 'POST':   handleExport($solrUrl);               break;
    case $uri === '/views'          && $method === 'GET':    handleGetViews();                     break;
    case $uri === '/views'          && $method === 'POST':   handleSaveView();                     break;
    case $uri === '/views'          && $method === 'DELETE': handleDeleteView();                   break;
    case $uri === '/views/default'  && $method === 'POST':   handleSetDefaultView();               break;
    case $uri === '/sources'        && $method === 'GET':    handleSources($solrUrl);              break;
    case $uri === '/produce'        && $method === 'POST':   handleProduce($kafkaBroker);          break;
    case $uri === '/audit'          && $method === 'GET':    handleGetAudit();                     break;
    case $uri === '/health'         && $method === 'GET':    handleHealth($solrUrl);               break;
    default:
        http_response_code(404);
        json(['error' => 'Not found', 'path' => $uri]);
}

// ── Auth Handlers ──────────────────────────────────────────────────────────
function handleLogin(): void
{
    $body = getBody();
    $u = $body['username'] ?? '';
    $p = $body['password'] ?? '';

    $users = json_decode(file_get_contents(__DIR__ . '/../storage/users.json'), true);
    $found = null;
    foreach ($users as $user) {
        if ($user['username'] === $u && $user['password'] === $p) {
            $found = $user;
            break;
        }
    }

    if (!$found) {
        AuditLogger::log('LOGIN_FAILED', $u, 'FAILURE', ['reason' => 'invalid credentials']);
        http_response_code(401);
        json(['error' => 'Invalid credentials']);
    }

    $token = JwtHelper::generate([
        'user_id' => $found['id'],
        'username' => $found['username'],
        'role' => $found['role'],
        'name' => $found['name'],
        'exp' => time() + (3600 * 24) // 24h
    ]);

    AuditLogger::log('LOGIN_SUCCESS', $found['username']);
    json(['token' => $token, 'user' => [
        'id' => $found['id'],
        'username' => $found['username'],
        'name' => $found['name'],
        'role' => $found['role']
    ]]);
}

function handleGetAudit(): void
{
    requireAuth('admin');
    $logs = json_decode(file_get_contents(__DIR__ . '/../storage/audit.json'), true) ?? [];
    json(['logs' => $logs]);
}

// ── Query ──────────────────────────────────────────────────────────────────────
function handleQuery(string $solrUrl): void
{
    requireAuth();
    global $cacheTtl;
    $body = getBody();

    $user = requireAuth();
    global $cacheTtl;
    $body   = getBody();
    $page   = (int)($body['page'] ?? 1);
    $rows   = (int)($body['rows'] ?? 50);
    $cursor = $body['cursor'] ?? null;
    $sort   = $body['sort'] ?? 'score desc';

    // Must include unique key for cursorMark
    if (!str_contains($sort, 'id')) {
        $sort .= ', id asc';
    }

    $fqs = buildFilterQueries($body['filters'] ?? []);

    $params = [
        'q'              => $body['search'] ? ('_text_:(' . $body['search'] . ')') : '*:*',
        'rows'           => $rows,
        'sort'           => $sort,
        'fl'             => implode(',', $body['fields'] ?? ['*']),
        'wt'             => 'json',
        'hl'             => 'true',
        'hl.fl'          => '*',
        'hl.simple.pre'  => '<mark>',
        'hl.simple.post' => '</mark>',
        'hl.fragsize'    => 0, // return full field if possible
    ];

    if ($cursor) {
        $params['cursorMark'] = $cursor;
    } else {
        $params['start'] = ($page - 1) * $rows;
    }
    if (!empty($fqs)) $params['fq'] = $fqs;

    // Cache non-paginated results
    $cKey  = cacheKey('query', $params);
    $cached = cacheGet($cKey);
    if ($cached) { json($cached); return; }

    $response = solrRequest($solrUrl . '/select', $params);
    error_log("Solr Query: " . $solrUrl . "/select?" . http_build_query($params));
    AuditLogger::log('QUERY_EXECUTED', $user['username'], 'SUCCESS', ['search' => $body['search'] ?? '*:*']);

    $res = json_decode($response, true);
    $result = [
        'total'      => $res['response']['numFound'] ?? 0,
        'page'       => $page,
        'rows'       => $rows,
        'docs'       => $res['response']['docs']     ?? [],
        'facets'     => $res['facet_counts']         ?? null,
        'timing'     => $res['responseHeader']['QTime'] ?? null,
        'nextCursor' => $res['nextCursorMark']       ?? null,
        'highlights' => $res['highlighting']         ?? []
    ];
    cacheSet($cKey, $result, $cacheTtl);
    json($result);
}

// ── Sources ──────────────────────────────────────────────────────────────────
function handleSources(string $solrUrl): void
{
    requireAuth();
    $params = [
        'q'              => '*:*',
        'rows'           => 0,
        'facet'          => 'true',
        'facet.field'    => 'source_file_s',
        'facet.mincount' => 1,
        'facet.limit'    => 1000,
        'wt'             => 'json',
    ];
    $response = solrRequest($solrUrl . '/select', $params);
    $data = json_decode($response, true);
    
    $sources = [];
    $values = $data['facet_counts']['facet_fields']['source_file_s'] ?? [];
    for ($i = 0; $i < count($values); $i += 2) {
        $sources[] = $values[$i];
    }
    json(['sources' => $sources]);
}

// ── Schema ─────────────────────────────────────────────────────────────────────
function handleSchema(string $solrUrl): void
{
    requireAuth();
    $excludedFields = ['id', 'score', '_version_', '_root_', '_nest_path_', '_nest_parent_', 'source_file_s'];
    $source = $_GET['source'] ?? null;

    $cKey = 'schema:v7' . ($source ? ':' . md5($source) : ''); 
    $cached = cacheGet($cKey);
    if ($cached) { json($cached); return; }

    $fields = [];
    $seen   = [];

    if ($source) {
        // Sample docs for THIS source to see its specific columns
        // Use a larger sample (500) to catch all dynamic fields in the CSV
        $q = 'source_file_s:"' . addslashes($source) . '"';
        $sampleResp = solrGet($solrUrl . '/select?q=' . urlencode($q) . '&rows=500&wt=json');
        $sampleData = json_decode($sampleResp, true);
        $sampleDocs = $sampleData['response']['docs'] ?? [];
        
        if (empty($sampleDocs)) { json(['fields' => []]); return; }

        foreach ($sampleDocs as $doc) {
            foreach ($doc as $key => $val) {
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
    } else {
        // Global schema using Luke (fastest/most accurate for full core)
        $lukeResp = solrGet($solrUrl . '/admin/luke?numTerms=0&wt=json');
        $lukeData = json_decode($lukeResp, true);
        $lukeFields = $lukeData['fields'] ?? [];

        foreach ($lukeFields as $name => $info) {
            if (str_starts_with($name, '_')) continue;
            if (in_array($name, $excludedFields)) continue;
            $seen[$name] = true;
            $fields[] = [
                'name'       => $name,
                'label'      => formatLabel($name),
                'type'       => inferType($name),
                'sortable'   => true,
                'filterable' => true,
            ];
        }
    }

    // Fallback if Luke is somehow restricted
    if (empty($fields)) {
        $response = solrGet($solrUrl . '/schema/fields?wt=json&indent=false');
        $data = json_decode($response, true);
        foreach (($data['fields'] ?? []) as $field) {
            $name = $field['name'];
            if (str_starts_with($name, '_')) continue;
            if (in_array($name, $excludedFields)) continue;
            if (isset($seen[$name])) continue;
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
    requireAuth();
    global $cacheTtl;
    $body   = getBody();
    $fields = $body['fields'] ?? [];
    $pivots = $body['pivots'] ?? [];
    $limit  = (int)($body['limit'] ?? 50);
    $prefix = $body['prefix'] ?? '';
    $filters = $body['filters'] ?? [];

    $fqs = buildFilterQueries($filters);

    if (empty($fields) && empty($pivots)) { json(['facets' => []]); return; }

    $params = [
        'q'              => '*:*',
        'rows'           => 0,
        'facet'          => 'true',
        'facet.limit'    => $limit,
        'facet.mincount' => 1,
        'wt'             => 'json',
    ];

    if (!empty($fields)) $params['facet.field'] = $fields;
    if (!empty($pivots)) $params['facet.pivot'] = array_map(fn($p) => implode(',', $p), $pivots);
    if ($prefix) $params['facet.prefix'] = $prefix;
    if (!empty($fqs)) $params['fq'] = $fqs;

    $cKey = cacheKey('facets', ['fields' => $fields, 'pivots' => $pivots, 'limit' => $limit, 'fqs' => $fqs]);
    $cached = cacheGet($cKey);
    if ($cached) { json($cached); return; }

    $response = solrRequest($solrUrl . '/select', $params);
    $res = json_decode($response, true);
    $out = [];
    if (!empty($res['facet_counts']['facet_fields'])) {
        foreach ($res['facet_counts']['facet_fields'] as $f => $vals) {
            $chunked = array_chunk($vals, 2);
            $out[$f] = array_map(fn($c) => ['value' => $c[0], 'count' => $c[1]], $chunked);
        }
    }
    if (!empty($res['facet_counts']['facet_pivot'])) {
        $out['pivots'] = $res['facet_counts']['facet_pivot'];
    }

    cacheSet($cKey, $out, $cacheTtl);
    json(['facets' => $out]);
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
    requireAuth();
    json(['views' => loadViews()]);
}

function handleSaveView(): void
{
    $user = requireAuth();
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
        'userId'     => $user['user_id'],
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
    AuditLogger::log('VIEW_SAVED', $user['username'], 'SUCCESS', ['view_name' => $body['name']]);
    json(['success' => true, 'view' => $view]);
}

function handleDeleteView(): void
{
    $user = requireAuth();
    $body = getBody();
    $id   = $body['id'] ?? null;
    if (!$id) { http_response_code(400); json(['error' => 'id required']); return; }
    
    $oldViews = loadViews();
    $view = null;
    foreach ($oldViews as $v) {
        if ($v['id'] === $id) {
            $view = $v;
            break;
        }
    }

    if (!$view) { http_response_code(404); json(['error' => 'view not found']); return; }

    // Logic: Only owner or admin can delete
    if ($view['userId'] !== $user['user_id'] && $user['role'] !== 'admin') {
        http_response_code(403);
        json(['error' => 'Forbidden: You do not own this view']);
        return;
    }
    
    $views = array_values(array_filter($oldViews, fn($v) => $v['id'] !== $id));
    saveViews($views);
    
    AuditLogger::log('VIEW_DELETED', $user['username'], 'SUCCESS', ['view_id' => $id, 'view_name' => $view['name'] ?? 'unknown']);
    json(['success' => true]);
}

function handleSetDefaultView(): void
{
    requireAuth();
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

// ── Chart Data (server-side aggregation) ─────────────────────────────────────
function handleChartData(string $solrUrl): void
{
    requireAuth();
    global $cacheTtl;
    $body = getBody();

    $xField    = $body['xField']   ?? null;
    $yField    = $body['yField']   ?? null;    // numeric field to SUM, or null for COUNT
    $y2Field   = $body['y2Field']  ?? null;    // optional second numeric field
    $filters   = $body['filters']  ?? [];
    $source    = $body['source']   ?? null;
    $limit     = min((int)($body['limit'] ?? 30), 100);
    $q         = $body['q']           ?? '*:*';

    if (!$xField) { json(['error' => 'xField is required']); return; }

    // Build filter queries
    $fqs = buildFilterQueries($filters);
    if ($source) {
        $fqs[] = 'source_file_s:"' . addslashes($source) . '"';
    }

    $params = [
        'q'          => $q,
        'rows'       => 0,
        'wt'         => 'json',
        'facet'      => 'true',
        'facet.field'=> $xField,
        'facet.limit'=> $limit,
        'facet.mincount' => 1,
    ];

    if ($yField) {
        $params['stats'] = 'true';
        $params['stats.field'] = [$yField];
        if ($y2Field) $params['stats.field'][] = $y2Field;
        $params['stats.facet'] = $xField;
    }

    if (!empty($fqs)) $params['fq'] = $fqs;

    // Cache
    $cKey = cacheKey('chart2', $params);
    $cached = cacheGet($cKey);
    if ($cached) { json(array_merge($cached, ['cached' => true])); return; }

    $response = solrRequest($solrUrl . '/select', $params);
    $data     = json_decode($response, true);
    $total    = $data['response']['numFound'] ?? 0;

    $chartData = [];
    $facets = $data['facet_counts']['facet_fields'][$xField] ?? [];
    
    // Classic stats grouped by facet
    $statsFacet = $data['stats']['stats_fields'] ?? [];

    for ($i = 0; $i < count($facets); $i += 2) {
        $val = $facets[$i];
        $count = $facets[$i+1];
        
        $point = [
            'name'  => (string)$val,
            'count' => $count,
        ];

        if ($yField && isset($statsFacet[$yField]['facets'][$xField][$val])) {
            $sf = $statsFacet[$yField]['facets'][$xField][$val];
            $point['y_sum'] = is_numeric($sf['sum'] ?? null) ? $sf['sum'] : 0;
            $point['y_avg'] = is_numeric($sf['mean'] ?? null) ? round((float)$sf['mean'], 2) : 0;
            $point['y_min'] = is_numeric($sf['min'] ?? null) ? $sf['min'] : 0;
            $point['y_max'] = is_numeric($sf['max'] ?? null) ? $sf['max'] : 0;
        }
        if ($y2Field && isset($statsFacet[$y2Field]['facets'][$xField][$val])) {
            $sf = $statsFacet[$y2Field]['facets'][$xField][$val];
            $point['y2_sum'] = is_numeric($sf['sum'] ?? null) ? $sf['sum'] : 0;
            $point['y2_avg'] = is_numeric($sf['mean'] ?? null) ? round((float)$sf['mean'], 2) : 0;
        }

        $chartData[] = $point;
    }

    // Global stats
    $globalStats = ['total_docs' => $total];
    if ($yField && isset($statsFacet[$yField])) {
        $sf = $statsFacet[$yField];
        $globalStats['y_sum'] = is_numeric($sf['sum'] ?? null) ? $sf['sum'] : 0;
        $globalStats['y_avg'] = is_numeric($sf['mean'] ?? null) ? round((float)$sf['mean'], 2) : 0;
        $globalStats['y_min'] = is_numeric($sf['min'] ?? null) ? $sf['min'] : 0;
        $globalStats['y_max'] = is_numeric($sf['max'] ?? null) ? $sf['max'] : 0;
    }

    $result = [
        'data'   => $chartData,
        'stats'  => $globalStats,
        'timing' => $data['responseHeader']['QTime'] ?? null,
    ];

    cacheSet($cKey, $result, $cacheTtl);
    json($result);
}

// ── Aggregations ───────────────────────────────────────────────────────────────
function handleAggregations(string $solrUrl): void
{
    requireAuth();
    $body    = getBody();
    $fields  = $body['fields']  ?? [];
    $filters = $body['filters'] ?? [];
    $source  = $body['source']  ?? null;

    $fqs = buildFilterQueries($filters);
    if ($source) {
        $fqs[] = 'source_file_s:"' . addslashes($source) . '"';
    }

    $params = [
        'q'          => '*:*',
        'rows'       => 0,
        'wt'         => 'json',
        'stats'      => 'true',
    ];
    if (!empty($fqs)) $params['fq'] = $fqs;
    foreach ($fields as $f) $params['stats.field'][] = $f;

    $response = solrRequest($solrUrl . '/select', $params);
    $data     = json_decode($response, true);
    $statsFacet = $data['stats']['stats_fields'] ?? [];

    $aggregations = [];
    foreach ($fields as $f) {
        $sf = $statsFacet[$f] ?? [];
        $aggregations[$f] = [
            'sum' => is_numeric($sf['sum'] ?? null) ? $sf['sum'] : 0,
            'avg' => is_numeric($sf['mean'] ?? null) ? round((float)$sf['mean'], 2) : 0,
            'min' => is_numeric($sf['min'] ?? null) ? $sf['min'] : 0,
            'max' => is_numeric($sf['max'] ?? null) ? $sf['max'] : 0,
        ];
    }

    json(['aggregations' => $aggregations]);
}

// ── Produce ────────────────────────────────────────────────────────────────────
function handleProduce(string $kafkaBroker): void
{
    $user = requireAuth('admin');
    exec('php /app/producer.php /app/csv > /tmp/producer.log 2>&1 &');
    AuditLogger::log('INDEX_TRIGGERED', $user['username']);
    json(['success' => true, 'message' => 'Producer triggered']);
}

// ── Streaming Export ────────────────────────────────────────────────────────
function handleExport(string $solrUrl): void
{
    $user = requireAuth();
    $body = getBody();
    $cols = $body['columns'] ?? [];
    $search = $body['search'] ?? '';
    
    // Set headers for CSV download
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename=report_' . date('Ymd_His') . '.csv');
    
    $output = fopen('php://output', 'w');
    fprintf($output, chr(0xEF).chr(0xBB).chr(0xBF)); // BOM for Excel

    // Write header
    fputcsv($output, $cols);

    $cursor = '*';
    $sort = ($body['sort'] ?? 'score desc') . ', id asc';
    
    AuditLogger::log('EXPORT_STARTED', $user['username'], 'SUCCESS', ['rows_estimate' => 'all']);

    while (true) {
        $params = [
            'q'          => $search ? ('_text_:(' . $search . ')') : '*:*',
            'rows'       => 1000,
            'sort'       => $sort,
            'cursorMark' => $cursor,
            'fl'         => implode(',', $cols),
            'fq'         => buildFilterQueries($body['filters'] ?? []),
            'wt'         => 'json'
        ];

        $response = solrRequest($solrUrl . '/select', $params);
        $res = json_decode($response, true);
        $docs = $res['response']['docs'] ?? [];
        if (empty($docs)) break;

        foreach ($docs as $doc) {
            $row = array_map(fn($c) => $doc[$c] ?? '', $cols);
            fputcsv($output, $row);
        }

        if (($res['nextCursorMark'] ?? null) === $cursor) break;
        $cursor = $res['nextCursorMark'] ?? null;
        if (!$cursor) break; // Should not happen if nextCursorMark is not same as current, but good for safety
        
        // Check for client disconnect
        if (connection_aborted()) break;
    }

    fclose($output);
    exit;
}

// ── Health Check ──────────────────────────────────────────────────────────────
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
        $groupOp = $filter['groupOp'] ?? $op;
        return '(' . implode(" $groupOp ", $parts) . ')';
    }

    if (!$field || ($value === null || $value === '') && !in_array($type, ['range', 'date_range', 'is_null', 'not_null'])) {
        return null;
    }

    $isDate = $field && inferType($field) === 'date';
    $fmtValue = function($v) use ($isDate) {
        if ($isDate && $v !== '*') return date('Y-m-d\TH:i:s\Z', strtotime($v));
        return $v;
    };

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
            if ($from !== '*') $from = date('Y-m-d\T00:00:00\Z', strtotime($from));
            if ($to   !== '*') $to   = date('Y-m-d\T23:59:59\Z', strtotime($to));
            return "$field:[$from TO $to]";

        case 'is_null':  return "(*:* -$field:[* TO *])";
        case 'not_null': return "$field:[* TO *]";

        case 'multi_select':
        case 'not_in':
            $vals = is_array($value) ? $value : [$value];
            if (empty($vals)) return null;
            $escaped = array_map(fn($v) => '"' . addslashes($v) . '"', $vals);
            $query = "$field:(" . implode(' OR ', $escaped) . ')';
            return $type === 'not_in' ? "(*:* -$query)" : $query;

        case 'boolean':
            return "$field:" . ($value ? 'true' : 'false');

        case 'equals':
            $v = $fmtValue($value);
            $isNum = in_array(inferType($field), ['integer', 'float']);
            if ($isNum || $isDate) return "$field:" . addslashes($v);
            return "$field:\"" . addslashes($v) . "\"";
            
        case 'not_equals':
            $v = $fmtValue($value);
            $isNum = in_array(inferType($field), ['integer', 'float']);
            if ($isNum || $isDate) return "(*:* -$field:" . addslashes($v) . ")";
            return "(*:* -$field:\"" . addslashes($v) . "\")";
            
        case 'gt':
        case 'after':
            return "$field:{" . $fmtValue($value) . " TO *]";
            
        case 'gte':
            return "$field:[" . $fmtValue($value) . " TO *]";
            
        case 'lt':
        case 'before':
            return "$field:[* TO " . $fmtValue($value) . "}";
            
        case 'lte':
            return "$field:[* TO " . $fmtValue($value) . "]";

        case 'starts_with': return "$field:" . addslashes($value) . '*';
        case 'ends_with':   return "$field:*" . addslashes($value);
        case 'text':
        default:
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