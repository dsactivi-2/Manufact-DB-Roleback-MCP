import mysql from "mysql2/promise";
import { assertSafeDatabaseTarget } from "../isolation.js";
import { wrap, type SqlSession } from "../sql-session.js";

export interface HyperdriveBinding {
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
}

export async function openHyperdrive(binding: HyperdriveBinding): Promise<SqlSession> {
  assertSafeDatabaseTarget(binding.host, binding.database);
  const connection = await mysql.createConnection({
    host: binding.host,
    user: binding.user,
    password: binding.password,
    database: binding.database,
    port: binding.port,
    disableEval: true,
    multipleStatements: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  return wrap(connection);
}
