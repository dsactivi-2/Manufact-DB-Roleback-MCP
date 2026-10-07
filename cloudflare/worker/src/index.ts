import { timingSafeEqual } from "node:crypto";
import { isReadOperation, readSchemas } from "../../../contracts/read.js";
import { runBerufReport, runCandidateSearch, runCompanySearch, runDescribeTable,
  runListTables, runOrderSearch, runProfile, runResolveBeruf, runStats } from "../../../src/read.js";
import { openGatewayDatabase, type DatabaseEnv, type GatewayConnection } from "./db.js";

export interface Env extends DatabaseEnv {
  MCP_SERVICE_TOKEN: string;
  ENVIRONMENT: string;
  WRITES_ENABLED: string;
  RESTORES_ENABLED: string;
}
const MAX_BODY = 16384;
const MAX_RESPONSE = 2 * 1024 * 1024;
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
function failure(code: string, status: number): Response { return json({ error: { code } }, status); }
function authorized(request: Request, expected: string): boolean {
  if (!expected || expected.length < 32) return false;
  const left = Buffer.from(request.headers.get("authorization") ?? "");
  const right = Buffer.from("Bearer " + expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
async function limitedBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length")) > MAX_BODY) throw new Error("BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) return "{}";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new Error("BODY_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
}
export async function handleRequest(
  request: Request, env: Env,
  open: (env: DatabaseEnv) => Promise<GatewayConnection> = openGatewayDatabase,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health" && request.method === "GET") {
    return json({ status: "ok", service: "manufact-db-rollback", version: "0.1.0",
      writes_enabled: env.WRITES_ENABLED === "true", restores_enabled: env.RESTORES_ENABLED === "true" });
  }
  if (url.search) return failure("INVALID_INPUT", 400);
  if (!env.MCP_SERVICE_TOKEN || env.MCP_SERVICE_TOKEN.length < 32) return failure("SERVICE_NOT_CONFIGURED", 503);
  if (!authorized(request, env.MCP_SERVICE_TOKEN)) return failure("AUTH_REQUIRED", 401);
  const route = url.pathname.match(/^\/v1\/read\/([a-z_]+)$/);
  if (!route || !isReadOperation(route[1])) return failure("NOT_FOUND", 404);
  if (request.method !== "POST") return failure("METHOD_NOT_ALLOWED", 405);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return failure("INVALID_INPUT", 400);
  const operation = route[1];
  let input: unknown;
  try { input = readSchemas[operation].parse(JSON.parse(await limitedBody(request))); }
  catch (error) { return failure(error instanceof Error && error.message === "BODY_TOO_LARGE" ? "BODY_TOO_LARGE" : "INVALID_INPUT", 400); }
  // Slobodni SQL ostaje zatvoren dok ne dodamo provjeru polja/parser.
  if (operation === "query") return failure("SQL_GATEWAY_DISABLED", 403);
  let db: GatewayConnection | undefined;
  try {
    db = await open(env);
    let data: unknown;
    switch (operation) {
      case "candidates": data = await runCandidateSearch(db, readSchemas.candidates.parse(input)); break;
      case "companies": data = await runCompanySearch(db, readSchemas.companies.parse(input)); break;
      case "orders": data = await runOrderSearch(db, readSchemas.orders.parse(input)); break;
      case "professions": data = await runBerufReport(db, readSchemas.professions.parse(input)); break;
      case "resolve_profession": data = await runResolveBeruf(db, readSchemas.resolve_profession.parse(input)); break;
      case "profile": data = await runProfile(db, readSchemas.profile.parse(input).kandidat_id); break;
      case "stats": data = await runStats(db); break;
      case "tables": data = await runListTables(db, readSchemas.tables.parse(input).search); break;
      case "describe": data = await runDescribeTable(db, readSchemas.describe.parse(input).table); break;
    }
    const encoded = JSON.stringify({ data });
    if (new TextEncoder().encode(encoded).length > MAX_RESPONSE) return failure("RESULT_TOO_LARGE", 413);
    return new Response(encoded, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "GATEWAY_FAILURE";
    console.error(JSON.stringify({ event: "gateway_failure", code: /^[A-Z0-9_]+$/.test(code) ? code : "GATEWAY_FAILURE", name: error instanceof Error ? error.name : "Unknown", targetMismatch: error instanceof Error && error.message === "DATABASE_TARGET_MISMATCH", evalBlocked: error instanceof Error && /code generation|eval|dynamic/i.test(error.message) }));
    return failure("DEPENDENCY_UNAVAILABLE", 503);
  } finally {
    if (db) { try { await db.close(); } catch { /* Bez privatnih detalja u logovima. */ } }
  }
}
export default { fetch(request: Request, env: Env): Promise<Response> { return handleRequest(request, env); } };



