import { sha256 } from "../canonical.js";
import { readSchemas } from "../../contracts/read.js";
import { ZodError } from "zod";
import { asCrmError, CrmError } from "../crm-error.js";
import { applyChange, insertApproval, listHistory, previewChange, restorePatchFromEvent, type ChangeInput } from "../history.js";
import { actorFromSharedToken, canWrite, sameSecret, verifyAssertion, WORKER_AUDIENCE, type Actor } from "../identity.js";
import { assertIsolatedTarget, assertSafeDatabaseTarget } from "../isolation.js";
import { archiveDue, assertNoPhysicalDelete, type ArchivePut } from "../outbox.js";
import { runBerufReport, runCandidateSearch, runCompanySearch, runCrmQuery, runDescribeTable, runListTables, runOrderSearch, runProfile, runResolveBeruf, runStats, type Db } from "../read.js";
import type { SqlSession } from "../sql-session.js";
import { openHyperdrive, type HyperdriveBinding } from "./hyperdrive.js";

export interface WorkerEnv {
  ENVIRONMENT?: string;
  WRITES_ENABLED?: string;
  RESTORES_ENABLED?: string;
  REQUIRE_APPROVAL?: string;
  ALLOW_TEST_ENTITIES?: string;
  MCP_SERVICE_TOKEN?: string;
  IDENTITY_ASSERTION_PUBLIC_KEY?: string;
  HYPERDRIVE_CONFIG_ID?: string;
  CRM_HYPERDRIVE_ID?: string;
  CRM_DATABASE_URL?: string;
  DATABASE_URL?: string;
  CRM_WORKER_BASE_URL?: string;
  HYPERDRIVE_FRESH?: HyperdriveBinding;
  AUDIT_ARCHIVE?: ArchivePut;
}

export interface WorkerDeps {
  openSession?: () => Promise<SqlSession>;
  host?: string;
  now?: Date;
  archive?: ArchivePut;
}

export async function handleWorker(request: Request, env: WorkerEnv, deps: WorkerDeps = {}): Promise<Response> {
  try {
    assertIsolatedTarget(env);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json(200, { ok: true, result: { environment: env.ENVIRONMENT ?? "unset", writes_enabled: env.WRITES_ENABLED === "true", restores_enabled: env.RESTORES_ENABLED === "true", database: "not-checked" } });
    }
    if (request.method !== "POST") throw new CrmError("INVALID_INPUT", "Methode ist nicht erlaubt.");
    assertService(request, env.MCP_SERVICE_TOKEN ?? "");
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 16384) throw new CrmError("INVALID_INPUT", "Anfrage ist zu gross.");
    const identity = request.headers.get("x-crm-identity") ?? "";
    const readRoute = url.pathname.startsWith("/v1/read/");
    const actor = identity
      ? await verifyAssertion(env.IDENTITY_ASSERTION_PUBLIC_KEY ?? "", identity, { audience: WORKER_AUDIENCE, requestSha256: sha256(raw) })
      : readRoute ? actorFromSharedToken() : (() => { throw new CrmError("AUTH_REQUIRED", "Potpisani identitet nedostaje.", 401); })();
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    assertNoPhysicalDelete(url.pathname.split("/").at(-1) ?? "");
    const result = await withSession(env, deps, async (session) => route(url.pathname, body, actor, env, session, deps));
    return json(200, readRoute ? { ok: true, result, data: result } : { ok: true, result });
  } catch (error) {
    const crm = error instanceof CrmError ? error : error instanceof SyntaxError || error instanceof ZodError ? new CrmError("INVALID_INPUT", "Ulaz nije ispravan.") : asCrmError(error);
    return json(crm.status, { ok: false, error: { code: crm.code, message: crm.message } });
  }
}

