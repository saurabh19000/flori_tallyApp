/* global QUnit */
QUnit.config.autostart = false;

sap.ui.require(["app/tallyapp/test/integration/AllJourneys"
], function () {
	QUnit.start();
});
