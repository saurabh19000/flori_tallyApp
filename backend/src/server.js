const express = require("express");
const cors = require("cors");
const { router, odataRouter } = require("./routes");

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/api", router);
app.use("/odata", odataRouter);

app.listen(PORT, () => {
    console.log("──────────────────────────────────────────────");
    console.log("  Tally Backend  →  http://localhost:" + PORT);
    console.log("  GET  /api/versions           (list all versions)");
    console.log("  GET  /api/versions/:id       (get version by id)");
    console.log("  GET  /api/http/read-tally    (latest version)");
    console.log("  GET  /api/http/read-tally/fresh  (fresh from CPI with metadata)");
    console.log("  POST /api/ingest            (ingest from external middleware)");
    console.log("  POST /api/push               (generic push)");
    console.log("  POST /api/push/ledgers       (ledgers push)");
    console.log("  POST /api/push/vouchers      (vouchers push)");
    console.log("  POST /api/push/stock-items   (stock push)");
    console.log("  POST /api/refresh            (trigger refresh)");
    console.log("  GET  /api/health             (health check)");
    console.log("──────────────────────────────────────────────");
});
