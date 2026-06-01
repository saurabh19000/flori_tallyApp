How to Connect Your Local Push to the Dashboard
=================================================

Your current push process sends data from Tally to SAP BTP CPI.
After that push succeeds, add ONE HTTP call to update the
dashboard with the real CPI message ID and the latest data.

1. Push Your Data
------------------
Run your existing push process that sends Tally data to CPI.

2. Add the Curl Call
---------------------
After your CPI upload succeeds, call our backend:

  curl -X POST http://localhost:3001/api/push/ledgers \
    -H "Content-Type: application/json" \
    -d '{
      "syncId": "<CPI_MESSAGE_GUID>",
      "company": "Aa",
      "totalRecords": 6,
      "summary": {"totalLedgers":6,"partyLedgers":0,"withGstin":0,"withEmail":0,"totalBalance":1067538},
      "data": [... your full ledger array ...]
    }'

What to change:
  - <CPI_MESSAGE_GUID> — paste the actual CPI message GUID
    (e.g. "8507b297-a635-45fd-996f-aaf9a9650fb6")
  - company, totalRecords, summary, data — use your actual values

Data type endpoints (pick the right one):
  - Ledgers:      POST /api/push/ledgers
  - Vouchers:     POST /api/push/vouchers
  - Stock Items:  POST /api/push/stock-items
  - Generic:      POST /api/push (must include "dataType" in body)

3. Refresh the Dashboard
-------------------------
Click the "Refresh" button on the Fiori dashboard.
This now calls POST /api/refresh which re-fetches the
latest data from CPI and updates the cache.

That is all. Your dashboard will now show:
  - The latest data from CPI
  - The exact CPI message GUID as the Sync ID
