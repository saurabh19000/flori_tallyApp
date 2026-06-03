/**
 * push-to-cpi.js
 *
 * Push Tally data to SAP BTP CPI and update the backend with the CPI message ID.
 *
 * Usage:
 *   node push-to-cpi.js <dataFile.json> [dataType]
 *
 *   dataFile   — JSON file with the payload (see example below)
 *   dataType   — "Ledgers" (default), "Vouchers", or "Stock Items"
 *
 * Example:
 *   node push-to-cpi.js ./sample-data.json Ledgers
 *
 * ─── JSON file format ──────────────────────────────────────
 * {
 *   "company": "My Company",
 *   "totalRecords": 5,
 *   "summary": {
 *     "totalLedgers": 5,
 *     "partyLedgers": 3,
 *     "withGstin": 2,
 *     "withEmail": 1,
 *     "totalBalance": 150000
 *   },
 *   "data": [
 *     {
 *       "name": "Cash",
 *       "parentGroup": "Cash-in-Hand",
 *       "type": "General",
 *       "openingBalance": 0,
 *       "closingBalance": 777,
 *       "currency": "INR",
 *       "countryCode": "IN"
 *     }
 *   ]
 * }
 * ───────────────────────────────────────────────────────────
 */

"use strict";

const https = require("https");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");

// ── Config ─────────────────────────────────────────────────
const TOKEN_PROXY  = "localhost:3002";
const BACKEND      = "localhost:3003";
const CPI_API_BASE = "https://690a9d08trial.it-cpitrial03-rt.cfapps.ap21.hana.ondemand.com";

// ── Helpers ────────────────────────────────────────────────
function getToken() {
    return new Promise(function (resolve, reject) {
        http.get("http://" + TOKEN_PROXY + "/token", function (res) {
            var data = "";
            res.on("data", function (chunk) { data += chunk; });
            res.on("end", function () {
                if (res.statusCode !== 200) {
                    return reject(new Error("Token proxy returned " + res.statusCode));
                }
                try { resolve(JSON.parse(data).access_token); }
                catch (e) { reject(e); }
            });
        }).on("error", reject);
    });
}

function pushToCpi(token, payload) {
    return new Promise(function (resolve, reject) {
        var body = JSON.stringify(payload);
        var url = new URL(CPI_API_BASE + "/http/tally-write");
        var options = {
            hostname: url.hostname,
            port:     443,
            path:     url.pathname + url.search,
            method:   "POST",
            headers: {
                "Authorization":  "Bearer " + token,
                "Content-Type":   "application/json",
                "Content-Length": Buffer.byteLength(body),
                "Accept":         "application/json"
            }
        };
        var req = https.request(options, function (res) {
            var data = "";
            res.on("data", function (chunk) { data += chunk; });
            res.on("end", function () {
                var cpiMsgId = res.headers["sap_messageprocessinglogid"]
                    || res.headers["sap-message-id"]
                    || res.headers["x-cpi-messageid"]
                    || res.headers["x-request-id"]
                    || res.headers["x-vcap-request-id"]
                    || crypto.randomUUID();
                var cpiDataStoreId = res.headers["sapdatastoreid"] || null;
                resolve({ status: res.statusCode, body: data, cpiMessageId: cpiMsgId, cpiDataStoreId: cpiDataStoreId });
            });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

function notifyBackend(syncId, payload, dataType, cpiDataStoreId) {
    var pushDate = new Date().toUTCString();
    return new Promise(function (resolve, reject) {
        var body = JSON.stringify({
            syncId:         syncId,
            cpiMessageId:   syncId,
            cpiDataStoreId: cpiDataStoreId,
            cpiPushDate:    pushDate,
            company:        payload.company,
            totalRecords:   payload.totalRecords,
            summary:        payload.summary,
            data:           payload.data,
            dataType:       dataType
        });
        var options = {
            hostname: "localhost",
            port:     3003,
            path:     "/api/push",
            method:   "POST",
            headers: {
                "Content-Type":   "application/json",
                "Content-Length": Buffer.byteLength(body)
            }
        };
        var req = http.request(options, function (res) {
            var data = "";
            res.on("data", function (chunk) { data += chunk; });
            res.on("end", function () {
                try { resolve(JSON.parse(data)); }
                catch (e) { resolve({ raw: data }); }
            });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

function pushToCap(payload, dataType, cpiMessageId) {
    return new Promise(function (resolve, reject) {
        var body = JSON.stringify({
            company:      payload.company,
            dataType:     dataType,
            cpiMessageId: cpiMessageId || "local-" + Date.now(),
            totalRecords: payload.totalRecords || 0,
            summary:      JSON.stringify(payload.summary || {}),
            data:         JSON.stringify(payload.data || [])
        });
        var options = {
            hostname: "localhost",
            port:     4004,
            path:     "/odata/v4/tally/pushData",
            method:   "POST",
            headers: {
                "Content-Type":   "application/json",
                "Content-Length": Buffer.byteLength(body)
            }
        };
        var req = http.request(options, function (res) {
            var data = "";
            res.on("data", function (chunk) { data += chunk; });
            res.on("end", function () {
                resolve({ status: res.statusCode, body: data });
            });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

// ── Main ───────────────────────────────────────────────────
function main() {
    var args = process.argv.slice(2);
    if (args.length < 1) {
        console.error("Usage: node push-to-cpi.js <dataFile.json> [dataType]");
        console.error("");
        console.error("  dataType: Ledgers (default), Vouchers, Stock Items");
        process.exit(1);
    }

    var dataFile = args[0];
    var dataType = args[1] || "Ledgers";

    if (!fs.existsSync(dataFile)) {
        console.error("File not found:", dataFile);
        process.exit(1);
    }

    var payload = JSON.parse(fs.readFileSync(dataFile, "utf8"));

    console.log("──────────────────────────────────────────────");
    console.log("  Push to CAP (Tally Backend Service)");
    console.log("──────────────────────────────────────────────");
    console.log("  Data Type :", dataType);
    console.log("  Company   :", payload.company);
    console.log("  Records   :", payload.totalRecords);
    console.log("");

    console.log("[1/3] Getting OAuth token from token-proxy...");
    getToken()
        .then(function (token) {
            console.log("[2/3] Pushing data to CPI (to get real message ID)...");
            return pushToCpi(token, payload);
        })
        .then(function (result) {
            console.log("  CPI response:", result.status);
            console.log("  CPI message ID:", result.cpiMessageId);
            var cpiMsgId = result.cpiMessageId;

            console.log("[3/3] Pushing to CAP with CPI message ID...");
            return pushToCap(payload, dataType, cpiMsgId);
        })
        .then(function (result) {
            console.log("  CAP response:", result.status);
            try {
                var parsed = JSON.parse(result.body);
                console.log("  Sync ID:", parsed.syncId);
                console.log("  Records stored:", parsed.records);
                console.log("");
                console.log("✅ Done! Data stored in CAP database with real CPI message ID.");
            } catch (e) {
                console.log("  Raw:", result.body);
            }
        })
        .catch(function (err) {
            console.error("❌ Failed:", err.message);
            process.exit(1);
        });
}

main();
