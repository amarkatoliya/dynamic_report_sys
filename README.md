# 📊 Dynamic Reporting System
> CSV → Kafka → Solr → PHP API → React UI

# for my path of folder
cd c:\Users\amarb\OneDrive\Attachments\Desktop\report_project

## 🚀 One-Command Setup

```bash
docker compose up -d
```

That's it. Everything — Kafka, Zookeeper, Solr, core creation, topic creation, PHP API, React frontend, Redis — starts automatically.

| Service     | URL                        |
|-------------|----------------------------|
| **Frontend**| http://localhost:3000      |
| **PHP API** | http://localhost:8000      |
| **Kafka UI**| http://localhost:8080      |
| **Solr**    | http://localhost:8983      |

---

## 🔄 Full Architecture

```
CSV files
   ↓
PHP Producer (rdkafka)
   ↓ batches of 500-1000
Kafka Topic: solr-data (3 partitions)
   ↓         ↘ DLQ: solr-data-dlq
PHP Consumer (group: solr-indexer-group)
   ↓ batches of 1000 docs
Solr core: csvcore (dynamic schema)
   ↓
PHP API (query builder, facets, pagination, date compare)
   ↓
React Frontend (table, charts, filters, saved views)
```

---

## 📁 Project Structure

```
reporting-system/
├── docker-compose.yml        ← Run this
├── kafka/
│   ├── Dockerfile            ← PHP 8.2 + rdkafka + composer
│   ├── composer.json         ← monolog, predis, vlucas/phpdotenv
│   ├── producer.php          ← CSV → Kafka (rdkafka, batch+retry)
│   ├── consumer.php          ← Kafka → Solr (DLQ, dedup, manual commit)
│   └── api/
│       └── index.php         ← REST API: /query /schema /facets /views
├── frontend/
│   ├── Dockerfile            ← Node 20 build → nginx serve
│   ├── src/
│   │   ├── App.jsx
│   │   ├── store/index.js    ← Zustand state management
│   │   └── components/
│   │       ├── Sidebar.jsx        ← Column selector + drag reorder
│   │       ├── TopBar.jsx         ← View toggle, export, refresh
│   │       ├── FilterBuilder.jsx  ← Advanced filter UI (7 filter types)
│   │       ├── DataTable.jsx      ← Resizable cols, sort, pagination, compare
│   │       ├── ChartPanel.jsx     ← Bar/Line/Pie + drill-down + export SVG
│   │       ├── SavedViews.jsx     ← Save/load/delete named views
│   │       └── StatusBar.jsx      ← Live system status
│   └── nginx.conf
└── sample-data/
    └── products.csv          ← all rows sample data
```

---

## 🧩 Features Implemented

### Column Selector ✅
- Show/hide columns dynamically via sidebar
- Drag to reorder columns (HTML5 drag API)
- Color-coded by data type (string, int, float, bool, date)
- Search/filter columns

### Advanced Filters ✅
| Type | How |
|------|-----|
| Text Search | Wildcard match on any string field |
| Multi-Select | Choose multiple values (from Solr facets) |
| Number Range | Min–Max on numeric fields |
| Date Range | From–To with Solr date format |
| Boolean | True/False toggle |
| AND/OR | Per-filter logical operator |

### Charts & Visualization ✅
- Bar chart with drill-down (click → apply filter)
- Line chart
- Pie chart with click → filter
- Auto-aggregation by X/Y field
- Statistics row (max, min, avg, total)
- Export chart as SVG

### Date Compare ✅
- Select date range → compare vs previous period OR same period last year
- Shows: absolute difference + % change
- Side-by-side table view

### Column Width Adjustment ✅
- Mouse drag resize handles
- Width persisted in Zustand store per session

### Saved Views ✅
- Save: columns, filters, sort order
- Load views instantly
- Delete views
- Slide-in drawer UI

---

## 🔧 Manually Produce Data

Place CSV files in `./sample-data/` and run:

```bash
docker exec php-kafka php producer.php
```

Or click **"Index CSV"** in the UI top bar.

---

## 📡 API Reference

### POST /api/query
```json
{
  "rows": 50,
  "page": 1,
  "sort": "price_f desc",
  "fields": ["name_s", "price_f", "category_s"],
  "filters": [
    { "field": "category_s", "type": "text", "value": "Electronics", "op": "AND" },
    { "field": "price_f", "type": "range", "min": 100, "max": 500, "op": "AND" }
  ],
  "dateCompare": {
    "field": "ingested_at_dt",
    "type": "previous_period",
    "from": "2024-01-01",
    "to": "2024-03-31"
  }
}
```

### GET /api/schema
Returns all fields with type info.

### POST /api/facets
```json
{ "fields": ["category_s", "brand_s"], "limit": 30 }
```

### GET /api/views
### POST /api/views — Save a view
### DELETE /api/views — Delete a view

---

## 🛠 Kafka Details

| Topic | Partitions | Purpose |
|-------|-----------|---------|
| solr-data | 3 | Main data pipeline |
| solr-data-dlq | 1 | Failed messages |
| report_data_topic | 3 | Additional topic |

Consumer group: `solr-indexer-group`  
Batch size: 1000 docs  
commitWithin: 5000ms (Solr soft commit)

---

## 🔎 Solr Dynamic Schema

Fields auto-suffixed:
- `_s` → string
- `_i` → integer  
- `_f` → float
- `_b` → boolean
- `_dt` → date
- `_txt` → full-text searchable

---

## 🧑‍💻 Local Development (without Docker)

```bash
# PHP API
cd kafka
composer install
KAFKA_BROKER=localhost:9092 SOLR_URL=http://localhost:8983/solr/csvcore php -S localhost:8000 -t api/

# Producer
php producer.php ./sample-data

# Consumer (separate terminal)
php consumer.php

# React frontend
cd frontend
npm install
npm run dev   # → http://localhost:3000
```

---

## 🐛 Troubleshooting

**Kafka not starting?**
```bash
docker compose logs kafka
```

**Solr core not created?**
```bash
docker compose logs solr-init
# Force recreate:
docker compose up solr-init --force-recreate
```

**No data in table?**
1. Click "Index CSV" in UI, or run: `docker exec php-kafka php producer.php`
2. Wait ~10s for consumer to index
3. Refresh query

**Consumer stuck?**
```bash
docker compose logs consumer -f
docker compose restart consumer
```
