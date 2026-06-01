sap.ui.define([
    "sap/ui/core/UIComponent",
    "app/tallyapp/model/models"
], function (UIComponent, models) {
    "use strict";

    return UIComponent.extend("app.tallyapp.Component", {
        metadata: {
            manifest: "json",
            interfaces: [
                "sap.ui.core.IAsyncContentCreation"
            ]
        },

        init: function () {
            // Call the base component's init function
            UIComponent.prototype.init.apply(this, arguments);

            // Set the device model
            this.setModel(models.createDeviceModel(), "device");

            // Enable routing
            this.getRouter().initialize();
        }
    });
});