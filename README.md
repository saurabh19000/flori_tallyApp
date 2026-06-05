# Tally Intelligence Dashboard - SAP BTP Integration

A production-grade, full-stack application for visualizing Tally data (Ledgers, Vouchers, Stock Items) seamlessly synchronized through SAP BTP Integration Suite (CPI).

---

## 🚀 Architecture Overview

This project uses a **Triple-Tier Resilient Architecture** bridging local data and the SAP Cloud.

1. **UI5 Frontend (`webapp/`):** A responsive SAP Fiori dashboard displaying consolidated master data using OData v4, featuring dynamic field inspection.
2. **Node.js Backend (`backend/`):** A smart, self-healing server that handles Auto-Syncing, Atomic Deduplication, and OData service generation.
3. **Token Proxy (`token-proxy.js`):** A security gateway that manages BTP OAuth2 Service Keys and proxies HTTPS requests to bypass browser CORS restrictions.
4. **SAP CPI Middleware (`groovy/ReadFlowProcessor.groovy`):** An optimized, streaming-compliant Groovy script that safely extracts JSON payloads wrapped in XML `<![CDATA[...]]>` blocks directly from the SAP Data Store.

---

## 💎 Key Bullet Features

*   **🤖 Auto-Sync Engine:** A background worker runs every 5 minutes, silently checking SAP BTP for new documents and ingesting them automatically. No manual intervention required.
*   **🎯 Production Accuracy Protocol:** Prevents double-counting and data mismatch by extracting the absolute true SAP Message ID (MPL ID) from the cloud payload, ensuring 100% accurate deduplication.
*   **⚡ Dynamic Schema Explorer:** The dashboard is schema-agnostic. A "Full Record Inspector" button dynamically scans incoming records and generates UI fields automatically. If a new custom field is added in Tally, it instantly appears in the UI without any code changes.
*   **🔄 Dual-Mode Synchronization:** Combines the convenience of the 5-minute Auto-Sync Engine with a manual "Fetch from BTP" button for instant, on-demand data retrieval and UI auto-refresh.
*   **🛡️ Self-Healing & Resilience:** Never crashes on bad credentials, expired tokens, or empty Data Stores. Automatically falls back to local data (`store.json`) if BTP is unreachable.
*   **📦 CDATA XML Handling:** Designed to process multi-line Tally JSON data securely wrapped in XML `<entry><value><![CDATA[...]]></value></entry>` tags, avoiding standard SAP CPI XML parser crashes (Code 123).

---

## ⚙️ Configuration & Credentials

The application uses an SAP BTP Service Key. To switch BTP accounts, update the following 4 fields in **`token-proxy.js`**:

```javascript
const CLIENT_ID     = "your-client-id";
const CLIENT_SECRET = "your-client-secret";
const TOKEN_URL     = "https://<your-subaccount>.authentication.../oauth/token";
const CPI_API_BASE  = "https://<your-cpi-tenant>-rt.cfapps...hana.ondemand.com";
```

### Important SAP CPI Read Flow Configuration:
For the API to fetch data successfully, ensure your **Data Store Select** step in SAP CPI is configured as follows:
- **Data Store Name:** `TALLY_DATA`
- **Visibility:** `Global`
- **Max. Number of Entries:** `100` (Crucial for retrieving the latest documents)
- **Delete On Completion:** Unchecked (Off)
- **Throw Exception if No Entry Found:** Unchecked (Off)

---

## 🛠️ How to Run Locally (End-to-End)

To start the entire application stack, open **two separate terminal windows** at the project root.

### Terminal 1: Start the Security Proxy & Backend
Run the proxy and backend servers simultaneously. The backend will automatically start the 5-minute Auto-Sync Engine.
```bash
# Start the Token Proxy (runs on port 3002)
node token-proxy.js

# (In another tab/background) Start the Backend Server (runs on port 3003)
node backend/src/server.js
```

### Terminal 2: Launch the Fiori Dashboard
Start the UI5 development server. This will open the dashboard in your default web browser.
```bash
npm start
```

---

## 📡 API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/sync/btp-fetch` | POST | Triggers a manual sync, checks for duplicates, and auto-ingests new data. |
| `/api/health` | GET | Returns the status, version count, and last sync timestamp. |
| `/odata/v4/tally/Syncs` | GET | OData endpoint displaying the full BTP synchronization history. |
| `/odata/v4/tally/Ledgers` | GET | OData endpoint for all consolidated ledger records. |
| `/odata/v4/tally/Vouchers` | GET | OData endpoint for all consolidated voucher records. |

---

## 🧪 Testing the Integration

You can manually simulate a Tally data push using the provided CLI helper tool to ensure the Write and Read flows are functioning correctly:

```bash
# Pushes a 5-record dummy payload to SAP BTP via the token proxy
node backend/push-to-cpi.js backend/sample-data.json Ledgers
```
Once pushed, either wait 5 minutes for the Auto-Sync Engine to pick it up, or click the **"Fetch from BTP"** button in the dashboard to see it immediately.

---
*Architected and Optimized for High-Accuracy SAP BTP Integration Workflows.*