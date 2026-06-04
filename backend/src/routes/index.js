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
    versionCounter++;
    var version = {
        id: versionCounter,
        company: data.company || "—",
        dataType: data.dataType || "—",
        syncId: data.syncId || null,
        cpiMessageId: data.cpiMessageId || null,
        cpiDataStoreId: data.cpiDataStoreId || null,
        cpiPushDate: data.cpiPushDate || null,
        totalRecords: data.totalRecords != null ? data.totalRecords : 0,
        timestamp: data.timestamp || istTimestamp(),
        summary: {
            totalLedgers: (data.summary && data.summary.totalLedgers) != null ? data.summary.totalLedgers : 0,
            partyLedgers: (data.summary && data.summary.partyLedgers) != null ? data.summary.partyLedgers : 0,
            withGstin: (data.summary && data.summary.withGstin) != null ? data.summary.withGstin : 0,
            withEmail: (data.summary && data.summary.withEmail) != null ? data.summary.withEmail : 0,
            totalBalance: (data.summary && data.summary.totalBalance) != null ? data.summary.totalBalance : 0
        },
        data: Array.isArray(data.data) ? data.data : []
    };
    if (!version.syncId) {
        version.syncId = contentFingerprint(version);
    }
    dataVersions.push(version);
    saveStore();
    console.log("[backend] Version " + version.id + " — " + version.company + " (" + version.totalRecords + " records) at " + version.timestamp);
    return version;
}

const TOKEN_PROXY = "localhost:3002";

function contentFingerprint(data) {
    var stable = {
        company: data.company,
        dataType: data.dataType,
        totalRecords: data.totalRecords,
        summary: {
            totalLedgers: data.summary && data.summary.totalLedgers,
            partyLedgers: data.summary && data.summary.partyLedgers,
            withGstin: data.summary && data.summary.withGstin,
            withEmail: data.summary && data.summary.withEmail,
            totalBalance: data.summary && data.summary.totalBalance
        },
        data: data.data
    };
    return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex").substring(0, 12);
}

