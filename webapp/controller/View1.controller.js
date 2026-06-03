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

    return Controller.extend("app.tallyapp.controller.View1", {

        onInit: function () {
            var oModel = new JSONModel({
                company:       "",
                dataType:      "",
                syncId:        "",
                timestamp:     "",
                totalRecords:  0,
                cpiMessageId:  "",
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
            this.loadData();
            this._startAutoRefresh();
        },

        _startAutoRefresh: function () {
            if (this._refreshTimer) { clearInterval(this._refreshTimer); }
            this._refreshTimer = setInterval(function () {
                this.loadData();
            }.bind(this), 15000);
        },

        loadData: function () {
            var oModel = this.getView().getModel();
            oModel.setProperty("/busy", true);
            oModel.setProperty("/hasError", false);

            Promise.all([
                fetch(CAP_URL + "/Syncs?$orderby=pushedAt desc&$top=1").then(function (r) { return r.json(); }),
                fetch(CAP_URL + "/Ledgers").then(function (r) { return r.json(); })
            ])
            .then(function (results) {
                var syncs = results[0].value || [];
                var ledgers = results[1].value || [];
                var latest = syncs[0] || {};

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

                oModel.setProperty("/data", ledgers);
                oModel.setProperty("/totalRecords", ledgers.length);
                oModel.setProperty("/lastRefreshed",
                    "Last refreshed: " + new Date().toLocaleTimeString("en-IN"));
                oModel.setProperty("/busy", false);

                MessageToast.show("Loaded " + ledgers.length + " records from CAP");
            })
            .catch(function (e) {
                console.log("[View1] loadData FAILED:", e.message);
                oModel.setProperty("/busy", false);
                oModel.setProperty("/hasError", true);
                MessageBox.error("Unable to fetch data.\n\nError: " + (e.message || "Unknown error"));
            });
        },

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
            this.loadData();
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
        }
    });
});
