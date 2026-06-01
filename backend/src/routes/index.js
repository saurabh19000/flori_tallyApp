const { Router } = require("express");
const http = require("http");
const crypto = require("crypto");
const istTimestamp = require("../helpers/istTimestamp");

let latestSync = {
    company: "—",
    dataType: "—",
    syncId: null,
    totalRecords: 0,
    timestamp: null,
    summary: {
        totalLedgers: 0,
        partyLedgers: 0,
        withGstin: 0,
        withEmail: 0,
        totalBalance: 0
    },
    data: []
};

function updateLatestSync(data) {
    latestSync = {
        company: data.company || latestSync.company,
        dataType: data.dataType || latestSync.dataType,
        syncId: data.syncId || latestSync.syncId || contentFingerprint(data),
        totalRecords: data.totalRecords != null ? data.totalRecords : latestSync.totalRecords,
        timestamp: istTimestamp(),
        summary: {
            totalLedgers: (data.summary && data.summary.totalLedgers) != null ? data.summary.totalLedgers : latestSync.summary.totalLedgers,
            partyLedgers: (data.summary && data.summary.partyLedgers) != null ? data.summary.partyLedgers : latestSync.summary.partyLedgers,
            withGstin: (data.summary && data.summary.withGstin) != null ? data.summary.withGstin : latestSync.summary.withGstin,
            withEmail: (data.summary && data.summary.withEmail) != null ? data.summary.withEmail : latestSync.summary.withEmail,
            totalBalance: (data.summary && data.summary.totalBalance) != null ? data.summary.totalBalance : latestSync.summary.totalBalance
        },
        data: Array.isArray(data.data) ? data.data : latestSync.data
    };
}

const TOKEN_PROXY = "localhost:3002";

function contentFingerprint(data) {
    var stable = {
        company: data.company,
        dataType: data.dataType,
        totalRecords: data.totalRecords,
        summary: data.summary,
        data: data.data
    };
    return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex").substring(0, 12);
}

function fetchFromCpi() {
    return new Promise(function (resolve, reject) {
        var req = http.get("http://" + TOKEN_PROXY + "/api/http/read-tally", function (res) {
            var data = "";
            var cpiMsgId = res.headers["sapdatastoreid"] || res.headers["sap_messageprocessinglogid"] || null;
            res.on("data", function (chunk) { data += chunk; });
            res.on("end", function () {
                if (res.statusCode !== 200) {
                    return reject(new Error("CPI proxy returned " + res.statusCode));
                }
                try {
                    var parsed = JSON.parse(data);
                    if (cpiMsgId) {
                        parsed.syncId = cpiMsgId;
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

var fetching = false;

function ensureLatestSync(req, res, done) {
    if (latestSync.timestamp || fetching) {
        return done();
    }
    fetching = true;
    console.log("[backend] First request — fetching from CPI via token-proxy...");
    fetchFromCpi()
        .then(function (data) {
            updateLatestSync(data);
            console.log("[backend] CPI data cached at", latestSync.timestamp);
            fetching = false;
            done();
        })
        .catch(function (err) {
            console.error("[backend] CPI fetch failed:", err.message);
            console.log("[backend] Serving empty — push will populate later");
            fetching = false;
            done();
        });
}

const router = Router();

router.get("/http/read-tally", function (req, res) {
    ensureLatestSync(req, res, function () {
        res.json(latestSync);
    });
});

router.post("/push", function (req, res) {
    try {
        updateLatestSync(req.body);
        console.log("[backend] Sync updated at", latestSync.timestamp, "id:", latestSync.syncId);
        res.json({ success: true, timestamp: latestSync.timestamp, syncId: latestSync.syncId });
    } catch (err) {
        console.error("[backend] Push error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post("/push/ledgers", function (req, res) {
    var data = req.body;
    data.dataType = "Ledgers";
    updateLatestSync(data);
    console.log("[backend] Ledgers synced at", latestSync.timestamp, "id:", latestSync.syncId);
    res.json({ success: true, timestamp: latestSync.timestamp, syncId: latestSync.syncId });
});

router.post("/push/vouchers", function (req, res) {
    var data = req.body;
    data.dataType = "Vouchers";
    updateLatestSync(data);
    console.log("[backend] Vouchers synced at", latestSync.timestamp, "id:", latestSync.syncId);
    res.json({ success: true, timestamp: latestSync.timestamp, syncId: latestSync.syncId });
});

router.post("/push/stock-items", function (req, res) {
    var data = req.body;
    data.dataType = "Stock Items";
    updateLatestSync(data);
    console.log("[backend] Stock Items synced at", latestSync.timestamp, "id:", latestSync.syncId);
    res.json({ success: true, timestamp: latestSync.timestamp, syncId: latestSync.syncId });
});

router.post("/refresh", function (req, res) {
    fetching = false;
    latestSync.timestamp = null;
    console.log("[backend] Cache cleared — next read will fetch fresh from CPI");
    ensureLatestSync(req, res, function () {
        res.json({ success: true, timestamp: latestSync.timestamp, syncId: latestSync.syncId, records: latestSync.totalRecords });
    });
});

router.get("/health", function (_req, res) {
    res.json({
        status: "ok",
        lastSync: latestSync.timestamp,
        syncId: latestSync.syncId,
        records: latestSync.totalRecords,
        dataType: latestSync.dataType,
        company: latestSync.company
    });
});

module.exports = { router, latestSync, updateLatestSync };