function fetchFromCpi() {
    return new Promise(function (resolve, reject) {
        var req = http.get("http://" + TOKEN_PROXY + "/api/http/read-tally", function (res) {
            var data = "";
            var cpiStoreId = res.headers["sapdatastoreid"] || res.headers["sap_data_store_id"] || null;
            var cpiMsgLogId = res.headers["sap_messageprocessinglogid"] || null;
            res.on("data", function (chunk) { data += chunk; });
            res.on("end", function () {
                if (res.statusCode !== 200) {
                    return reject(new Error("CPI proxy returned " + res.statusCode));
                }
                try {
                    var parsed = JSON.parse(data);
                    if (cpiStoreId && !parsed.syncId) {
                        parsed.syncId = cpiStoreId;
                    }
                    resolve(parsed);
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on("error", reject);
        req.end();
    });
}

function fetchFreshFromCpi() {
    return new Promise(function (resolve, reject) {
        var req = http.get("http://" + TOKEN_PROXY + "/api/http/read-tally", function (res) {
            var raw = "";
            res.on("data", function (chunk) { raw += chunk; });
            res.on("end", function () {
                if (res.statusCode !== 200) {
                    return reject(new Error("CPI proxy returned " + res.statusCode));
                }
                try {
                    var body = JSON.parse(raw);
                    var meta = {
                        cpiMessageId:      res.headers["sap_messageprocessinglogid"] || null,
                        cpiDataStoreId:    res.headers["sapdatastoreid"] || null,
                        cpiRequestId:      res.headers["x-request-id"] || null,
                        cpiTimestamp:      res.headers["date"] || null,
                        cpiContentType:    res.headers["content-type"] || null
                    };
                    resolve({ meta: meta, body: body });
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on("error", reject);
        req.end();
    });
}

const router = Router();

router.get("/versions", function (req, res) {
    var list = dataVersions.map(function (v) {
        return {
            id: v.id,
            timestamp: v.timestamp,
            syncId: v.syncId,
            company: v.company,
            dataType: v.dataType,
            totalRecords: v.totalRecords
        };
    });
    res.json(list);
});

router.get("/versions/:id", function (req, res) {
    var id = parseInt(req.params.id, 10);
    var version = dataVersions.find(function (v) { return v.id === id; });
    if (!version) {
        return res.status(404).json({ error: "Version not found" });
    }
    res.json(version);
});

router.get("/http/read-tally", function (req, res) {
    var versionId = req.query.v ? parseInt(req.query.v, 10) : null;
    if (versionId) {
        var version = dataVersions.find(function (v) { return v.id === versionId; });
        if (version) return res.json(version);
        return res.status(404).json({ error: "Version not found" });
    }
    if (dataVersions.length > 0) {
        return res.json(dataVersions[dataVersions.length - 1]);
    }
    fetchFromCpi()
        .then(function (data) {
            addVersion(data);
            res.json(dataVersions[dataVersions.length - 1]);
        })
        .catch(function (err) {
            console.error("[backend] Read fetch failed:", err.message);
            res.json({
                company: "—", dataType: "—", syncId: null, totalRecords: 0,
                timestamp: null, summary: { totalLedgers: 0, partyLedgers: 0, withGstin: 0, withEmail: 0, totalBalance: 0 }, data: []
            });
        });
});

router.get("/http/read-tally/fresh", function (_req, res) {
    fetchFreshFromCpi()
        .then(function (result) {
            var body = result.body;
            var meta = result.meta;

            // CPI returned real data
            if (body.data && Array.isArray(body.data) && body.data.length > 0) {
                return res.json({
                    fromCpi: true,
                    meta:   meta,
                    body:   body,
                    syncId: body.syncId || meta.cpiMessageId || meta.cpiDataStoreId || null,
                    totalRecords: body.totalRecords || body.data.length,
                    timestamp:    body.timestamp || meta.cpiTimestamp || null
                });
            }

            // CPI has no data — no fallback, show empty
            console.log("[backend] CPI returned no data");
            res.json({
                fromCpi: true,
                meta:   meta,
                body:   { company: null, dataType: null, syncId: null, timestamp: null, totalRecords: 0, summary: {}, data: [] },
                syncId: null,
                totalRecords: 0,
                timestamp: null
            });
        })
        .catch(function (err) {
            console.error("[backend] Fresh fetch failed:", err.message);
            res.status(502).json({ error: "CPI fetch failed: " + err.message });
        });
});

router.post("/ingest", function (req, res) {
    // Accepts data payload with CPI metadata from external middleware
    // Expected body: { company, dataType, totalRecords, summary, data, syncId, cpiMessageId, cpiDataStoreId, cpiPushDate }
    try {
        if (!req.body || !req.body.company) {
            return res.status(400).json({ error: "Missing required field: company" });
        }
        var data = req.body;
        if (!data.dataType) data.dataType = "Ledgers";
        if (!data.syncId) data.syncId = "ingest-" + Date.now();
        if (!data.cpiPushDate) data.cpiPushDate = new Date().toUTCString();
        var version = addVersion(data);
        console.log("[backend] Ingest — version " + version.id + " (" + version.company + ", " + version.totalRecords + " records)");
        res.json({ success: true, versionId: version.id, timestamp: version.timestamp, syncId: version.syncId, records: version.totalRecords });
    } catch (err) {
        console.error("[backend] Ingest error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post("/push", function (req, res) {
    try {
        var version = addVersion(req.body);
        console.log("[backend] Push — version " + version.id + " at " + version.timestamp + " id: " + version.syncId);
        res.json({ success: true, versionId: version.id, timestamp: version.timestamp, syncId: version.syncId, records: version.totalRecords });
    } catch (err) {
        console.error("[backend] Push error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post("/push/ledgers", function (req, res) {
    var data = req.body;
    data.dataType = "Ledgers";
    var version = addVersion(data);
    console.log("[backend] Ledgers — version " + version.id + " at " + version.timestamp + " id: " + version.syncId);
    res.json({ success: true, versionId: version.id, timestamp: version.timestamp, syncId: version.syncId, records: version.totalRecords });
});

router.post("/push/vouchers", function (req, res) {
    var data = req.body;
    data.dataType = "Vouchers";
    var version = addVersion(data);
    console.log("[backend] Vouchers — version " + version.id + " at " + version.timestamp + " id: " + version.syncId);
    res.json({ success: true, versionId: version.id, timestamp: version.timestamp, syncId: version.syncId, records: version.totalRecords });
});

router.post("/push/stock-items", function (req, res) {
    var data = req.body;
    data.dataType = "Stock Items";
    var version = addVersion(data);
    console.log("[backend] Stock Items — version " + version.id + " at " + version.timestamp + " id: " + version.syncId);
    res.json({ success: true, versionId: version.id, timestamp: version.timestamp, syncId: version.syncId, records: version.totalRecords });
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
            company: v.company,
            dataType: v.dataType,
            cpiMessageId: v.cpiMessageId,
            pushedAt: v.timestamp,
            totalLedgers: v.summary.totalLedgers,
            partyLedgers: v.summary.partyLedgers,
            withGstin: v.summary.withGstin,
            withEmail: v.summary.withEmail,
            totalBalance: v.summary.totalBalance
        };
    });
    res.json({ value: result });
});

odataRouter.get("/v4/tally/Ledgers", function (req, res) {
    var seen = {};
    var ledgers = [];
    dataVersions.forEach(function (v) {
        (v.data || []).forEach(function (d) {
            if (!d.name || d.voucherDate || d.voucherNumber) return;
            var key = d.name + "|" + (d.parentGroup || "");
            if (!seen[key]) {
                seen[key] = true;
                ledgers.push({
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
    });
    res.json({ value: ledgers });
});

odataRouter.get("/v4/tally/Vouchers", function (req, res) {
    var seen = {};
    var vouchers = [];
    dataVersions.forEach(function (v) {
        (v.data || []).forEach(function (d) {
            if (!d.voucherDate && !d.partyName) return;
            var key = d.guid || (d.voucherNumber + "|" + d.partyName);
            if (!seen[key]) {
                seen[key] = true;
                vouchers.push({
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
    });
    res.json({ value: vouchers });
});

odataRouter.get("/v4/tally/StockItems", function (req, res) {
    var seen = {};
    var items = [];
    dataVersions.forEach(function (v) {
        (v.data || []).forEach(function (d) {
            if (!d.stockName && !d.rate && !d.quantity) return;
            var key = d.guid || d.stockName || JSON.stringify(d);
            if (!seen[key]) {
                seen[key] = true;
                items.push({
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
    });
    res.json({ value: items });
});

module.exports = { router, odataRouter, addVersion, fetchFromCpi, dataVersions };
