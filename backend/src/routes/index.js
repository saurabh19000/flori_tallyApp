const { Router } = require("express");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const istTimestamp = require("../helpers/istTimestamp");

const STORE_FILE = path.join(__dirname, "..", "..", "data", "store.json");
const TOKEN_PROXY = "localhost:3002";

let dataVersions = [];
let versionCounter = 0;

function loadStore() {
    try {
        if (fs.existsSync(STORE_FILE)) {
            var raw = fs.readFileSync(STORE_FILE, "utf8");
            var store = JSON.parse(raw);
            dataVersions = store.dataVersions || [];
            versionCounter = store.versionCounter || 0;
            console.log("[store] Loaded " + dataVersions.length + " versions from " + STORE_FILE);
        }
    } catch (err) {
        console.error("[store] Load error:", err.message);
    }
}

function saveStore() {
    try {
        var dir = path.dirname(STORE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(STORE_FILE, JSON.stringify({ dataVersions: dataVersions, versionCounter: versionCounter }, null, 2));
    } catch (err) {
        console.error("[store] Save error:", err.message);
    }
}

loadStore();

function generateFingerprint(data) {
    const content = JSON.stringify({
        company: data.company,
        type: data.dataType,
        records: data.data ? data.data.length : 0,
        firstRecord: data.data && data.data.length > 0 ? data.data[0] : null
    });
    return crypto.createHash("sha256").update(content).digest("hex").substring(0, 16);
}

function addVersion(data) {
    try {
        let rawData = [];
        
        // --- ADVANCED DATA NORMALIZATION (Handles nested "all" payloads) ---
        if (Array.isArray(data)) {
            rawData = data;
        } else if (data && typeof data === "object") {
            let innerData = data.data || data.value || data.entries || data.records;
            
            if (Array.isArray(innerData)) {
                rawData = innerData;
            } else if (innerData && typeof innerData === "object") {
                // Flatten the nested structure (e.g., data: { ledgers: [], vouchers: [] })
                let flattened = [];
                if (Array.isArray(innerData.ledgers)) flattened = flattened.concat(innerData.ledgers);
                if (Array.isArray(innerData.vouchers)) flattened = flattened.concat(innerData.vouchers);
                if (Array.isArray(innerData.stockItems)) flattened = flattened.concat(innerData.stockItems);
                
                // If we successfully flattened arrays, use them. Otherwise, wrap the object.
                rawData = flattened.length > 0 ? flattened : [innerData];
            } else {
                 rawData = [data]; // Fallback
            }
        }

        let company = data.company || "";
        if (!company && rawData.length > 0) {
            for (let i = 0; i < Math.min(rawData.length, 5); i++) {
                company = rawData[i].company || rawData[i].companyName || rawData[i].CompanyName || "";
                if (company) break;
            }
        }
        if (!company) company = dataVersions.length > 0 ? dataVersions[dataVersions.length - 1].company : "Unknown";

        const dataType = data.dataType || "TallyData";
        const syncId = data.syncId || data.cpiMessageId || ("hash-" + generateFingerprint({ company, dataType, data: rawData }));

        const existing = dataVersions.find(v => v.syncId === syncId);
        if (existing) {
            console.log(`[backend] SKIP: Version with SyncID ${syncId} already exists.`);
            return existing;
        }

        versionCounter++;
        const summary = {
            totalRecords: rawData.length,
            totalLedgers: dataType.toLowerCase().includes("ledger") ? rawData.length : 0,
            totalVouchers: dataType.toLowerCase().includes("voucher") ? rawData.length : 0,
            totalStockItems: dataType.toLowerCase().includes("stock") ? rawData.length : 0,
            totalAmount: 0
        };
        
        if (data.summary) {
            Object.assign(summary, data.summary);
        } else {
            try {
                summary.totalAmount = rawData.reduce((sum, item) => sum + (parseFloat(item.netAmount || item.closingBalance || item.amount || 0)), 0);
            } catch (e) {}
        }

        const version = {
            id: versionCounter,
            company: company,
            dataType: dataType,
            syncId: syncId,
            cpiMessageId: data.cpiMessageId || (syncId.startsWith("hash-") ? null : syncId),
            cpiDataStoreId: data.cpiDataStoreId || null,
            cpiPushDate: data.cpiPushDate || new Date().toISOString(),
            totalRecords: summary.totalRecords,
            timestamp: data.cpiPushDate || data.timestamp || istTimestamp(), // PRIORITY FIX: Use BTP push date for absolute chronological accuracy
            summary: summary,
            data: rawData
        };

        dataVersions.push(version);
        saveStore();
        console.log(`[backend] COMMITTED: Version ${version.id} [${company}] - ${version.totalRecords} records.`);
        return version;
    } catch (err) {
        console.error("[backend] INGESTION ERROR:", err.message);
        return null;
    }
}

function fetchFromCpi(dataStoreId) {
    return new Promise(function (resolve) {
        const url = `http://${TOKEN_PROXY}/api/http/read-tally${dataStoreId ? "?storeId=" + encodeURIComponent(dataStoreId) : ""}`;
        http.get(url, function (res) {
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", function () {
                if (res.statusCode !== 200) return resolve({ data: [], error: "HTTP_" + res.statusCode });
                try { resolve(JSON.parse(data || "{}")); } catch (e) { resolve({ data: [], error: "INVALID_JSON" }); }
            });
        }).on("error", (err) => resolve({ data: [], error: "PROXY_OFFLINE" }));
    });
}

