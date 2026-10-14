import fs from "node:fs";
import mysql from "mysql2/promise";
import { aivenProjectCa } from "../src/aiven-ca.ts";

const runtimePath = new URL("../.gateway-runtime.local.json", import.meta.url);
if (!fs.existsSync(runtimePath)) {
  console.error("MISSING_GATEWAY_RUNTIME");
  process.exit(1);
}

const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
const connection = await mysql.createConnection({
  host: runtime.host,
  port: runtime.port,
  user: runtime.user,
  password: runtime.password,
  database: runtime.database,
  ssl: { ca: aivenProjectCa, rejectUnauthorized: true },
});

try {
  await connection.query("START TRANSACTION READ ONLY");
  const [rows] = await connection.execute(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?, ?) ORDER BY TABLE_NAME",
    ["rb_events", "rb_outbox"],
  );
  const tables = rows.map((row) => row.TABLE_NAME);
  let outbox = [];
  let latestArchivedEventId = null;
  if (tables.length === 2) {
    const [counts] = await connection.query(
      "SELECT status, COUNT(*) AS count FROM rb_outbox GROUP BY status ORDER BY status",
    );
    outbox = counts.map((row) => ({ status: row.status, count: Number(row.count) }));
    const [latest] = await connection.query(
      "SELECT event_id FROM rb_outbox WHERE status='archived' ORDER BY archived_at DESC LIMIT 1",
    );
    latestArchivedEventId = latest[0]?.event_id ?? null;
  }
  console.log(JSON.stringify({ database: runtime.database, tables, outbox, latestArchivedEventId }));
  if (tables.length !== 2) process.exitCode = 2;
} finally {
  await connection.query("ROLLBACK").catch(() => undefined);
  await connection.end();
}
