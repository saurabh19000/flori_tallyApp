#!/usr/bin/env node
"use strict";

/**
 * watch-ingest.js
 *
 * Watches a folder for new data JSON files and automatically
 * pushes them to CPI + notifies the backend.
 *
 * Usage:
 *   node watch-ingest.js
 *
 * Drop a .json file into the ./incoming/ folder and it will be
 * picked up automatically.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const INCOMING_DIR = path.join(__dirname, "incoming");
const PROCESSED_DIR = path.join(__dirname, "incoming", "processed");
const FAILED_DIR = path.join(__dirname, "incoming", "failed");

// Ensure directories exist
[INCOMING_DIR, PROCESSED_DIR, FAILED_DIR].forEach(function (dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

console.log("──────────────────────────────────────────────");
console.log("  Watch Ingest Started");
console.log("──────────────────────────────────────────────");
console.log("  Drop .json files into: " + INCOMING_DIR);
console.log("  Watching every 5 seconds...");
console.log("");

function processFile(filePath) {
    var filename = path.basename(filePath);
    var dataType = "Ledgers"; // default, can override via filename prefix

    // Parse dataType from filename: "Ledgers_myfile.json" -> Ledgers
    var match = filename.match(/^(Ledgers|Vouchers|StockItems?)_/i);
    if (match) {
        dataType = match[1];
        if (dataType.toLowerCase() === "stockitem" || dataType.toLowerCase() === "stockitems") {
            dataType = "Stock Items";
        }
    }

    console.log("[watch] Found: " + filename + " (" + dataType + ")");

    try {
        var result = execSync(
            "node " + __dirname + "/push-to-cpi.js \"" + filePath + "\" \"" + dataType + "\"",
            { timeout: 60000, encoding: "utf8", stdio: "pipe" }
        );
        console.log("[watch] Output:\n" + result);

        // Move to processed
        var dest = path.join(PROCESSED_DIR, filename);
        fs.renameSync(filePath, dest);
        console.log("[watch] ✅ Processed: " + filename);
    } catch (err) {
        var errMsg = (err.stderr || err.message || "Unknown error").substring(0, 300);
        console.error("[watch] ❌ Failed: " + filename + " — " + errMsg);
        try {
            var dest = path.join(FAILED_DIR, filename);
            fs.renameSync(filePath, dest);
        } catch (_) {}
    }
    console.log("");
}

// Scan every 5 seconds
setInterval(function () {
    if (!fs.existsSync(INCOMING_DIR)) return;
    var files = fs.readdirSync(INCOMING_DIR).filter(function (f) {
        return f.endsWith(".json") && !f.startsWith(".");
    });
    files.forEach(function (file) {
        var filePath = path.join(INCOMING_DIR, file);
        // Make sure it's a file (not already being processed)
        try {
            if (fs.statSync(filePath).isFile()) {
                processFile(filePath);
            }
        } catch (_) {}
    });
}, 5000);
