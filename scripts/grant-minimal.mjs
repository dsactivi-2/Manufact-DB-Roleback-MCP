import fs from "node:fs";
import { registerHooks } from "node:module";
import mysql from "mysql2/promise";
import { aivenProjectCa } from "../src/aiven-ca.ts";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js") && context.parentURL) {
      const tsUrl = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(tsUrl))) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const apply = process.argv.includes("--apply");
const cnfPath = new URL("../../mysql-client.local.cnf", import.meta.url);
const text = fs.readFileSync(cnfPath, "utf8");
const config = {};
for (const line of text.split(/\r?\n/)) {
  const match = line.match(/^([a-z-]+)\s*=\s*(.*)$/i);
  if (!match) continue;
  let value = match[2].trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\(["\\])/g, "$1");
  config[match[1]] = value;
}
if (config.database !== "jsicrm" || config.host !== "mysql-d7a5876-dsactivi-d23a.l.aivencloud.com") {
  throw new Error("DATABASE_TARGET_MISMATCH");
}
const runtime = JSON.parse(fs.readFileSync(new URL("../.gateway-runtime.local.json", import.meta.url), "utf8"));
if (runtime.database !== "jsicrm" || runtime.user !== "crm_cf_gateway_3b154dc8") {
  throw new Error("RUNTIME_USER_MISMATCH");
}

function quoteColumns(columns) {
  return columns.map((column) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(column)) throw new Error("COLUMN_NAME_REJECTED");
    return "`" + column + "`";
  }).join(", ");
}

function quoteTable(table) {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error("TABLE_NAME_REJECTED");
  return "`jsicrm`.`" + table + "`";
}

const { minimalPrivileges } = await import("../src/db-privileges.ts");
const privileges = minimalPrivileges();
const statements = [];
for (const item of privileges) {
  if (item.delete || item.drop || (!item.table.startsWith("rb_") && item.insert)) throw new Error("PRIVILEGE_POLICY_REJECTED");
  const table = quoteTable(item.table);
  if (item.select.length > 0) statements.push("GRANT SELECT (" + quoteColumns(item.select) + ") ON " + table + " TO ?@'%'");
  if (item.update.length > 0) statements.push("GRANT UPDATE (" + quoteColumns(item.update) + ") ON " + table + " TO ?@'%'");
  if (item.insertColumns.length > 0) statements.push("GRANT INSERT (" + quoteColumns(item.insertColumns) + ") ON " + table + " TO ?@'%'");
  if (item.insert) statements.push("GRANT SELECT, INSERT, UPDATE ON " + table + " TO ?@'%'");
}

function unsafe(grant) {
  const history = /["']rb_|rb_/.test(grant);
  const childInsert = /idk_kandidat_(radno_iskustvo|edukacija|jezici)/.test(grant);
  const forbidden = /\b(DELETE|DROP|ALTER|CREATE|INDEX|REFERENCES|TRIGGER|GRANT OPTION|ALL PRIVILEGES)\b/i.test(grant);
  return forbidden || (/INSERT/i.test(grant) && !history && !childInsert);
}

const admin = await mysql.createConnection({
  host: config.host,
  port: Number(config.port),
  user: config.user,
  password: config.password,
  database: config.database,
  ssl: { ca: aivenProjectCa, rejectUnauthorized: true },
  connectTimeout: 15000,
});

try {
  if (apply) {
    for (const statement of statements) await admin.query(statement, [runtime.user]);
  }
  const [rows] = await admin.query("SHOW GRANTS FOR ?@'%'", [runtime.user]);
  const grants = rows.map((row) => Object.values(row)[0]);
  const blocked = grants.filter(unsafe);
  if (blocked.length > 0) {
    console.log(JSON.stringify({ blocked: blocked.map((grant) => String(grant).replaceAll(runtime.user, "crm_gateway")) }, null, 2));
    throw new Error("UNSAFE_GRANT_PRESENT");
  }
  console.log(JSON.stringify({
    applied: apply,
    user: runtime.user,
    database: "jsicrm",
    statements: statements.length,
    grants: grants.map((grant) => String(grant).replaceAll(runtime.user, "crm_gateway")),
  }, null, 2));
  const reader = await mysql.createConnection({
    host: runtime.host,
    port: runtime.port,
    user: runtime.user,
    password: runtime.password,
    database: runtime.database,
    ssl: { ca: aivenProjectCa, rejectUnauthorized: true },
    connectTimeout: 15000,
  });
  try {
    await reader.beginTransaction();
    await reader.query("UPDATE idk_kandidati SET kandidat_ime=kandidat_ime WHERE 1=0");
    let deleteDenied = false;
    try { await reader.query("DELETE FROM idk_kandidati WHERE 1=0"); } catch (error) { deleteDenied = error.errno === 1142; }
    let dropDenied = false;
    try { await reader.query("DROP TABLE rb_privilege_probe_absent"); } catch (error) { dropDenied = error.errno === 1142; }
    if (!deleteDenied || !dropDenied) throw new Error("DELETE_OR_DROP_WAS_ALLOWED");
    console.log(JSON.stringify({ updateNoop: true, deleteDenied: true, dropDenied: true }));
  } finally {
    await reader.rollback();
    await reader.end();
  }
} finally {
  await admin.end();
}

