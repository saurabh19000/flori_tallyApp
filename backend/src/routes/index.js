const { Router } = require("express");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const istTimestamp = require("../helpers/istTimestamp");

const STORE_FILE = path.join(__dirname, "..", "..", "data", "store.json");

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

function addVersion(data) {
    try {
        versionCounter++;
        
        // --- UNIVERSAL DATA ADAPTER ---
        // This ensures that regardless of the data shape, we extract something meaningful.
        let rawData = [];
        let summary = { totalRecords: 0, totalLedgers: 0, totalAmount: 0 };
        
        if (Array.isArray(data)) {
            rawData = data;
        } else if (data && typeof data === "object") {
            // Try to find the data array in common fields
            rawData = data.data || data.value || data.entries || data.records || [];
            // If data is just a single object and not an array, wrap it
            if (!Array.isArray(rawData) && typeof rawData === "object") rawData = [rawData];
        }

        const company = data.company || (dataVersions.length > 0 ? dataVersions[dataVersions.length - 1].company : "Unknown");
        const dataType = data.dataType || "Discovery";

        // Auto-calculate summary if missing
        summary.totalRecords = data.totalRecords || rawData.length;
        if (data.summary) {
            Object.assign(summary, data.summary);
        } else {
            summary.totalLedgers = dataType === "Ledgers" ? rawData.length : 0;
            // Attempt to sum up netAmount or closingBalance if available
            try {
                summary.totalAmount = rawData.reduce((sum, item) => sum + (parseFloat(item.netAmount || item.closingBalance || 0)), 0);
            } catch (e) {}
        }

        const version = {
            id: versionCounter,
            company: company,
            dataType: dataType,
            syncId: data.syncId || data.cpiMessageId || "sid-" + Date.now(),
            cpiMessageId: data.cpiMessageId || null,
            cpiDataStoreId: data.cpiDataStoreId || null,
            cpiPushDate: data.cpiPushDate || new Date().toISOString(),
            totalRecords: summary.totalRecords,
            timestamp: data.timestamp || istTimestamp(),
            summary: summary,
            data: rawData
        };

        dataVersions.push(version);
        saveStore();
        console.log(`[backend] SUCCESS: Version ${version.id} added (${version.totalRecords} records for ${version.company})`);
        return version;
    } catch (err) {
        console.error("[backend] CRITICAL: Data normalization failed:", err.message);
        // Fallback to a safe empty version instead of throwing
        return { id: 0, company: "Error", data: [], summary: {} };
    }
}

function fetchFromCpi(dataStoreId) {
    return new Promise(function (resolve) {
        const url = `http://${TOKEN_PROXY}/api/http/read-tally${dataStoreId ? "?storeId=" + encodeURIComponent(dataStoreId) : ""}`;
        
        http.get(url, function (res) {
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", function () {
                if (res.statusCode !== 200) {
                    console.error(`[backend] BTP Fetch Error: HTTP ${res.statusCode}`);
                    return resolve({ data: [], error: "BTP_UNAVAILABLE" });
                }
                try {
                    resolve(JSON.parse(data || "{}"));
                } catch (e) {
                    console.error("[backend] BTP returned invalid JSON");
                    resolve({ data: [], error: "INVALID_JSON" });
                }
            });
        }).on("error", (err) => {
            console.error("[backend] Connection to Proxy failed:", err.message);
            resolve({ data: [], error: "PROXY_OFFLINE" });
        });
    });
}

function fetchFreshFromCpi(dataStoreId) {
    return new Promise(function (resolve) {
        const url = `http://${TOKEN_PROXY}/api/http/read-tally${dataStoreId ? "?storeId=" + encodeURIComponent(dataStoreId) : ""}`;
        
        http.get(url, function (res) {
            let raw = "";
            res.on("data", (chunk) => raw += chunk);
            res.on("end", function () {
                const meta = {
                    cpiMessageId: res.headers["sap_messageprocessinglogid"] || res.headers["sap-message-id"] || null,
                    status: res.statusCode
                };

                if (res.statusCode !== 200) {
                    return resolve({ meta, body: [], error: "HTTP_" + res.statusCode });
                }
                try {
                    resolve({ meta, body: JSON.parse(raw || "[]") });
                } catch (e) {
                    resolve({ meta, body: [], error: "JSON_PARSE_ERROR" });
                }
            });
        }).on("error", (err) => {
            resolve({ meta: {}, body: [], error: "PROXY_OFFLINE" });
        });
    });
}

const router = Router();

// ... (GET /versions and GET /versions/:id remain largely the same)

router.get("/http/read-tally", function (req, res) {
    // Self-healing: Always return SOMETHING valid
    fetchFromCpi(null).then(data => {
        if (data.error) {
            console.log("[backend] Fetch failed, serving last known good data");
            return res.json(dataVersions[dataVersions.length - 1] || { data: [] });
        }
        const v = addVersion(data);
        res.json(v);
    });
});

router.post("/sync/btp-fetch", function (req, res) {
    console.log("[manual-sync] Discovery mode triggered...");

    fetchFreshFromCpi(null)
        .then(function (result) {
            if (result.error) {
                return res.status(200).json({
                    success: false,
                    error: "BTP Sync Exception",
                    details: result.error,
                    tip: "Check your BTP Credentials in token-proxy.js. Ensure the Proxy is running."
                });
            }

            const body = result.body;
            const meta = result.meta;
            const items = Array.isArray(body) ? body : [body];
            
            let count = 0;
            items.forEach(item => {
                const syncId = item.syncId || item.cpiMessageId || meta.cpiMessageId;
                const isDup = dataVersions.some(v => v.syncId === syncId);
                if (!isDup && (Array.isArray(item) || item.data || item.company)) {
                    addVersion(item);
                    count++;
                }
            });

            res.json({
                success: true,
                totalFound: items.length,
                newVersions: count,
                message: `Discovery complete. ${count} versions added.`
            });
        })
        .catch(err => {
            res.json({ success: false, error: "Global Sync Exception", details: err.message });
        });
});

