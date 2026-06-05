sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (Controller, JSONModel, Filter, FilterOperator, MessageBox, MessageToast) {
    "use strict";

    var CAP_URL  = "/odata/v4/tally";
    var TABS = { HISTORY: "SyncHistory", LEDGERS: "Ledgers", VOUCHERS: "Vouchers", STOCK: "StockItems" };

    return Controller.extend("app.tallyapp.controller.View1", {

        onInit: function () {
            var oModel = new JSONModel({
                company:       "",
                dataType:      "",
                syncId:        "",
                timestamp:     "",
                totalRecords:  0,
                cpiMessageId:  "",
                summary:       { totalLedgers: 0, partyLedgers: 0, withGstin: 0, withEmail: 0, totalBalance: 0 },
                ledgers:       [],
                vouchers:      [],
                stockItems:    [],
                syncs:         [],
                busy:          false,
                hasError:      false,
                lastRefreshed: "",
                tab:           TABS.HISTORY
            });
            this.getView().setModel(oModel);
            this.loadData();
        },

        loadData: function () {
            var oModel = this.getView().getModel();
            oModel.setProperty("/busy", true);
            oModel.setProperty("/hasError", false);

            console.log("──────────────────────────────────────────────");
            console.log("[fetch] GET /odata/v4/tally/Syncs?$orderby=pushedAt desc&$top=20");
            console.log("[fetch] GET /odata/v4/tally/Ledgers");
            console.log("[fetch] GET /odata/v4/tally/Vouchers");
            console.log("[fetch] GET /odata/v4/tally/StockItems");
            console.log("──────────────────────────────────────────────");

            Promise.all([
                fetch(CAP_URL + "/Syncs?$orderby=pushedAt desc&$top=20").then(function (r) {
                    console.log("[response] Syncs →", r.status, r.statusText);
                    return r.json();
                }),
                fetch(CAP_URL + "/Ledgers").then(function (r) {
                    console.log("[response] Ledgers →", r.status, r.statusText);
                    return r.json();
                }),
                fetch(CAP_URL + "/Vouchers").then(function (r) {
                    console.log("[response] Vouchers →", r.status, r.statusText);
                    return r.json();
                }),
                fetch(CAP_URL + "/StockItems").then(function (r) {
                    console.log("[response] StockItems →", r.status, r.statusText);
                    return r.json();
                })
            ])
            .then(function (results) {
                var syncs = results[0].value || [];
                var ledgers = results[1].value || [];
                var vouchers = results[2].value || [];
                var stockItems = results[3].value || [];
                var latest = syncs[0] || {};

                oModel.setProperty("/syncs",        syncs);
                oModel.setProperty("/company",      latest.company      || "—");
                oModel.setProperty("/dataType",     latest.dataType     || "—");
                oModel.setProperty("/syncId",       latest.cpiMessageId || "—");
                oModel.setProperty("/cpiMessageId", latest.cpiMessageId || "—");
                oModel.setProperty("/timestamp", latest.pushedAt
                    ? new Date(latest.pushedAt).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short"
                      })
                    : "—");

                oModel.setProperty("/summary", {
                    totalLedgers: latest.totalLedgers || 0,
                    partyLedgers: latest.partyLedgers || 0,
                    withGstin:    latest.withGstin    || 0,
                    withEmail:    latest.withEmail    || 0,
                    totalBalance: latest.totalBalance || 0
                });

                console.log("[data] Ledgers:", ledgers.length, "records");
                console.log("[data] Vouchers:", vouchers.length, "records");
                console.log("[data] StockItems:", stockItems.length, "records");
                if (ledgers.length > 0) console.log("[data] First ledger:", ledgers[0].name, "| ₹" + ledgers[0].closingBalance);
                if (vouchers.length > 0) console.log("[data] First voucher:", vouchers[0].partyName, "|", vouchers[0].voucherType, "| ₹" + vouchers[0].netAmount);
                if (stockItems.length > 0) console.log("[data] First stock item:", stockItems[0].stockName);

                oModel.setProperty("/ledgers", ledgers);
                oModel.setProperty("/vouchers", vouchers);
                oModel.setProperty("/stockItems", stockItems);
                oModel.setProperty("/totalRecords", ledgers.length + vouchers.length + stockItems.length);
                oModel.setProperty("/lastRefreshed",
                    "Last refreshed: " + new Date().toLocaleTimeString("en-IN"));
                oModel.setProperty("/busy", false);

                MessageToast.show("Loaded " + ledgers.length + " ledgers, " + vouchers.length + " vouchers, " + stockItems.length + " stock items");
            })
            .catch(function (e) {
                console.log("[View1] loadData FAILED:", e.message);
                oModel.setProperty("/busy", false);
                oModel.setProperty("/hasError", true);
                MessageBox.error("Unable to fetch data.\n\nError: " + (e.message || "Unknown error"));
            });
        },

        onTabSelect: function (oEvent) {
            var key = oEvent.getParameter("key");
            this.getView().getModel().setProperty("/tab", key);
            this._clearSearch();
        },

        _clearSearch: function () {
            var oSearch = this.byId("searchField");
            if (oSearch) { oSearch.setValue(""); }
            var tab = this.getView().getModel().getProperty("/tab");
            var table = tab === TABS.LEDGERS ? "ledgerTable"
                      : tab === TABS.VOUCHERS ? "voucherTable"
                      : tab === TABS.HISTORY ? "syncTable"
                      : "stockTable";
            var oTable = this.byId(table);
            if (oTable && oTable.getBinding("items")) {
                oTable.getBinding("items").filter([]);
            }
        },

        onSearch: function (oEvent) {
            var sQuery = oEvent.getSource().getValue().trim();
            var tab = this.getView().getModel().getProperty("/tab");
            var tableId = tab === TABS.LEDGERS ? "ledgerTable"
                        : tab === TABS.VOUCHERS ? "voucherTable"
                        : tab === TABS.HISTORY ? "syncTable"
                        : "stockTable";
            var oBinding = this.byId(tableId).getBinding("items");
            if (!oBinding) { return; }

            var filterField = tab === TABS.LEDGERS ? "name"
                            : tab === TABS.VOUCHERS ? "partyName"
                            : tab === TABS.HISTORY ? "syncId"
                            : "stockName";
            oBinding.filter(sQuery
                ? [new Filter(filterField, FilterOperator.Contains, sQuery)]
                : []);
        },

        onRefresh: function () {
            this._clearSearch();
            this.loadData();
        },

        onFetchBtp: function () {
            var that = this;
            var oModel = this.getView().getModel();

            oModel.setProperty("/busy", true);
            MessageToast.show("Starting manual fetch from SAP BTP...");

            fetch("/api/sync/btp-fetch", { method: "POST" })
                .then(function (r) {
                    var contentType = r.headers.get("content-type");
                    if (contentType && contentType.indexOf("application/json") !== -1) {
                        return r.json();
                    } else {
                        throw new Error("Server returned non-JSON response. Please ensure backend is running.");
                    }
                })
                .then(function (result) {
                    oModel.setProperty("/busy", false);
                    if (result.success) {
                        MessageBox.success("Fetch Completed!\n\nTotal records found: " + result.totalFound + "\nNew versions added: " + result.newVersions);
                        that.loadData();
                    } else {
                        var msg = result.error + ": " + (result.details || "");
                        if (result.tip) { msg += "\n\nTip: " + result.tip; }
                        MessageBox.error(msg);
                    }
                })
                .catch(function (e) {
                    oModel.setProperty("/busy", false);
                    MessageBox.error("Fetch Error: " + e.message);
                });
        },

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
        },

        formatDate: function (v) {
            if (!v) { return "—"; }
            return new Date(v).toLocaleDateString("en-IN", { dateStyle: "medium" });
        },

        formatBool: function (v) {
            return v ? "Yes" : "No";
        }
    });
});
