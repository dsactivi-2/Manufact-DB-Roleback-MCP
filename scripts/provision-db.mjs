import fs from "node:fs";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { aivenProjectCa } from "../src/aiven-ca.ts";

const path = new URL("../../mysql-client.local.cnf", import.meta.url);
const text = fs.readFileSync(path, "utf8");
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
const localPath = new URL("../.gateway-runtime.local.json", import.meta.url);
const runtime = fs.existsSync(localPath)
  ? JSON.parse(fs.readFileSync(localPath, "utf8"))
  : { user: "crm_cf_gateway_" + crypto.randomBytes(4).toString("hex"), password: crypto.randomBytes(36).toString("base64url"),
      serviceToken: crypto.randomBytes(48).toString("base64url"),
      host: config.host, port: Number(config.port), database: "jsicrm" };
fs.writeFileSync(localPath, JSON.stringify(runtime, null, 2));
const allowed = {
  idk_kandidati: ["kandidat_id", "kandidat_ime", "kandidat_prezime", "kandidat_status",
    "kandidat_datumrodjenja", "kandidat_drzavljanstvo_vrsta", "kandidat_group"],
  idk_companies: ["company_id", "company_name", "company_country", "company_status"],
  idk_nalozi: ["nalog_id", "nalog_naziv", "nalog_opis", "nalog_status"],
  idk_kandidat_radno_iskustvo: ["kri_kandidat_id", "kri_pozicija", "kri_darum_od", "kri_datum_do"],
  idk_kandidat_jezici: ["kj_kandidatid", "kj_naziv", "kj_slusanje", "kj_citanje", "kj_pisanje"],
  idk_kandidat_edukacija: ["ke_kandidat_id", "ke_naziv", "ke_naziv_kvalifikacije"],
  idk_kandidati_grupe: ["kg_id", "kg_title"],
  idk_kandidat_status: ["status_id", "status_naziv"],
};
async function main() {
  const admin = await mysql.createConnection({
    host: config.host, port: Number(config.port), user: config.user, password: config.password,
    database: config.database, ssl: { ca: aivenProjectCa, rejectUnauthorized: true }, connectTimeout: 15000,
  });
  try {
    await admin.query("CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ?", [runtime.user, runtime.password]);
    for (const [table, columns] of Object.entries(allowed)) {
      const identifiers = columns.map((c) => "`" + c + "`").join(", ");
      await admin.query("GRANT SELECT (" + identifiers + ") ON `jsicrm`.`" + table + "` TO ?@'%'", [runtime.user]);
    }
  } finally { await admin.end(); }
  const reader = await mysql.createConnection({
    host: runtime.host, port: runtime.port, user: runtime.user, password: runtime.password,
    database: runtime.database, ssl: { ca: aivenProjectCa, rejectUnauthorized: true }, connectTimeout: 15000,
  });
  try {
    const [rows] = await reader.query("SELECT DATABASE() AS db, CURRENT_USER() AS account");
    console.log(JSON.stringify({ connected: true, ...rows[0], permission: "SELECT on approved CRM columns only" }));
  } finally { await reader.end(); }
  fs.writeFileSync(new URL("../cloudflare/worker/aiven-ca.pem", import.meta.url), aivenProjectCa);
}
main().catch((error) => { console.error("PROVISION_FAILED: " + (error.code || "CONNECTION_OR_CONFIGURATION_ERROR")); process.exitCode = 1; });