router.post("/refresh", function (req, res) {
    var latest = dataVersions[dataVersions.length - 1] || {};
    console.log("[backend] Refresh triggered — " + dataVersions.length + " versions available");
    res.json({ success: true, timestamp: latest.timestamp, syncId: latest.syncId, records: latest.totalRecords });
});

router.get("/health", function (_req, res) {
    var latest = dataVersions[dataVersions.length - 1] || {};
    res.json({
        status: "ok",
        versions: dataVersions.length,
        lastSync: latest.timestamp,
        syncId: latest.syncId,
        records: latest.totalRecords,
        dataType: latest.dataType,
        company: latest.company
    });
});

// ── OData v4 endpoints (for Fiori frontend) ─────────────────────────────────

const odataRouter = Router();

odataRouter.get("/v4/tally/Syncs", function (req, res) {
    var sorted = dataVersions.slice().sort(function (a, b) {
        return b.timestamp.localeCompare(a.timestamp);
    });
    var top = parseInt(req.query.$top, 10) || sorted.length;
    var result = sorted.slice(0, top).map(function (v) {
        return {
            syncId: v.cpiMessageId || v.syncId || "—",
            versionId: v.id,
            company: v.company,
            dataType: v.dataType,
            totalRecords: v.totalRecords,
            cpiMessageId: v.cpiMessageId,
            cpiDataStoreId: v.cpiDataStoreId,
            pushedAt: v.timestamp,
            date: v.timestamp ? v.timestamp.split("T")[0] : null,
            totalLedgers: v.summary.totalLedgers || 0,
            partyLedgers: v.summary.partyLedgers || 0,
            withGstin: v.summary.withGstin || 0,
            withEmail: v.summary.withEmail || 0,
            totalBalance: v.summary.totalBalance || 0,
            totalVouchers: v.summary.totalVouchers || 0,
            totalAmount: v.summary.totalAmount || 0,
            totalItems: v.summary.totalItems || 0,
            totalQuantity: v.summary.totalQuantity || 0
        };
    });
    res.json({ value: result });
});

odataRouter.get("/v4/tally/Ledgers", function (req, res) {
    var seen = {};
    var ledgers = [];
    for (var i = dataVersions.length - 1; i >= 0; i--) {
        var v = dataVersions[i];
        (v.data || []).forEach(function (d) {
            if (!d.name || d.voucherDate || d.voucherNumber) return;
            var key = d.name + "|" + (d.parentGroup || "");
            if (!seen[key]) {
                seen[key] = true;
                ledgers.push({
                    syncId: v.cpiMessageId || v.syncId || "—",
                    syncDate: v.timestamp,
                    name: d.name,
                    parentGroup: d.parentGroup,
                    type: d.type,
                    openingBalance: d.openingBalance,
                    closingBalance: d.closingBalance,
                    currency: d.currency || "INR",
                    countryCode: d.countryCode || "IN"
                });
            }
        });
    }
    ledgers.sort(function(a, b) { return a.name.localeCompare(b.name); });
    res.json({ value: ledgers });
});

odataRouter.get("/v4/tally/Vouchers", function (req, res) {
    var seen = {};
    var vouchers = [];
    for (var i = dataVersions.length - 1; i >= 0; i--) {
        var v = dataVersions[i];
        (v.data || []).forEach(function (d) {
            if (!d.voucherDate && !d.partyName) return;
            var key = d.guid || (d.voucherNumber + "|" + d.partyName);
            if (!seen[key]) {
                seen[key] = true;
                vouchers.push({
                    syncId: v.cpiMessageId || v.syncId || "—",
                    syncDate: v.timestamp,
                    guid: d.guid,
                    voucherDate: d.voucherDate,
                    voucherType: d.voucherType,
                    voucherNumber: d.voucherNumber,
                    referenceNo: d.referenceNo,
                    partyName: d.partyName,
                    narration: d.narration,
                    netAmount: d.netAmount,
                    lineItemCount: d.lineItemCount,
                    isInvoice: d.isInvoice,
                    isOptional: d.isOptional,
                    isPostDated: d.isPostDated
                });
            }
        });
    }
    vouchers.sort(function(a, b) { return (b.voucherDate || "").localeCompare(a.voucherDate || ""); });
    res.json({ value: vouchers });
});

odataRouter.get("/v4/tally/StockItems", function (req, res) {
    var seen = {};
    var items = [];
    for (var i = dataVersions.length - 1; i >= 0; i--) {
        var v = dataVersions[i];
        (v.data || []).forEach(function (d) {
            if (!d.stockName && !d.rate && !d.quantity) return;
            var key = d.guid || d.stockName || JSON.stringify(d);
            if (!seen[key]) {
                seen[key] = true;
                items.push({
                    syncId: v.cpiMessageId || v.syncId || "—",
                    syncDate: v.timestamp,
                    guid: d.guid,
                    stockName: d.stockName,
                    category: d.category,
                    rate: d.rate,
                    quantity: d.quantity,
                    unit: d.unit,
                    amount: d.amount,
                    openingStock: d.openingStock,
                    closingStock: d.closingStock
                });
            }
        });
    }
    items.sort(function(a, b) { return (a.stockName || "").localeCompare(b.stockName || ""); });
    res.json({ value: items });
});

module.exports = { router, odataRouter, addVersion, fetchFromCpi, dataVersions };
