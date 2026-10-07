import mysql from "mysql2/promise";

export interface SqlResult {
  rows: Array<Record<string, unknown>>;
  affectedRows: number;
}

export interface SqlSession {
  query(sql: string, params?: unknown[]): Promise<SqlResult>;
  release(): Promise<void>;
}

export async function openMysqlUrl(raw: string): Promise<SqlSession> {
  const connection = await mysql.createConnection({
    uri: raw,
    multipleStatements: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    disableEval: true,
  });
  return wrap(connection);
}

export function wrap(connection: mysql.Connection): SqlSession {
  return {
    async query(sql, params = []) {
      const [result] = await connection.query(sql, params as never[]);
      if (Array.isArray(result)) return { rows: result as Array<Record<string, unknown>>, affectedRows: result.length };
      const header = result as mysql.ResultSetHeader;
      return { rows: [], affectedRows: header.affectedRows };
    },
    async release() {
      await connection.end();
    },
  };
}

export function isDuplicate(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY");
}
