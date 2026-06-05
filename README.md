# Tally Dashboard - SAP BTP Integration

A resilient, full-stack application for visualizing Tally data (Ledgers, Vouchers, Stock Items) synchronized through SAP BTP Integration Suite (CPI).

## 🚀 Architecture Overview

This project uses a **Triple-Tier Resilient Architecture** to ensure data accuracy and system stability.

1.  **UI5 Frontend (webapp):** A Fiori-based dashboard that displays data using OData v4.
2.  **Node.js Backend (backend):** Manages local versioning, data normalization (Universal Adapter), and OData services.
3.  **Token Proxy (token-proxy.js):** Handles OAuth2 authentication with SAP BTP and acts as a CORS-compliant gateway to CPI.

---

## 💎 Key Bullet Features

*   **Universal Data Adapter:** The backend automatically detects and normalizes various JSON structures (Flat arrays, nested objects, or single records) without manual configuration.
*   **Self-Healing Sync:** If SAP BTP credentials change or the cloud service is unavailable, the system catches exceptions and falls back to the last known "Good State" instead of crashing.
*   **OAuth2 Proxy Layer:** Bypasses browser CORS restrictions by handling BTP service key authentication on the server-side.
*   **OData v4 Compliant:** Exposes Tally data via standardized OData endpoints for seamless UI5 integration.
*   **Discovery Fetch:** A manual trigger that scans the SAP BTP Data Store for fresh records and auto-adds them to the local history.
*   **Safe Groovy Ingestion:** Includes an optimized Groovy script for SAP CPI that ensures special characters in Tally data don't break JSON parsing.

---

## ⚙️ Configuration

To switch between SAP BTP accounts, update the following fields in **`token-proxy.js`**:

```javascript
const CLIENT_ID     = "your-client-id";
const CLIENT_SECRET = "your-client-secret";
const TOKEN_URL     = "https://...authentication.../oauth/token";
const CPI_API_BASE  = "https://...it-cpitrial...hana.ondemand.com";
```

---

## 🛠️ Setup & Running

### 1. Start the Token Proxy
Handles BTP authentication and API forwarding.
```bash
node token-proxy.js
```

### 2. Start the Backend Server
Handles data versioning and OData services.
```bash
# From the project root
npm run start-backend
```

### 3. Launch the Dashboard
Starts the UI5 application.
```bash
# From the project root
npm start
```

---

## 📡 API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/sync/btp-fetch` | POST | Triggers a manual sync from SAP BTP. |
| `/api/http/read-tally` | GET | Fetches the latest normalized data version. |
| `/odata/v4/tally/Syncs` | GET | OData endpoint for sync history. |
| `/odata/v4/tally/Ledgers` | GET | OData endpoint for all synchronized ledgers. |

---

## 🛡️ Exception Handling & Resilience
The system is built to handle the following "Failure States" gracefully:
*   **`PROXY_OFFLINE`**: Dashboard stays alive; shows local data only.
*   **`BTP_UNAVAILABLE`**: (HTTP 401/500/502) UI shows a user-friendly tip instead of crashing.
*   **`INVALID_JSON`**: The Universal Adapter ignores corrupted records but preserves the rest of the sync.
*   **`DUPLICATE_ID`**: Prevents the same SAP Message ID from being ingested multiple times.

---
*Created and Optimized for SAP BTP Integration Workflows.*