async function route(path: string, body: Record<string, unknown>, actor: Actor, env: WorkerEnv, session: SqlSession, deps: WorkerDeps): Promise<unknown> {
  const db = asDb(session);
  if (path === "/v1/read/candidates") return runCandidateSearch(db, readSchemas.candidates.parse(body));
  if (path === "/v1/read/companies") return runCompanySearch(db, readSchemas.companies.parse(body));
  if (path === "/v1/read/orders") return runOrderSearch(db, readSchemas.orders.parse(body));
  if (path === "/v1/read/profile") return runProfile(db, readSchemas.profile.parse(body).kandidat_id);
  if (path === "/v1/read/stats") { readSchemas.stats.parse(body); return runStats(db); }
  if (path === "/v1/read/tables") return runListTables(db, readSchemas.tables.parse(body).search);
  if (path === "/v1/read/describe") return runDescribeTable(db, readSchemas.describe.parse(body).table);
  if (path === "/v1/read/query") throw new CrmError("SQL_GATEWAY_DISABLED", "Slobodni SQL je zatvoren.", 403);
  if (path === "/v1/read/professions" || path === "/v1/read/beruf-report") return runBerufReport(db, readSchemas.professions.parse(body));
  if (path === "/v1/read/resolve_profession" || path === "/v1/read/beruf-resolve") return runResolveBeruf(db, readSchemas.resolve_profession.parse(body));
  if (path === "/v1/history/list") return listHistory(session, String(body.entity_type ?? ""), String(body.entity_id ?? ""));
  const requestedFault = body.fail_before;
  let failBefore: "event" | "after-commit" | undefined;
  if (env.ALLOW_TEST_ENTITIES === "true" && (requestedFault === "event" || requestedFault === "after-commit")) failBefore = requestedFault;
  const options = { allowTestEntities: env.ALLOW_TEST_ENTITIES === "true", requireApproval: env.REQUIRE_APPROVAL !== "false", now: deps.now, failBefore };
  if (path === "/v1/changes/preview") return previewChange(session, changeInput(body, "change"), options);
  if (path === "/v1/changes/apply") {
    if (env.WRITES_ENABLED !== "true") throw new CrmError("WRITES_DISABLED", "Schreiben ist aus.", 403);
    if (!canWrite(actor)) throw new CrmError("FORBIDDEN", "Lesetoken oder unbekannte Identitaet darf nicht schreiben.", 403);
    return applyChange(session, changeInput(body, "change"), actor, options);
  }
  if (path === "/v1/restores/preview") {
    const patch = await restorePatchFromEvent(session, String(body.entity_type ?? ""), String(body.entity_id ?? ""), String(body.source_event_id ?? ""), stringList(body.fields));
    return previewChange(session, changeInput({ ...body, patch }, "restore"), options);
  }
  if (path === "/v1/restores/apply") {
    if (env.RESTORES_ENABLED !== "true") throw new CrmError("WRITES_DISABLED", "Wiederherstellen ist aus.", 403);
    if (!canWrite(actor)) throw new CrmError("FORBIDDEN", "Lesetoken oder unbekannte Identitaet darf nicht wiederherstellen.", 403);
    const patch = await restorePatchFromEvent(session, String(body.entity_type ?? ""), String(body.entity_id ?? ""), String(body.source_event_id ?? ""), stringList(body.fields));
    return applyChange(session, changeInput({ ...body, patch }, "restore"), actor, options);
  }
  if (path === "/v1/outbox/drain") {
    if (!canWrite(actor)) throw new CrmError("FORBIDDEN", "Archivierung braucht eine Schreibidentitaet.", 403);
    return archiveDue(session, deps.archive ?? env.AUDIT_ARCHIVE ?? missingArchive(), deps.now);
  }
  if (path === "/v1/approvals") throw new CrmError("FORBIDDEN", "Freigaben setzt kein MCP-Tool.", 403);
  throw new CrmError("INVALID_INPUT", "Route ist nicht vorhanden.");
}

async function withSession<T>(env: WorkerEnv, deps: WorkerDeps, fn: (session: SqlSession) => Promise<T>): Promise<T> {
  const session = deps.openSession ? await deps.openSession() : await openHyperdrive(requiredBinding(env));
  try {
    const selected = await session.query("SELECT DATABASE() AS selected_database");
    try {
      assertSafeDatabaseTarget(deps.host ?? env.HYPERDRIVE_FRESH?.host ?? "", String(selected.rows[0]?.selected_database ?? ""));
    } catch (error) {
      throw new CrmError("FORBIDDEN", error instanceof Error ? error.message : "Datenbankziel ist gesperrt.", 403);
    }
    return await fn(session);
  } finally {
    await session.release();
  }
}

function requiredBinding(env: WorkerEnv): HyperdriveBinding {
  if (!env.HYPERDRIVE_FRESH?.host) throw new CrmError("DEPENDENCY_UNAVAILABLE", "Cachefreies Hyperdrive ist nicht verbunden.", 503);
  return env.HYPERDRIVE_FRESH;
}

function asDb(session: SqlSession): Db {
  return { async query(sql, params) { return (await session.query(sql, params)).rows; } };
}

function assertService(request: Request, expected: string): void {
  const header = request.headers.get("authorization") ?? "";
  if (!sameSecret(header.replace(/^Bearer /, ""), expected)) throw new CrmError("AUTH_REQUIRED", "Worker-Anmeldung fehlt.", 401);
}

function changeInput(body: Record<string, unknown>, operation: "change" | "restore"): ChangeInput {
  const patch = body.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new CrmError("INVALID_INPUT", "Patch fehlt.");
  return {
    operation,
    entity_type: String(body.entity_type ?? ""),
    entity_id: String(body.entity_id ?? ""),
    expected_revision: String(body.expected_revision ?? ""),
    patch: patch as Record<string, string | null>,
    reason: String(body.reason ?? ""),
    idempotency_key: String(body.idempotency_key ?? ""),
    approval_id: typeof body.approval_id === "string" ? body.approval_id : undefined,
    source_event_id: typeof body.source_event_id === "string" ? body.source_event_id : null,
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new CrmError("INVALID_INPUT", "Feldliste ist ungueltig.");
  return value as string[];
}

function missingArchive(): ArchivePut {
  return { async put() { throw new CrmError("DEPENDENCY_UNAVAILABLE", "Auditarchiv ist nicht verbunden.", 503); } };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export { insertApproval };
