const express = require("express");
const cors = require("cors");
const { router } = require("./routes");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/api", router);

app.listen(PORT, () => {
    console.log("──────────────────────────────────────────────");
    console.log("  Tally Backend  →  http://localhost:" + PORT);
    console.log("  GET  /api/http/read-tally  (latest sync)");
    console.log("  POST /api/push              (generic push)");
    console.log("  POST /api/push/ledgers      (ledgers push)");
    console.log("  POST /api/push/vouchers     (vouchers push)");
    console.log("  POST /api/push/stock-items  (stock push)");
    console.log("  POST /api/refresh           (re-fetch from CPI)");
    console.log("  GET  /api/health            (health check)");
    console.log("──────────────────────────────────────────────");
});
