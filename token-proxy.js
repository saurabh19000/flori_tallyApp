/**
 * token-proxy.js
 *
 * BTP OAuth2 token proxy — runs on localhost:3001
 * Bypasses browser CORS on the BTP UAA token endpoint.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  SETUP
 *  1. Fill CLIENT_ID and CLIENT_SECRET below (from your BTP service key).
 *     BTP Cockpit → CPI service instance → Service Keys → clientid / clientsecret
 *
 *  2. No npm install needed — only Node.js built-ins (http, https, net, child_process).
 *
 *  START:   node token-proxy.js
 *  APP:     npm start
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const http           = require("http");
const https          = require("https");
const net            = require("net");
const { execSync }   = require("child_process");

// ── BTP credentials ───────────────────────────────────────────────────────────
const CLIENT_ID     = "sb-5c415a68-d997-4ef4-84be-b63e68ac3eab!b116673|it-rt-690a9d08trial!b196";       // ← replace
const CLIENT_SECRET = "38dc02e8-3063-4682-bb4e-7d67b79cc8c6$S6n7sROZpLCALLQQ-_2ZSgpp04-JENbYZHZu-cUXQWs=";   // ← replace
const TOKEN_URL     = "https://690a9d08trial.authentication.ap21.hana.ondemand.com/oauth/token";

const PROXY_PORT   = 3002;
const CPI_API_BASE = "https://690a9d08trial.it-cpitrial03-rt.cfapps.ap21.hana.ondemand.com";

// ── Kill whatever is already on PROXY_PORT ────────────────────────────────────
function killPortIfBusy(port) {
    return new Promise(function (resolve) {
        const tester = net.createServer();

        tester.once("error", function (err) {
            if (err.code !== "EADDRINUSE") { return resolve(); }

            console.log("[proxy] Port " + port + " in use — killing old process...");

            try {
                // Works on Linux / macOS
                const pid = execSync("lsof -ti:" + port).toString().trim();
                if (pid) {
                    pid.split("\n").forEach(function (p) {
                        try {
                            process.kill(parseInt(p, 10), "SIGKILL");
                            console.log("[proxy] Killed PID " + p);
                        } catch (_) {}
                    });
                }
            } catch (_) {
                // lsof not available (some Windows setups) — try fuser
                try {
                    execSync("fuser -k " + port + "/tcp");
                    console.log("[proxy] Killed process on port " + port + " via fuser");
                } catch (__) {
                    console.warn("[proxy] Could not auto-kill. Run manually:");
                    console.warn("        kill $(lsof -ti:" + port + ")");
                }
            }

            // Wait 800ms for the port to be released, then resolve
            setTimeout(resolve, 800);
        });

        tester.once("listening", function () {
            tester.close(resolve); // Port is free, nothing to kill
        });

        tester.listen(port);
    });
}

// ── Token cache (server-side) ─────────────────────────────────────────────────
let cachedToken = null;
let tokenExpiry = 0;

function fetchToken() {
    return new Promise(function (resolve, reject) {
        const now = Date.now();

        if (cachedToken && now < (tokenExpiry - 60000)) {
            console.log("[proxy] Using cached token (expires in",
                Math.round((tokenExpiry - now) / 1000), "s)");
            return resolve(cachedToken);
        }

        console.log("[proxy] Fetching new token from BTP UAA...");

        const credentials = Buffer.from(CLIENT_ID + ":" + CLIENT_SECRET).toString("base64");
        const body        = "grant_type=client_credentials";
        const url         = new URL(TOKEN_URL);

        const options = {
            hostname: url.hostname,
            port:     443,
            path:     url.pathname + url.search,
            method:   "POST",
            headers:  {
                "Authorization":  "Basic " + credentials,
                "Content-Type":   "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(body),
                "Accept":         "application/json"
            }
        };

        const req = https.request(options, function (res) {
            let data = "";
            res.on("data",  function (chunk) { data += chunk; });
            res.on("end",   function () {
                let parsed;
                try   { parsed = JSON.parse(data); }
                catch { return reject(new Error("UAA returned non-JSON: " + data)); }

                if (res.statusCode !== 200) {
                    return reject(new Error(
                        "UAA [HTTP " + res.statusCode + "]: " +
                        (parsed.error_description || parsed.error || data)
                    ));
                }
                if (!parsed.access_token) {
                    return reject(new Error("UAA response missing access_token"));
                }

                cachedToken = parsed;
                const lifetimeMs = parsed.expires_in
                    ? (parsed.expires_in - 60) * 1000
                    : 55 * 60 * 1000;
                tokenExpiry = now + lifetimeMs;

                console.log("[proxy] Token obtained. Expires in",
                    parsed.expires_in || 3300, "s");
                resolve(parsed);
            });
        });

        req.on("error", function (e) {
            reject(new Error("Network error reaching UAA: " + e.message));
        });

        req.write(body);
        req.end();
    });
}

// ── CPI API proxy ─────────────────────────────────────────────────────────────
const CPI_API_BASE_HOST = new URL(CPI_API_BASE).hostname;

function proxyApiRequest(apiPath, res, extraHeaders) {
    fetchToken()
    .then(function (token) {
        const headers = {
            "Authorization":  "Bearer " + token.access_token,
            "Accept":         "application/json"
        };
        if (extraHeaders) {
            Object.keys(extraHeaders).forEach(function (k) {
                headers[k] = extraHeaders[k];
            });
        }
        const options = {
            hostname: CPI_API_BASE_HOST,
            port:     443,
            path:     apiPath,
            method:   "GET",
            headers:  headers
        };

        const req = https.request(options, function (cpiRes) {
            let data = "";
            cpiRes.on("data",  function (chunk) { data += chunk; });
            cpiRes.on("end",   function () {
                res.writeHead(cpiRes.statusCode, cpiRes.headers);
                res.end(data);
            });
        });

        req.on("error", function (e) {
            console.error("[proxy] CPI API error:", e.message);
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "CPI API error: " + e.message }));
        });

        req.end();
    })
    .catch(function (err) {
        console.error("[proxy] Token fetch failed for API proxy:", err.message);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
    });
}

// ── Start server ──────────────────────────────────────────────────────────────
async function startServer() {
    await killPortIfBusy(PROXY_PORT);

    const server = http.createServer(function (req, res) {
        res.setHeader("Access-Control-Allow-Origin",  "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type, Authorization");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            return res.end();
        }

        if (req.method !== "GET") {
            res.writeHead(404, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Use GET /token or GET /api/*" }));
        }

        // ── Route: /token ──
        if (req.url === "/token") {
            return fetchToken()
            .then(function (token) {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(token));
            })
            .catch(function (err) {
                console.error("[proxy] ERROR:", err.message);
                res.writeHead(502, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err.message }));
            });
        }

        // ── Route: /api/*  (proxy to CPI with Bearer token) ──
        if (req.url.startsWith("/api/")) {
            const parsedUrl = new URL(req.url, "http://localhost");
            const storeId = parsedUrl.searchParams.get("storeId") || null;
            parsedUrl.searchParams.delete("storeId");
            const apiPath = parsedUrl.pathname.replace(/^\/api/, "") + parsedUrl.search;

            const extraHeaders = {};
            if (storeId) {
                extraHeaders["SapDataStoreId"] = storeId;
                console.log("[proxy] Using data store entry ID:", storeId);
            }

            console.log("[proxy] Proxying to CPI:", apiPath);
            return proxyApiRequest(apiPath, res, extraHeaders);
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Use GET /token or GET /api/*" }));
    });

    // Catch any remaining EADDRINUSE (race condition safety)
    server.on("error", function (err) {
        if (err.code === "EADDRINUSE") {
            console.error(
                "[proxy] Port " + PROXY_PORT + " still in use after kill attempt.\n" +
                "        Run this manually and retry:\n" +
                "        kill $(lsof -ti:" + PROXY_PORT + ")"
            );
        } else {
            console.error("[proxy] Server error:", err.message);
        }
        process.exit(1);
    });

    server.listen(PROXY_PORT, function () {
        console.log("─────────────────────────────────────────────────");
        console.log("  BTP Token + API Proxy  →  http://localhost:" + PROXY_PORT + "/token");
        console.log("  API endpoint          →  GET /api/http/read-tally");
        console.log("─────────────────────────────────────────────────");

        // if (CLIENT_ID === "sb-5c415a68-d997-4ef4-84be-b63e68ac3eab!b116673|it-rt-690a9d08trial!b196" || CLIENT_SECRET === "38dc02e8-3063-4682-bb4e-7d67b79cc8c6$S6n7sROZpLCALLQQ-_2ZSgpp04-JENbYZHZu-cUXQWs=") {
        //     console.warn("  ⚠  CLIENT_ID / CLIENT_SECRET not set!");
        //     console.warn("     Edit token-proxy.js with your BTP service key values.");
        // } else {
        //     console.log("  Client ID:", CLIENT_ID.substring(0, 12) + "...");
        //     console.log("  Ready. Waiting for requests...");
        // }
        // console.log("─────────────────────────────────────────────────");
    });
}

startServer();