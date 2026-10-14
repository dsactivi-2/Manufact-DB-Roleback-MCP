import fs from "node:fs";
import mysql from "mysql2/promise";
import { aivenProjectCa } from "../src/aiven-ca.ts";

const runtimePath = new URL("../.gateway-runtime.local.json", import.meta.url);
if (!fs.existsSync(runtimePath)) throw new Error("MISSING_GATEWAY_RUNTIME");
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
  const [rows] = await connection.query(`
    SELECT c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE,
           c.COLUMN_KEY, c.EXTRA, c.ORDINAL_POSITION
    FROM INFORMATION_SCHEMA.COLUMNS c
    JOIN INFORMATION_SCHEMA.TABLES t
      ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
    WHERE c.TABLE_SCHEMA=DATABASE() AND t.TABLE_TYPE='BASE TABLE'
    ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
  `);
  const tables = new Map();
  for (const row of rows) {
    if (!tables.has(row.TABLE_NAME)) tables.set(row.TABLE_NAME, []);
    tables.get(row.TABLE_NAME).push({
      name: row.COLUMN_NAME,
      type: row.DATA_TYPE,
      nullable: row.IS_NULLABLE === "YES",
      primary: row.COLUMN_KEY === "PRI",
      generated: String(row.EXTRA).includes("GENERATED"),
    });
  }
  const inventory = [...tables.entries()].map(([table, columns]) => ({
    table,
    primaryKey: columns.filter((column) => column.primary).map((column) => column.name),
    columnCount: columns.length,
    columns,
  }));
  const summary = process.argv.includes("--summary")
    ? inventory.map(({ table, primaryKey, columnCount }) => ({ table, primaryKey, columnCount }))
    : inventory;
  console.log(JSON.stringify({ database: runtime.database, tableCount: inventory.length, tables: summary }, null, 2));
} finally {
  await connection.query("ROLLBACK").catch(() => undefined);
  await connection.end();
}
