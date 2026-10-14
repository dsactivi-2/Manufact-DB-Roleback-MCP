import crypto from "node:crypto";
import fs from "node:fs";
import mysql from "mysql2/promise";
import { aivenProjectCa } from "../src/aiven-ca.ts";

const configPath = new URL("../../mysql-client.local.cnf", import.meta.url);
const outputPath = new URL("../.env.test.local", import.meta.url);
const config = parseCnf(fs.readFileSync(configPath, "utf8"));

if (config.database !== "jsicrm" || config.host !== "mysql-d7a5876-dsactivi-d23a.l.aivencloud.com") {
  throw new Error("ADMIN_TARGET_MISMATCH");
}

const username = "rollback_test_" + crypto.randomBytes(4).toString("hex");
const password = crypto.randomBytes(36).toString("base64url");
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
  await admin.query("CREATE DATABASE IF NOT EXISTS `rollback_test`");
  await admin.query("CREATE USER ?@'%' IDENTIFIED BY ?", [username, password]);
  await admin.query("GRANT ALL PRIVILEGES ON `rollback_test`.* TO ?@'%'", [username]);
} finally {
  await admin.end();
}

const url = new URL("mysql://localhost/rollback_test");
url.hostname = config.host;
url.port = String(config.port);
url.username = username;
url.password = password;
fs.writeFileSync(outputPath, `MYSQL_TEST_URL=${url.href}\n`, { encoding: "utf8", mode: 0o600 });

const test = await mysql.createConnection({
  host: config.host,
  port: Number(config.port),
  user: username,
  password,
  database: "rollback_test",
  ssl: { ca: aivenProjectCa, rejectUnauthorized: true },
  connectTimeout: 15000,
});
try {
  const [rows] = await test.query("SELECT DATABASE() AS selected_database, CURRENT_USER() AS account");
  console.log(JSON.stringify({ created: true, selected_database: rows[0]?.selected_database, account: rows[0]?.account }));
} finally {
  await test.end();
}

function parseCnf(text) {
  const parsed = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([a-z-]+)\s*=\s*(.*)$/i);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\(["\\])/g, "$1");
    parsed[match[1]] = value;
  }
  return parsed;
}
