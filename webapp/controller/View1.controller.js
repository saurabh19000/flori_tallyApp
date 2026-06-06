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
                companies:     [],
                selectedCompany: "", // Default to All Companies
                busy:          false,
                hasError:      false,
                lastRefreshed: "",
                tab:           TABS.HISTORY
            });
            this.getView().setModel(oModel);
            this.loadCompanies();
            this.loadData();
        },

        loadCompanies: function () {
            var that = this;
            fetch("/api/companies")
                .then(function(res) { return res.json(); })
                .then(function(data) {
                    if (data.success) {
                        var oModel = that.getView().getModel();
                        var formatted = data.companies.map(function(c) { return { key: c, text: c }; });
                        formatted.unshift({ key: "", text: "All Companies (Latest Overall)" });
                        oModel.setProperty("/companies", formatted);
                    }
                })
                .catch(function(err) { console.error("Failed to load companies", err); });
        },

        onCompanyChange: function (oEvent) {
            this.loadData();
        },

        onSyncSelect: function (oEvent) {
            var oListItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oContext = oListItem.getBindingContext();
            if (!oContext) return;
            var oSync = oContext.getObject();
            this.loadData(oSync.syncId);
            MessageToast.show("Viewing specific sync: " + oSync.syncId);
        },

        loadData: function (specificSyncId) {
            var oModel = this.getView().getModel();
            oModel.setProperty("/busy", true);
            oModel.setProperty("/hasError", false);

            var CAP_URL = "/odata/v4/tally";
            var that = this;
            var selectedCompany = oModel.getProperty("/selectedCompany");
            
            // Step 1: Identify the sync ID to fetch data for
            var syncsUrl = CAP_URL + "/Syncs?$top=50" + (selectedCompany ? "&company=" + encodeURIComponent(selectedCompany) : "");
            
            fetch(syncsUrl)
                .then(function (res) { return res.json(); })
                .then(function (syncResult) {
                    var syncs = syncResult.value || [];
                    var targetSyncId = specificSyncId || (syncs.length > 0 ? syncs[0].syncId : null);
                    
                    if (!targetSyncId) {
                        return Promise.resolve([syncResult, {value:[]}, {value:[]}, {value:[]}]);
                    }

                    // Step 2: Fetch data for the identified sync
                    var q = "?syncId=" + encodeURIComponent(targetSyncId);
                    return Promise.all([
                        Promise.resolve(syncResult),
                        fetch(CAP_URL + "/Ledgers" + q).then(r => r.json()),
                        fetch(CAP_URL + "/Vouchers" + q).then(r => r.json()),
                        fetch(CAP_URL + "/StockItems" + q).then(r => r.json())
                    ]);
                })
                .then(function (results) {
                    var syncs = results[0].value || [];
                    var ledgers = results[1].value || [];
                    var vouchers = results[2].value || [];
                    var stockItems = results[3].value || [];
                    
                    // Identify the record we are currently displaying in the summary
                    var currentSyncId = specificSyncId || (syncs.length > 0 ? syncs[0].syncId : null);
                    var latest = syncs.find(s => s.syncId === currentSyncId) || syncs[0] || {};

                // Update Master Model with ALL data
                oModel.setProperty("/syncs",        syncs);
                oModel.setProperty("/ledgers",      ledgers);
                oModel.setProperty("/vouchers",     vouchers);
                oModel.setProperty("/stockItems",   stockItems);

                // Update Latest Sync Context
                oModel.setProperty("/company",      latest.company      || "—");
                oModel.setProperty("/dataType",     latest.dataType     || "—");
                oModel.setProperty("/syncId",       latest.syncId       || "—");
                oModel.setProperty("/timestamp", latest.pushedAt
                    ? new Date(latest.pushedAt).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short"
                      })
                    : "—");

                // Calculate Global System Statistics
                oModel.setProperty("/totalLedgers",    ledgers.length);
                oModel.setProperty("/totalVouchers",   vouchers.length);
                oModel.setProperty("/totalStockItems", stockItems.length);
                oModel.setProperty("/totalRecords",    ledgers.length + vouchers.length + stockItems.length);

                oModel.setProperty("/lastRefreshed",
                    "Last refreshed: " + new Date().toLocaleTimeString("en-IN"));
                oModel.setProperty("/busy", false);

                console.log("[debug] All Fetched Data:", {
                    ledgers: ledgers,
                    vouchers: vouchers,
                    stockItems: stockItems,
                    syncHistory: syncs
                });

                console.log("[ui] Data loaded. Ledgers:", ledgers.length, "| Vouchers:", vouchers.length, "| Syncs:", syncs.length);
                MessageToast.show("Dashboard Updated: " + (ledgers.length + vouchers.length) + " total system records.");
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
            this.loadCompanies();
            this.loadData();
        },

        onViewDetails: function (oEvent) {
            var oItem = oEvent.getSource().getBindingContext().getObject();
            var aDetails = [];

            // Dynamically scan for ALL keys in the record
            Object.keys(oItem).forEach(function (key) {
                // Ignore internal UI5/Sync metadata that isn't business data
                if (key === "__metadata" || key === "syncId" || key === "syncDate") return;
                
                var value = oItem[key];
                if (value === null || value === undefined) value = "—";
                
                aDetails.push({
                    label: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'), // CamelCase to Title Case
                    value: value.toString()
                });
            });

            if (!this._oDetailsDialog) {
                this._oDetailsDialog = new sap.m.Dialog({
                    title: "Full Record Inspector",
                    contentWidth: "450px",
                    contentHeight: "500px",
                    resizable: true,
                    draggable: true,
                    content: new sap.m.List({
                        items: {
                            path: "details>/",
                            template: new sap.m.DisplayListItem({
                                label: "{details>label}",
                                value: "{details>value}"
                            })
                        }
                    }),
                    beginButton: new sap.m.Button({
                        text: "Close",
                        press: function () {
                            this._oDetailsDialog.close();
                        }.bind(this)
                    })
                });
                this.getView().addDependent(this._oDetailsDialog);
            }

            var oDetailsModel = new JSONModel(aDetails);
            this._oDetailsDialog.setModel(oDetailsModel, "details");
            this._oDetailsDialog.open();
        },

        onFetchBtp: function () {
            var that = this;
            var oModel = this.getView().getModel();

            if (!this._oBusyDialog) {
                this._oBusyDialog = new sap.m.BusyDialog({
                    title: "BTP System Sync",
                    text: "Connecting to SAP BTP..."
                });
                this.getView().addDependent(this._oBusyDialog);
            }

            this._oBusyDialog.setText("Connecting to SAP BTP...");
            this._oBusyDialog.open();

            // Production Delay to ensure accuracy and visual feedback
            var wait = function (ms) { return new Promise(resolve => setTimeout(resolve, ms)); };

            fetch("/api/sync/btp-fetch", { method: "POST" })
                .then(function (r) {
                    if (!r.ok) throw new Error("HTTP Error " + r.status);
                    return r.json();
                })
                .then(function (result) {
                    return wait(800).then(function () {
                        that._oBusyDialog.setText("Verifying data integrity...");
                        return wait(1200).then(function () { return result; });
                    });
                })
                .then(function (result) {
                    that._oBusyDialog.close();
                    that.loadCompanies();
                    
                    if (result.success) {
                        if (result.newVersions > 0) {
                            MessageBox.success(result.message);
                            // AUTOMATIC UI REFRESH
                            that.loadData();
                        } else {
                            MessageToast.show(result.message);
                            // Refresh anyway to ensure header stats are latest
                            that.loadData();
                        }
                    } else {
                        var msg = result.error + ": " + (result.details || "");
                        if (result.tip) { msg += "\n\nTip: " + result.tip; }
                        MessageBox.error(msg);
                    }
                })
                .catch(function (e) {
                    that._oBusyDialog.close();
                    MessageBox.error("Verification Failed: " + e.message);
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