function fetchFreshFromCpi(dataStoreId) {
    return new Promise(function (resolve) {
        const url = `http://${TOKEN_PROXY}/api/http/read-tally${dataStoreId ? "?storeId=" + encodeURIComponent(dataStoreId) : ""}`;
        http.get(url, function (res) {
            let raw = "";
            res.on("data", (chunk) => raw += chunk);
            res.on("end", function () {
                const meta = { cpiMessageId: res.headers["sap_messageprocessinglogid"] || res.headers["sap-message-id"] || null, status: res.statusCode };
                if (res.statusCode !== 200) return resolve({ meta, body: [], error: "HTTP_" + res.statusCode });
                try { resolve({ meta, body: JSON.parse(raw || "[]") }); } catch (e) { resolve({ meta, body: [], error: "JSON_PARSE_ERROR" }); }
            });
        }).on("error", (err) => resolve({ meta: {}, body: [], error: "PROXY_OFFLINE" }));
    });
}

const router = Router();

router.get("/versions", (req, res) => res.json(dataVersions.map(v => ({ id: v.id, timestamp: v.timestamp, syncId: v.syncId, company: v.company, dataType: v.dataType, totalRecords: v.totalRecords }))));
router.get("/versions/:id", (req, res) => { const v = dataVersions.find(v => v.id === parseInt(req.params.id)); v ? res.json(v) : res.status(404).json({ error: "Not found" }); });

function getLatestVersion(companyFilter) {
    if (dataVersions.length === 0) return null;
    let filtered = dataVersions;
    if (companyFilter) {
        filtered = dataVersions.filter(v => v.company === companyFilter);
    }
    if (filtered.length === 0) return null;
    return filtered.slice().sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))[0];
}

router.get("/http/read-tally", function (req, res) {
    const company = req.query.company;
    fetchFromCpi(null).then(data => {
        if (data.error) return res.json(getLatestVersion(company) || { data: [] });
        const v = addVersion(data);
        res.json(v || getLatestVersion(company) || { data: [] });
    });
});

router.post("/sync/btp-fetch", function (req, res) {
    fetchFreshFromCpi(null).then(function (result) {
        if (result.error) return res.status(200).json({ success: false, error: "BTP Sync Exception", details: result.error });
        const body = result.body;
        const meta = result.meta;
        const items = Array.isArray(body) ? body : [body];
        let addedCount = 0;
        let skippedCount = 0;
        items.forEach(item => {
            const syncId = item.syncId || item.cpiMessageId || meta.cpiMessageId;
            console.log("[debug-sync] Received ID from BTP:", syncId, "Company:", item.company);
            const isDup = dataVersions.some(v => v.cpiMessageId === syncId || v.syncId === syncId);
            if (!isDup && (Array.isArray(item) || (item && (item.data || item.company)))) {
                if (addVersion(item)) addedCount++; else skippedCount++;
            } else { skippedCount++; }
        });
        res.json({ success: true, status: "Verification Complete", totalAnalyzed: items.length, newVersions: addedCount, duplicatesSkipped: skippedCount, message: addedCount > 0 ? `Success: ${addedCount} documents verified and synced.` : "Verification complete: No new data found." });
    }).catch(err => res.json({ success: false, error: "Global Sync Exception", details: err.message }));
});

router.get("/companies", (req, res) => {
    const companies = [...new Set(dataVersions.map(v => v.company).filter(Boolean))];
    res.json({ success: true, companies: companies });
});

