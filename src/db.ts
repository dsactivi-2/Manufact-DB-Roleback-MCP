import mysql from "mysql2/promise";
import { aivenProjectCa } from "./aiven-ca.js";
import { databaseUrl } from "./guard.js";
import type { Db } from "./read.js";

const ready = new WeakSet<object>();

export function safeDbError(error: unknown): Error {
  const code = error && typeof error === "object" && "code" in error ? error.code : "";
  const safeCode = typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "";
  const raw = error instanceof Error ? error.message : "";
  const detail = raw
    .split(/\s+/)
    .filter((part) => part.length > 0 && !part.includes("://") && !part.includes("@") && !part.toLowerCase().includes("password"))
    .join(" ");
  const usable = detail.length <= 180 && /certificate|SSL|handshake|ECONN|ETIMEDOUT|getaddrinfo|connect|timed out/i.test(detail) ? detail : "";
  const base = safeCode ? "Datenbankabfrage fehlgeschlagen (" + safeCode + ")." : "Datenbankabfrage fehlgeschlagen.";
  return new Error(usable ? base + " " + usable : base);
}

export function parseDatabaseConfig(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("CRM_DATABASE_URL ist keine gueltige Adresse.");
  }
  if (url.protocol !== "mysql:") throw new Error("CRM_DATABASE_URL muss eine MySQL-Adresse sein.");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!url.hostname || !database || !user || !password) {
    throw new Error("CRM_DATABASE_URL braucht Host, Datenbank, Benutzer und Passwort.");
  }
  const port = url.port ? Number(url.port) : 3306;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("CRM_DATABASE_URL hat keinen gueltigen Port.");
  return {
    host: url.hostname,
    port,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: true, ca: aivenProjectCa },
    connectTimeout: 15_000,
    connectionLimit: 4,
    waitForConnections: true,
    enableKeepAlive: true,
    multipleStatements: false,
    dateStrings: true,
    namedPlaceholders: false,
  } as const;
}

function cells(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    if (!row || typeof row !== "object") return {};
    const out: Record<string, unknown> = {};
    for (const [key, cell] of Object.entries(row as Record<string, unknown>)) {
      if (typeof cell === "bigint") {
        if (cell > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Zahl ist zu gross.");
        out[key] = Number(cell);
      } else if (Buffer.isBuffer(cell)) {
        out[key] = null;
      } else {
        out[key] = cell;
      }
    }
    return out;
  });
}

export function openDatabase(env: NodeJS.ProcessEnv = process.env): Db {
  const config = parseDatabaseConfig(databaseUrl(env));
  const pool = mysql.createPool(config);
  return {
    async query(sql, params) {
      let connection: mysql.PoolConnection | undefined;
      try {
        connection = await pool.getConnection();
        if (!ready.has(connection)) {
          await connection.query("SET SESSION transaction_read_only = 1");
          ready.add(connection);
        }
        const [rows] = await connection.query(sql, params);
        return cells(rows);
      } catch (error) {
        throw safeDbError(error);
      } finally {
        connection?.release();
      }
    },
  };
}
