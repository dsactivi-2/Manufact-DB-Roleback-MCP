import { createConnection } from "mysql2/promise";
import type { Db } from "../../../src/read.js";

export interface GatewayConnection extends Db {
  close(): Promise<void>;
}
export interface DatabaseEnv {
  HYPERDRIVE_FRESH: { host: string; port: number; user: string; password: string; database: string };
  EXPECTED_DATABASE: string;
}
export async function openGatewayDatabase(env: DatabaseEnv): Promise<GatewayConnection> {
  const binding = env.HYPERDRIVE_FRESH;
  if (!binding || env.EXPECTED_DATABASE !== "jsicrm") {
    console.error(JSON.stringify({event: "database_target_guard", bindingPresent: Boolean(binding), database: binding?.database, expected: env.EXPECTED_DATABASE }));
    throw new Error("DATABASE_TARGET_MISMATCH");
  }
  const connection = await createConnection({
    host: binding.host, port: binding.port, user: binding.user, password: binding.password,
    database: binding.database, disableEval: true, multipleStatements: false,
    connectTimeout: 10000, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
  });
  try {
    const [identity] = await connection.query("SELECT DATABASE() AS database_name");
    const database = Array.isArray(identity) ? (identity[0] as { database_name?: string })?.database_name : undefined;
    if (database !== env.EXPECTED_DATABASE) {
      console.error(JSON.stringify({ event: "database_identity_guard", database, expected: env.EXPECTED_DATABASE }));
      throw new Error("DATABASE_TARGET_MISMATCH");
    }
    // Jedna konekcija, jedna read-only transakcija po zahtjevu.
    await connection.query("START TRANSACTION READ ONLY");
    return {
      async query(sql, params) {
        const [rows] = await connection.query({ sql, timeout: 15000 }, params);
        if (!Array.isArray(rows)) throw new Error("INVALID_DB_RESULT");
        return rows as Array<Record<string, unknown>>;
      },
      async close() {
        try { await connection.rollback(); } finally { await connection.end(); }
      },
    };
  } catch (error) {
    await connection.end();
    throw error;
  }
}


