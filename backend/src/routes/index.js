const { Router } = require("express");
const http = require("http");
const crypto = require("crypto");
const istTimestamp = require("../helpers/istTimestamp");

let dataVersions = [];
let versionCounter = 0;

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
        var req = http.get("http://" + TOKEN_PROXY + "/api/read-tally", function (res) {
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
        var req = http.get("http://" + TOKEN_PROXY + "/api/read-tally", function (res) {
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

module.exports = { router, addVersion, fetchFromCpi, dataVersions };
