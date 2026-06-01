sap.ui.define([
    "sap/ui/core/mvc/Controller"
], function (Controller) {
    "use strict";

    /**
     * App.controller.js — Shell Controller (intentionally minimal)
     *
     * App.view.xml is a thin <App id="app"/> shell.
     * The SAP UI5 router reads manifest.json → routing.config.controlId = "app"
     * and automatically injects View1.view.xml into this shell's pages aggregation.
     *
     * ALL dashboard logic lives in:
     *   webapp/controller/View1.controller.js
     *   webapp/view/View1.view.xml
     */
    return Controller.extend("app.tallyapp.controller.App", {

        onInit: function () {
            // Intentionally empty — router handles navigation
        }

    });
});