router.post("/refresh", (req, res) => { const latest = getLatestVersion(req.query.company) || {}; res.json({ success: true, timestamp: latest.timestamp, syncId: latest.syncId, records: latest.totalRecords }); });

router.get("/health", (_req, res) => { const latest = getLatestVersion(_req.query.company) || {}; res.json({ status: "ok", versions: dataVersions.length, lastSync: latest.timestamp, syncId: latest.syncId, records: latest.totalRecords, company: latest.company }); });

const odataRouter = Router();

odataRouter.get("/v4/tally/Syncs", (req, res) => {
    let filtered = dataVersions;
    if (req.query.company) {
        filtered = dataVersions.filter(v => v.company === req.query.company);
    }
    const sorted = filtered.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const top = parseInt(req.query.$top, 10) || sorted.length;
    res.json({ value: sorted.slice(0, top).map(v => {
        const s = v.summary || {};
        return { syncId: v.cpiMessageId || v.syncId || "—", versionId: v.id, company: v.company, dataType: v.dataType, totalRecords: v.totalRecords, cpiMessageId: v.cpiMessageId, pushedAt: v.timestamp, date: v.timestamp ? v.timestamp.split("T")[0] : null, totalLedgers: s.totalLedgers || 0, totalVouchers: s.totalVouchers || 0, totalAmount: s.totalAmount || 0 };
    }) });
});

odataRouter.get("/v4/tally/Ledgers", (req, res) => {
    let seen = {}; let ledgers = [];
    const targetSyncId = req.query.syncId || (getLatestVersion(req.query.company) ? getLatestVersion(req.query.company).syncId : null);

    if (targetSyncId) {
        const targetVersions = dataVersions.filter(v => v.syncId === targetSyncId);
        for (let i = targetVersions.length - 1; i >= 0; i--) {
            const v = targetVersions[i];
            (v.data || []).forEach(d => {
                if (d.name || d.parentGroup) {
                    const key = d.name + "|" + (d.parentGroup || "");
                    if (!seen[key]) { seen[key] = true; ledgers.push(Object.assign({}, d, { syncId: v.cpiMessageId || v.syncId || "—", syncDate: v.timestamp })); }
                }
            });
        }
    }
    res.json({ value: ledgers.sort((a, b) => (a.name || "").localeCompare(b.name || "")) });
});

odataRouter.get("/v4/tally/Vouchers", (req, res) => {
    let seen = {}; let vouchers = [];
    const targetSyncId = req.query.syncId || (getLatestVersion(req.query.company) ? getLatestVersion(req.query.company).syncId : null);

    if (targetSyncId) {
        const targetVersions = dataVersions.filter(v => v.syncId === targetSyncId);
        for (let i = targetVersions.length - 1; i >= 0; i--) {
            const v = targetVersions[i];
            (v.data || []).forEach(d => {
                if (d.voucherDate || d.partyName || d.voucherNumber) {
                    const key = d.guid || (d.voucherNumber + "|" + d.partyName);
                    if (!seen[key]) { seen[key] = true; vouchers.push(Object.assign({}, d, { syncId: v.cpiMessageId || v.syncId || "—", syncDate: v.timestamp })); }
                }
            });
        }
    }
    res.json({ value: vouchers.sort((a, b) => (b.voucherDate || "").localeCompare(a.voucherDate || "")) });
});

odataRouter.get("/v4/tally/StockItems", (req, res) => {
    let seen = {}; let items = [];
    const targetSyncId = req.query.syncId || (getLatestVersion(req.query.company) ? getLatestVersion(req.query.company).syncId : null);

    if (targetSyncId) {
        const targetVersions = dataVersions.filter(v => v.syncId === targetSyncId);
        for (let i = targetVersions.length - 1; i >= 0; i--) {
            const v = targetVersions[i];
            (v.data || []).forEach(d => {
                if (d.stockName || d.rate || d.quantity) {
                    const key = d.guid || d.stockName || JSON.stringify(d);
                    if (!seen[key]) { seen[key] = true; items.push(Object.assign({}, d, { syncId: v.cpiMessageId || v.syncId || "—", syncDate: v.timestamp })); }
                }
            });
        }
    }
    res.json({ value: items.sort((a, b) => (a.stockName || "").localeCompare(b.stockName || "")) });
});

module.exports = { router, odataRouter, addVersion, fetchFromCpi, dataVersions };
