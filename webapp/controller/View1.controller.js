sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (Controller, JSONModel, Filter, FilterOperator, MessageBox, MessageToast) {
    "use strict";

    var API_URL         = "/api/http/read-tally";
    var VERSIONS_URL    = "/api/versions";

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
                versionList:   [],
                versionIndex:  0,
                versionLabel:  "",
                hasPrev:       false,
                hasNext:       false,
                busy:          false,
                hasError:      false,
                lastRefreshed: ""
            });
            this.getView().setModel(oModel);
            this.loadVersions()
                .then(this.loadLedgerData.bind(this));
        },

        updateVersionNav: function () {
            var oModel = this.getView().getModel();
            var list = oModel.getProperty("/versionList") || [];
            var idx = oModel.getProperty("/versionIndex") || 0;
            if (list.length === 0) {
                oModel.setProperty("/versionLabel", "No versions");
                oModel.setProperty("/hasPrev", false);
                oModel.setProperty("/hasNext", false);
                return;
            }
            var v = list[idx];
            var d = v.timestamp ? new Date(v.timestamp).toLocaleDateString("en-IN", {
                dateStyle: "medium"
            }) : "?";
            oModel.setProperty("/versionLabel",
                "v" + v.id + " \u2014 " + d + " \u2014 " + v.company + " (" + v.totalRecords + " records)");
            oModel.setProperty("/hasPrev", idx > 0);
            oModel.setProperty("/hasNext", idx < list.length - 1);
            oModel.setProperty("/selectedVersionId", v.id);
        },

        loadVersions: function () {
            var oModel = this.getView().getModel();
            return fetch(VERSIONS_URL, { method: "GET", headers: { "Accept": "application/json" } })
                .then(function (r) { return r.json(); })
                .then(function (list) {
                    oModel.setProperty("/versionList", list);
                    oModel.setProperty("/versionIndex", list.length > 0 ? list.length - 1 : 0);
                    this.updateVersionNav();
                }.bind(this))
                .catch(function (e) {
                    console.log("[View1] loadVersions failed:", e.message);
                });
        },

        loadLedgerData: function (retryCount) {
            retryCount = retryCount || 0;
            var oModel = this.getView().getModel();
            oModel.setProperty("/busy", true);
            oModel.setProperty("/hasError", false);

            var versionId = oModel.getProperty("/selectedVersionId");
            var url = versionId ? API_URL + "?v=" + versionId : API_URL;

            console.log("[View1] calling API at:", url);
            fetch(url, {
                method:  "GET",
                headers: { "Accept": "application/json" }
            })
            .then(function (r) {
                if (!r.ok) {
                    return r.text().then(function (body) {
                        throw new Error("API error [HTTP " + r.status + "]: " + body.substring(0, 500));
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

                MessageToast.show("Loaded " + aRows.length + " records");
            }.bind(this))
            .catch(function (e) {
                console.log("[View1] loadLedgerData FAILED:", e.message);
                oModel.setProperty("/busy", false);
                oModel.setProperty("/hasError", true);

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

        onPrevVersion: function () {
            var oModel = this.getView().getModel();
            var idx = oModel.getProperty("/versionIndex") || 0;
            if (idx > 0) {
                oModel.setProperty("/versionIndex", idx - 1);
                this.updateVersionNav();
                this.loadLedgerData();
            }
        },

        onNextVersion: function () {
            var oModel = this.getView().getModel();
            var idx = oModel.getProperty("/versionIndex") || 0;
            var list = oModel.getProperty("/versionList") || [];
            if (idx < list.length - 1) {
                oModel.setProperty("/versionIndex", idx + 1);
                this.updateVersionNav();
                this.loadLedgerData();
            }
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

            var oModel = this.getView().getModel();
            oModel.setProperty("/busy", true);

            this.loadVersions()
                .then(function () {
                    this.updateVersionNav();
                    this.loadLedgerData();
                }.bind(this));
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
