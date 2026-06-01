sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (Controller, JSONModel, Filter, FilterOperator, MessageBox, MessageToast) {
    "use strict";

    // ─────────────────────────────────────────────────────────────────────────
    //  WHY A LOCAL PROXY?
    //
    //  BTP UAA (OAuth2 token endpoint) blocks direct browser requests due to
    //  CORS — the server does not send "Access-Control-Allow-Origin" headers
    //  for browser-initiated POST requests. This is standard BTP behaviour
    //  and cannot be changed from the client side.
    //
    //  Solution: token-proxy.js (Node.js) runs on localhost:3001.
    //  The browser calls localhost → proxy calls BTP UAA server-side (no CORS)
    //  → proxy returns the token to the browser.
    //
    //  START PROXY:   node token-proxy.js
    //  START APP:     npm start
    // ─────────────────────────────────────────────────────────────────────────

    // ── Endpoints ─────────────────────────────────────────────────────────────
    var TOKEN_PROXY_URL = "/token";
    var API_URL         = "/api/http/read-tally";
    var REFRESH_URL     = "/api/refresh";

    return Controller.extend("app.tallyapp.controller.View1", {

        onInit: function () {
            var oModel = new JSONModel({
                company:      "",
                dataType:     "",
                syncId:       "",
                timestamp:    "",
                totalRecords: 0,
                summary: {
                    totalLedgers: 0,
                    partyLedgers: 0,
                    withGstin:    0,
                    withEmail:    0,
                    totalBalance: 0
                },
                data:          [],
                busy:          false,
                hasError:      false,
                lastRefreshed: ""

            });
            this.getView().setModel(oModel);
            this.loadLedgerData();
        },

        // ─────────────────────────────────────────────────────────────────────
        // loadLedgerData
        // Calls the Tally API via the token-proxy (which adds Bearer token server-side)
        // ─────────────────────────────────────────────────────────────────────
        loadLedgerData: function (retryCount) {
            retryCount = retryCount || 0;
            var oModel = this.getView().getModel();
            oModel.setProperty("/busy",     true);
            oModel.setProperty("/hasError", false);

            console.log("[View1] calling API at:", API_URL);
            fetch(API_URL, {
                method:  "GET",
                headers: { "Accept": "application/json" }
            })
            .then(function (r) {
                console.log("[View1] API response status:", r.status, r.statusText);
                if (!r.ok) {
                    return r.text().then(function (body) {
                        console.log("[View1] API error body:", body);
                        throw new Error(
                            "API error [HTTP " + r.status + "]: " + r.statusText +
                            " | Body: " + body.substring(0, 500)
                        );
                    });
                }
                return r.json();
            })
            .then(function (d) {
                oModel.setProperty("/company",      d.company      || "—");
                oModel.setProperty("/dataType",     d.dataType     || "—");
                oModel.setProperty("/syncId",       d.syncId       || "—");
                oModel.setProperty("/totalRecords", d.totalRecords || 0);
                oModel.setProperty("/timestamp", d.timestamp
                    ? new Date(d.timestamp).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short"
                      })
                    : "—");

                var s = d.summary || {};
                oModel.setProperty("/summary", {
                    totalLedgers: s.totalLedgers || 0,
                    partyLedgers: s.partyLedgers || 0,
                    withGstin:    s.withGstin    || 0,
                    withEmail:    s.withEmail    || 0,
                    totalBalance: s.totalBalance || 0
                });

                var aRows = Array.isArray(d.data) ? d.data : [];
                oModel.setProperty("/data", aRows);
                oModel.setProperty("/lastRefreshed",
                    "Last refreshed: " + new Date().toLocaleTimeString("en-IN"));
                oModel.setProperty("/busy", false);

                MessageToast.show("Loaded " + aRows.length + " ledger records");
            }.bind(this))
            .catch(function (e) {
                console.log("[View1] loadLedgerData FAILED:", e.message);
                oModel.setProperty("/busy",     false);
                oModel.setProperty("/hasError", true);

                // Auto-retry on 503 (upstream transient failure / cold-start)
                if (e.message.indexOf("HTTP 503") >= 0 && retryCount < 3) {
                    var delay = (retryCount + 1) * 3000;
                    console.log("[View1] 503 detected (attempt " + (retryCount + 1) + "), retrying in " + delay + "ms...");
                    oModel.setProperty("/busy", true);
                    setTimeout(function () {
                        this.loadLedgerData(retryCount + 1);
                    }.bind(this), delay);
                    return;
                }

                MessageBox.error(
                    "Unable to fetch ledger data.\n\nError: " + (e.message || "Unknown error"),
                    {
                        title: "API Connection Error",
                        actions: [MessageBox.Action.RETRY, MessageBox.Action.CLOSE],
                        onClose: function (a) {
                            if (a === MessageBox.Action.RETRY) { this.loadLedgerData(); }
                        }.bind(this)
                    }
                );
            }.bind(this));
        },

        // ─────────────────────────────────────────────────────────────────────
        // UI event handlers
        // ─────────────────────────────────────────────────────────────────────
        onSearch: function (oEvent) {
            var sQuery   = oEvent.getSource().getValue().trim();
            var oBinding = this.byId("ledgerTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter(sQuery
                ? [new Filter("name", FilterOperator.Contains, sQuery)]
                : []);
        },

        onRefresh: function () {
            var oSearch = this.byId("searchField");
            if (oSearch) { oSearch.setValue(""); }

            var oTable = this.byId("ledgerTable");
            if (oTable && oTable.getBinding("items")) {
                oTable.getBinding("items").filter([]);
            }

            var oModel = this.getView().getModel();
            oModel.setProperty("/busy", true);

            fetch(REFRESH_URL, { method: "POST", headers: { "Accept": "application/json" } })
                .then(function () {
                    this.loadLedgerData();
                }.bind(this))
                .catch(function () {
                    this.loadLedgerData();
                }.bind(this));
        },

        // ─────────────────────────────────────────────────────────────────────
        // Formatters
        // ─────────────────────────────────────────────────────────────────────
        formatBalance: function (v) {
            if (v === null || v === undefined) { return "—"; }
            return new Intl.NumberFormat("en-IN", {
                style:                 "currency",
                currency:              "INR",
                maximumFractionDigits: 2
            }).format(v);
        },

        formatBalanceState: function (v) {
            if (!v)    { return "None"; }
            if (v > 0) { return "Success"; }
            if (v < 0) { return "Error"; }
            return "None";
        },

        formatTotalBalance: function (v) {
            if (v === null || v === undefined) { return "0"; }
            return new Intl.NumberFormat("en-IN", {
                style:                 "currency",
                currency:              "INR",
                maximumFractionDigits: 0
            }).format(v);
        }
    });
});