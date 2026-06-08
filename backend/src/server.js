const express = require("express");
const cors = require("cors");
const { router, odataRouter } = require("./routes");

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/api", router);
app.use("/odata", odataRouter);

// ── AUTO-SYNC ENGINE (Background Worker) ───────────────────────────────────
const { fetchFreshFromCpi, addVersion, dataVersions } = require("./routes");

function startAutoSync() {
    const SYNC_INTERVAL = 5 * 60 * 1000; // 5 Minutes
    console.log(`[auto-sync] Engine started (Interval: 5m)`);

    setInterval(async () => {
        console.log("[auto-sync] Checking for new data in SAP BTP...");
        try {
            const result = await fetchFreshFromCpi(null);
            if (result.error) return;

            const body = result.body;
            console.log("[auto-sync] RAW DATA FROM BTP:", JSON.stringify(body, null, 2));
            const meta = result.meta;
            const items = Array.isArray(body) ? body : [body];
            
            let newDocs = 0;
            items.forEach(item => {
                const syncId = item.syncId || item.cpiMessageId || meta.cpiMessageId;
                const isDup = dataVersions.some(v => v.syncId === syncId);
                
                if (!isDup && (item.data || item.company)) {
                    if (addVersion(item)) newDocs++;
                }
            });

            if (newDocs > 0) {
                console.log(`[auto-sync] Success: ${newDocs} new documents auto-ingested.`);
            }
        } catch (err) {
            console.error("[auto-sync] Background task failed:", err.message);
        }
    }, SYNC_INTERVAL);
}

app.listen(PORT, () => {
    console.log("──────────────────────────────────────────────");
    console.log("  Tally Backend  →  http://localhost:" + PORT);
    // ... (rest of the logs)
    console.log("──────────────────────────────────────────────");
    
    startAutoSync();
});
