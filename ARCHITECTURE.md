# Tally Intelligence Dashboard — Architecture & Feature Reference

**Tally Intelligence Dashboard** is a full-stack Fiori application that synchronizes Tally ERP master data (Ledgers, Vouchers, Stock Items) via **SAP BTP Integration Suite (CPI)**. It provides schema-agnostic visualization, automatic background sync, production-grade deduplication, and a dynamic record inspector.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Directory Structure](#directory-structure)
3. [System Architecture & Data Flow](#system-architecture--data-flow)
4. [All Features](#all-features)
5. [API Endpoints Reference](#api-endpoints-reference)
6. [OData v4 Endpoints](#odata-v4-endpoints)
7. [Processes & Startup](#processes--startup)
8. [Testing](#testing)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | SAPUI5 / OpenUI5 v1.147.0, XML Views, JavaScript Controllers, SAP Fiori Horizon theme |
| Backend | Node.js, Express.js 4.21, CORS middleware |
| Security Proxy | Node.js (vanilla `http`/`https`) — OAuth2 token management & CPI API gateway |
| CPI Middleware | Apache Groovy — XML/JSON extraction from SAP CPI Data Store |
| Persistence | JSON flat-file store (`data/store.json`) |
| Build Tooling | UI5 Tooling (`@ui5/cli`), Fiori Tools (`@sap/ux-ui5-tooling`), ESLint |
| Testing | QUnit (unit tests), OPA5 (integration tests) |

---

## Directory Structure

```
tallyapp/
├── token-proxy.js                       # OAuth2 proxy & CPI gateway (port 3002)
├── ui5.yaml / ui5-local.yaml            # UI5 middleware proxy config
├── package.json                         # Root — UI5 tooling deps & scripts
│
├── backend/
│   ├── package.json                     # Express server deps
│   ├── server.js                        # Express entry + auto-sync engine (port 3003)
│   ├── push-to-cpi.js                   # CLI: push JSON files to CPI Data Store
│   ├── watch-ingest.js                  # File watcher: auto-push files from incoming/
│   ├── sample-data.json                 # Sample ledger payload for testing
│   ├── data/
│   │   └── store.json                   # Persistent data store (all ingested versions)
│   ├── incoming/
│   │   ├── processed/                   # Successfully ingested files
│   │   └── failed/                      # Files that failed ingestion
│   ├── src/
│   │   ├── server.js                    # Express + auto-sync
│   │   ├── helpers/
│   │   │   └── istTimestamp.js          # ISO timestamp utility
│   │   └── routes/
│   │       └── index.js                 # All REST & OData routes + data logic
│
├── groovy/
│   └── ReadFlowProcessor.groovy         # CPI Groovy: CDATA XML → JSON extraction
│
├── webapp/
│   ├── index.html                       # UI5 bootstrap
│   ├── manifest.json                    # Fiori app manifest (routes, data sources)
│   ├── Component.js                     # UI5 component init
│   ├── controller/
│   │   ├── App.controller.js            # Root shell controller
│   │   └── View1.controller.js          # Main dashboard controller (all logic)
│   ├── view/
│   │   ├── App.view.xml                 # Root shell view
│   │   └── View1.view.xml               # Dashboard layout (tables, tabs, header)
│   ├── model/models.js                  # Device model
│   ├── css/style.css                    # Custom styles
│   ├── i18n/                            # Resource bundles
│   └── test/                            # QUnit & OPA5 tests
│
└── .env                                 # BTP credentials (gitignored)
```

---

## System Architecture & Data Flow

### Triple-Tier Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    SAP BTP (Cloud)                        │
│                                                           │
│  SAP Cloud Platform Integration (CPI) Suite              │
│  ├── Data Store: "TALLY_DATA" (Global)                   │
│  ├── Write Endpoint: /http/tally-write                   │
│  ├── Read Endpoint:  /http/read-tally                    │
│  └── Groovy: ReadFlowProcessor.groovy                    │
│       (Extracts CDATA XML → JSON array)                  │
└──────────────────────┬───────────────────────────────────┘
                       │  HTTPS + OAuth2 Bearer Token
                       │
┌──────────────────────▼───────────────────────────────────┐
│              token-proxy.js (Port 3002)                   │
│                                                           │
│  OAuth2 token management + CPI gateway                    │
│  ├── GET /token         → BTP UAA (cached + auto-refresh)│
│  ├── GET /api/*         → CPI read endpoints             │
│  └── POST /api/http/tally-write → CPI write + notify bk  │
│                                                           │
│  Features:                                                │
│  ├── Token caching (refreshes 60s before expiry)         │
│  ├── Credential override via X-BTP-* headers             │
│  ├── Port conflict resolution (auto-kills occupant)      │
│  └── CORS headers                                        │
└──────────────────────┬───────────────────────────────────┘
                       │  HTTP (localhost)
                       │
┌──────────────────────▼───────────────────────────────────┐
│          Backend Server (Port 3003)                        │
│                                                           │
│  src/server.js:                                           │
│  ├── Express app with CORS, JSON parsing                 │
│  └── Auto-Sync Engine (setInterval every 5 min)          │
│                                                           │
│  src/routes/index.js:                                     │
│  ├── REST endpoints (health, versions, sync)             │
│  ├── OData v4 endpoints (Syncs, Ledgers, Vouchers,       │
│  │   StockItems)                                          │
│  ├── Data ingestion + deduplication logic                │
│  └── CPI communication functions                         │
│                                                           │
│  Persistence: data/store.json                             │
└──────────────────────┬───────────────────────────────────┘
                       │  HTTP (via UI5 proxy)
                       │
┌──────────────────────▼───────────────────────────────────┐
│        SAPUI5 Frontend (ui5 serve, default port)          │
│                                                           │
│  webapp/controller/View1.controller.js                    │
│  ├── Loads data from OData v4 endpoints                  │
│  ├── Company dropdown filter                             │
│  ├── 4-tab IconTabBar (Sync History, Ledgers,            │
│  │   Vouchers, Stock Items)                              │
│  ├── Search within each tab                              │
│  ├── "Full Record Inspector" dialog (dynamic schema)     │
│  ├── "Fetch from BTP" manual sync button                 │
│  ├── "Refresh UI" button                                 │
│  └── Footer connection status                            │
│                                                           │
│  webapp/view/View1.view.xml                              │
│  ├── Header bar (company selector, buttons, timestamp)   │
│  ├── Summary panel (version counts by type)              │
│  ├── IconTabBar with 4 tabs                              │
│  └── Growing tables with "Full Record Inspector"         │
└──────────────────────────────────────────────────────────┘
```

### End-to-End Data Flow

```
Step 1 — Ingest (Write Path)
─────────────────────────────
  Tally ERP
    │
    ├── Manual: node push-to-cpi.js sample-data.json Ledgers
    │   └── Reads file → GET /token from proxy → POST to CPI /http/tally-write
    │       → CPI stores XML-wrapped JSON in Data Store "TALLY_DATA"
    │
    └── Automatic: watch-ingest.js
        └── Monitors backend/incoming/ every 5s
            └── New .json file detected → runs push-to-cpi.js
                └── Success → moved to incoming/processed/
                └── Failure → moved to incoming/failed/

Step 2 — Sync (Read Path)
──────────────────────────
  Auto-Sync Engine (every 5 min)
    │
    └── fetchFreshFromCpi() in server.js
        │
        └── Backend → GET /api/http/read-tally → token-proxy
            │
            └── Token-proxy → obtains OAuth2 token (cache or fresh)
                → GET CPI /http/read-tally (with Bearer token)
                │
                └── CPI runs ReadFlowProcessor.groovy:
                    ├── XmlSlurper parses XML response
                    ├── Extracts CDATA content from <entry><value> blocks
                    ├── Parses JSON from CDATA
                    ├── Captures SAP MPL ID (@id from XML <message>)
                    └── Returns clean JSON array

  Manual: User clicks "Fetch from BTP" in dashboard
    └── POST /api/sync/btp-fetch → same path as above

Step 3 — Ingestion & Deduplication
───────────────────────────────────
  addVersion() in routes/index.js:
    ├── Extract syncId / cpiMessageId from payload
    ├── If missing → SHA-256 fingerprint (company + type + 1st record)
    ├── Compare against existing dataVersions[]
    ├── If duplicate → skip (return existing)
    ├── If new → normalize data structure:
    │   ├── Handles arrays, {data}, {value}, {entries}, {records}
    │   └── Handles nested "all" type {ledgers, vouchers, stockItems}
    ├── Compute summary stats (totals by type)
    └── Save to in-memory dataVersions[] + persist to store.json

Step 4 — Display
─────────────────
  UI5 Frontend:
    ├── On load → OData GET /odata/v4/tally/Syncs
    │                        /odata/v4/tally/Ledgers
    │                        /odata/v4/tally/Vouchers
    │                        /odata/v4/tally/StockItems
    ├── Company filter → GET /api/companies → re-filter all tables
    ├── Tab switch → toggle table visibility within IconTabBar
    └── Row click → "Full Record Inspector" → dynamic dialog
        (scans all keys in the record object, no schema required)
```

---

## All Features

### 1. Auto-Sync Engine
- **File:** `backend/src/server.js`
- A background `setInterval` worker runs every **5 minutes**.
- Calls `fetchFreshFromCpi()` to check SAP BTP for new documents.
- Deduplicates against existing versions before ingestion.
- No manual intervention required — runs as long as the backend is up.

### 2. Production Accuracy Protocol (Deduplication)
- **File:** `backend/src/routes/index.js:42-134`
- Prevents double-counting by extracting the true **SAP Message Processing Log ID (MPL ID)** from the cloud payload.
- Uses `syncId` or `cpiMessageId` as the primary deduplication key.
- Falls back to a **SHA-256 fingerprint** of `company + type + firstRecord` when no ID is present.
- Versions are compared before any ingestion occurs.

### 3. Dynamic Schema Explorer (Full Record Inspector)
- **File:** `webapp/controller/View1.controller.js:196-243`
- A "Full Record Inspector" button on each table row.
- Dynamically scans **ALL keys** in a record object and renders field-value pairs in a dialog.
- Schema-agnostic — if Tally adds a new custom field, it appears instantly without code changes.

### 4. Dual-Mode Synchronization
- **Files:** `backend/src/server.js` (auto-sync), `webapp/controller/View1.controller.js` (manual button)
- **Automatic:** 5-minute background sync engine.
- **Manual:** "Fetch from BTP" button sends `POST /api/sync/btp-fetch`, fetches from CPI, deduplicates, and auto-refreshes the UI.

### 5. Self-Healing & Resilience
- **File:** `backend/src/routes/index.js:137-164`
- Never crashes on bad credentials, expired tokens, or empty Data Stores.
- If BTP is unreachable, gracefully falls back to local data (`store.json`).
- Error paths return empty arrays with error codes rather than throwing.

### 6. CDATA XML Handling (CPI Groovy Script)
- **File:** `groovy/ReadFlowProcessor.groovy`
- Processes Tally JSON data wrapped in XML CDATA blocks.
- Uses `XmlSlurper` for streaming compliance (avoids `XmlParser` DOM issues).
- Iterates only through direct `<message>` nodes (prevents double-counting from `depthFirst()`).
- Extracts real SAP Message ID from XML `@id` attribute.

### 7. Company Filter (Multi-Tenant Support)
- **Files:** `webapp/view/View1.view.xml:30-38`, `webapp/controller/View1.controller.js:41-66`
- Dropdown in dashboard header listing all distinct companies from ingested data.
- Selecting a company scopes **Sync History, Ledgers, Vouchers, and Stock Items** to that company.
- Includes "All Companies (Latest Overall)" option.

### 8. Token Caching & Auto-Refresh
- **File:** `token-proxy.js:81-153`
- Caches OAuth2 tokens server-side.
- Only fetches a new token when the cached one is within **60 seconds** of expiry.
- Supports credential overrides via `X-BTP-Client-ID`, `X-BTP-Client-Secret` HTTP headers.

### 9. Port Conflict Resolution
- **File:** `token-proxy.js:37-78`
- On startup, auto-detects if port 3002 is already in use.
- Kills the occupying process using `lsof` or `fuser`.
- Waits 800ms before listening on the freed port.

### 10. Push-to-CPI CLI Tool
- **File:** `backend/push-to-cpi.js`
- Reads a JSON file, obtains OAuth token from proxy, pushes data to CPI write endpoint.
- Optionally notifies CAP and backend with the CPI message ID.
- Usage: `node push-to-cpi.js sample-data.json Ledgers`

### 11. Watch Ingest (File Watcher)
- **File:** `backend/watch-ingest.js`
- Monitors `backend/incoming/` every **5 seconds** for new `.json` files.
- Auto-processes via `push-to-cpi.js`.
- Moves successful files to `incoming/processed/`, failures to `incoming/failed/`.
- Supports data type detection from filename prefixes (`Ledgers_*.json`, `Vouchers_*.json`, `StockItems_*.json`).

### 12. Data Normalization (Advanced Payload Handling)
- **File:** `backend/src/routes/index.js:52-135`
- The `addVersion` function handles multiple data shapes:
  - Direct arrays or objects with `.data`, `.value`, `.entries`, `.records` properties.
  - Nested "all" payloads: `{ data: { ledgers: [], vouchers: [], stockItems: [] } }`.
  - Auto-flattens nested structures into unified arrays.
  - Extracts company name from data or falls back to previous version.
  - Computes summary statistics (totals, amounts, counts by type).

### 13. Dashboard Search
- **File:** `webapp/controller/View1.controller.js:172-189`
- Each table tab has a search field that filters its respective table.
- Uses `FilterOperator.Contains` on the relevant field (name, partyName, stockName, syncId).

### 14. Currency Formatting (Indian Rupee)
- **File:** `webapp/controller/View1.controller.js:299-332`
- Indian number formatting with `en-IN` locale.
- Balance state coloring: positive = Success (green), negative = Error (red).
- Date formatting and boolean display utilities.

### 15. OData v4 Endpoints
- **File:** `backend/src/routes/index.js:219-289`
- Four OData v4 endpoints serving the UI5 frontend.
- Support `$top`, `$filter`, `syncId`, `company` query parameters.
- Data is sorted by `pushedAt` descending.

### 16. Summary Header Panel
- **File:** `webapp/view/View1.view.xml`
- Displays counts of Ledgers, Vouchers, and Stock Items from the latest sync.
- Shows company name and last-refreshed timestamp.

---

## API Endpoints Reference

### REST Endpoints (Backend — Port 3003)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server status, version count, last sync timestamp |
| GET | `/api/versions` | All ingested version summaries |
| GET | `/api/versions/:id` | Single version detail (full raw data) |
| GET | `/api/companies` | Distinct company names from ingested data |
| GET | `/api/http/read-tally` | Fetch directly from CPI and ingest |
| POST | `/api/sync/btp-fetch` | Manual sync trigger (fetch CPI → dedup → ingest → refresh) |
| POST | `/api/refresh` | Refresh latest version from store |

### OData v4 Endpoints (Backend — Port 3003)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/odata/v4/tally/Syncs` | Full BTP sync history (sorted by `pushedAt` desc) |
| GET | `/odata/v4/tally/Ledgers` | Consolidated ledger records |
| GET | `/odata/v4/tally/Vouchers` | Consolidated voucher records |
| GET | `/odata/v4/tally/StockItems` | Consolidated stock item records |

**OData Query Parameters:** `$top`, `$filter`, `syncId`, `company`

### Token Proxy Endpoints (Port 3002)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/token` | Obtain/cached OAuth2 token from BTP UAA |
| GET | `/api/*` | Proxy requests to CPI API with Bearer token |
| POST | `/api/http/tally-write` | Push data to CPI Data Store |

---

## Processes & Startup

Three processes must be running simultaneously:

```bash
# Terminal 1 — Token Proxy (port 3002)
node token-proxy.js

# Terminal 1 (separate tab) — Backend Server (port 3003)
node backend/src/server.js

# Terminal 2 — UI5 Frontend (auto-opens browser)
npm start
```

The **ui5.yaml** middleware proxies:
- `/token` → `localhost:3002`
- `/api/*`, `/odata/*` → `localhost:3003`

### Testing the Write → Read Flow

```bash
# Push sample data to CPI
node backend/push-to-cpi.js backend/sample-data.json Ledgers

# Then either:
#   Wait 5min for auto-sync, or
#   Click "Fetch from BTP" in the dashboard
```

### Key Environment Variables (`.env`)

| Variable | Description |
|----------|-------------|
| `BTP_CLIENT_ID` | SAP BTP OAuth client ID |
| `BTP_CLIENT_SECRET` | SAP BTP OAuth client secret |
| `BTP_TOKEN_URL` | BTP UAA OAuth token endpoint |
| `BTP_CPI_API_BASE` | CPI runtime API base URL |

### SAP CPI Data Store Configuration

| Setting | Value |
|---------|-------|
| Name | `TALLY_DATA` |
| Visibility | Global |
| Max Entries | 100 |
| Delete On Completion | Off |
| Throw Exception if No Entry Found | Off |

---

## Testing

### Unit Tests (QUnit)
- **File:** `webapp/test/unit/controller/View1.controller.js`
- Tests controller formatting functions and data handling.
- Run: `npm run unit-test`

### Integration Tests (OPA5)
- **File:** `webapp/test/integration/`
- Tests navigation journey and page rendering.
- Run: `npm run int-test`

---

## Key Design Decisions

- **Flat-file persistence** (`store.json`) instead of a database — simple, portable, zero setup.
- **In-memory version tracking** with periodic disk saves — fast reads, crash-safe writes.
- **Token proxy as a separate process** — isolates OAuth2 credential management and avoids CORS issues.
- **SHA-256 fingerprint fallback** — ensures deduplication even when CPI message IDs are unavailable.
- **Schema-agnostic frontend** — handles any Tally data shape without code changes via dynamic field inspection.
- **Multiple data shape support** — ingestion handles arrays, nested objects, flat objects, and mixed types.
- **Indian locale (en-IN)** — currency and date formatting throughout the dashboard.
