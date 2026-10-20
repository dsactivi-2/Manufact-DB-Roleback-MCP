import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
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

import assert from "node:assert/strict";
import test from "node:test";

const { sha256 } = await import("../src/canonical.ts");
const { canonicalJson } = await import("../src/canonical.ts");
const { archiveDue } = await import("../src/outbox.ts");
const { assertMcpMutationConfiguration, workerConfigurationErrors } = await import("../src/config.ts");
const { assertSeparateInfrastructure } = await import("../src/guard.ts");
const { actorFromOAuth, actorFromSharedToken, canWrite, exportPem, principalHash, signAssertion, verifyAssertion, WORKER_AUDIENCE } = await import("../src/identity.ts");
const { decideApproval, insertApproval, requestApproval } = await import("../src/history.ts");
const { assertWritableEntity, entityByType, publicEntityPolicies } = await import("../src/registry.ts");
const { handleWorker } = await import("../src/worker/http.ts");
const { canApproveWrite, canAutomaticWrite, canReadEntity, canRequestWrite, permissionsFromRoles, rolesFromPayload } = await import("../src/permissions.ts");
const { entityRequiresApproval } = await import("../src/permissions.ts");
const { minimalPrivileges } = await import("../src/db-privileges.ts");
const workerEntrypoint = (await import("../src/worker/index.ts")).default;

test("stari Hyperdrive ciljevi ostaju zabranjeni, odobreni jsicrm je dozvoljen", () => {
  assert.throws(() => assertSeparateInfrastructure({ CRM_HYPERDRIVE_ID: "71d03de751b74a5ca1f71dd382328c2b" }), /verboten/);
  assert.throws(() => assertSeparateInfrastructure({ CRM_DATABASE_URL: "mysql://user:pw@activi-dsactivi-d23a.b.aivencloud.com:26718/defaultdb" }), /verboten/);
  assert.doesNotThrow(() => assertSeparateInfrastructure({ CRM_DATABASE_URL: "mysql://user:pw@mysql-d7a5876-dsactivi-d23a.l.aivencloud.com:26718/jsicrm" }));
  assert.doesNotThrow(() => assertSeparateInfrastructure({}));
});

test("Identitaet bleibt an die Anfrage gebunden und ein Lesetoken schreibt nicht", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const privatePem = await exportPem(pair.privateKey, "pkcs8");
  const publicPem = await exportPem(pair.publicKey, "spki");
  const actor = { issuer: "manufact-db-rollback-mcp", subject: "user-1", scopes: ["crm:read", "crm:write"] };
  const token = await signAssertion(privatePem, { actor, audience: WORKER_AUDIENCE, requestSha256: sha256("{}") });
  const verified = await verifyAssertion(publicPem, token, { audience: WORKER_AUDIENCE, requestSha256: sha256("{}") });
  assert.equal(verified.subject, "user-1");
  assert.equal(canWrite(verified), true);
  assert.equal(canWrite(actorFromSharedToken()), false);
  await assert.rejects(() => verifyAssertion(publicPem, token, { audience: WORKER_AUDIENCE, requestSha256: sha256("{\"other\":true}") }), /passt nicht/);
});

test("Worker trennt Health, Lesetoken und produktives Schema", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const privatePem = await exportPem(pair.privateKey, "pkcs8");
  const publicPem = await exportPem(pair.publicKey, "spki");
  const env = { MCP_SERVICE_TOKEN: "svc", IDENTITY_ASSERTION_PUBLIC_KEY: publicPem, WRITES_ENABLED: "true", ALLOW_TEST_ENTITIES: "true" };
  const health = await handleWorker(new Request("https://worker.test/health"), env);
  assert.equal(health.status, 200);
  const healthBody = await health.json() as { result: { database: string; writes_enabled: boolean } };
  assert.equal(healthBody.result.database, "not-checked");
  assert.equal(healthBody.result.writes_enabled, true);

  async function call(actor: { issuer: string; subject: string; scopes: string[] }, path: string, schema: string, host = "127.0.0.1", raw = "{}") {
    const assertion = await signAssertion(privatePem, { actor, audience: WORKER_AUDIENCE, requestSha256: sha256(raw) });
    return handleWorker(new Request("https://worker.test" + path, { method: "POST", headers: { authorization: "Bearer svc", "x-crm-identity": assertion, "content-type": "application/json" }, body: raw }), env, {
      host,
      openSession: async () => ({ async query(sql: string) { return sql.includes("DATABASE()") ? { rows: [{ selected_database: schema }], affectedRows: 1 } : { rows: [], affectedRows: 0 }; }, async release() {} }),
    });
  }

  const shared = await call(actorFromSharedToken(), "/v1/changes/apply", "rollback_test", "127.0.0.1", JSON.stringify({
    entity_type: "synthetic_candidate", entity_id: "TEST-1", expected_revision: "0",
    patch: { telephone: "+49-1" }, reason: "Kontrollierter Test", idempotency_key: "preview-test-0001",
    approval_id: "11111111-1111-4111-8111-111111111111",
  }));
  assert.equal(shared.status, 403);
  const sharedBody = await shared.json() as { error: { code: string } };
  assert.equal(sharedBody.error.code, "FORBIDDEN");

  const blocked = await call({ issuer: "manufact-db-rollback-mcp", subject: "user-1", scopes: ["crm:write"] }, "/v1/read/stats", "defaultdb");
  assert.equal(blocked.status, 403);
  const deleted = await call(actorFromSharedToken(), "/v1/changes/delete", "rollback_test");
  assert.equal(deleted.status, 400);
  const deletedBody = await deleted.json() as { error: { code: string } };
  assert.equal(deletedBody.error.code, "INVALID_INPUT");
});

test("Scheduled outbox ostaje inertan bez arhivskog bindinga", async () => {
  let task: Promise<unknown> | undefined;
  workerEntrypoint.scheduled({}, {}, { waitUntil(promise) { task = promise; } });
  assert.ok(task);
  await assert.rejects(task, (error: Error & { code?: string }) => error.code === "DEPENDENCY_UNAVAILABLE");
});

test("Mutation preflight odbija djelimicnu ili nesigurnu konfiguraciju", () => {
  assert.throws(() => assertMcpMutationConfiguration({ CRM_MUTATION_TOOLS_ENABLED: "yes" }), /true oder false/);
  assert.throws(() => assertMcpMutationConfiguration({ CRM_MUTATION_TOOLS_ENABLED: "true", CRM_TRANSPORT: "direct" }), /cloudflare/);
  assert.throws(() => assertMcpMutationConfiguration({
    CRM_MUTATION_TOOLS_ENABLED: "true", CRM_TRANSPORT: "cloudflare",
    CRM_IDENTITY_ASSERTION_PRIVATE_KEY: "key", OAUTH_ISSUER: "https://login.example.com",
  }), /CRM_MUTATION_POLICY_VERSION/);
  assert.doesNotThrow(() => assertMcpMutationConfiguration({
    CRM_MUTATION_TOOLS_ENABLED: "true", CRM_TRANSPORT: "cloudflare",
    CRM_IDENTITY_ASSERTION_PRIVATE_KEY: "key", OAUTH_ISSUER: "https://login.example.com",
    CRM_MUTATION_POLICY_VERSION: "approved-v1",
  }));
});

test("Worker preflight zatvara opasne kombinacije zastavica", () => {
  assert.ok(workerConfigurationErrors({ RESTORES_ENABLED: "true", WRITES_ENABLED: "false" }).some((item: string) => item.includes("RESTORES_ENABLED")));
  assert.ok(workerConfigurationErrors({ WRITES_ENABLED: "true", REQUIRE_APPROVAL: "false" }).some((item: string) => item.includes("Approval")));
  assert.ok(workerConfigurationErrors({ ENVIRONMENT: "production", ALLOW_TEST_ENTITIES: "true" }).some((item: string) => item.includes("Produktion")));
  assert.deepEqual(workerConfigurationErrors({ ENVIRONMENT: "production", WRITES_ENABLED: "true", REQUIRE_APPROVAL: "true", IDENTITY_ASSERTION_PUBLIC_KEY: "key" }), []);
  assert.deepEqual(workerConfigurationErrors({ ENVIRONMENT: "staging", WRITES_ENABLED: "true", RESTORES_ENABLED: "true", REQUIRE_APPROVAL: "true", ALLOW_TEST_ENTITIES: "true", IDENTITY_ASSERTION_PUBLIC_KEY: "key" }), []);
});

test("Approval zahtijeva imenovan provider, donosioca odluke i kratak rok", async () => {
  const session = { async query() { throw new Error("QUERY_MUST_NOT_RUN"); }, async release() {} };
  const actor = { issuer: "manufact-db-rollback-mcp", subject: "user-1", scopes: ["crm:write"] };
  const preview = { preview_sha256: "a".repeat(64), operation: "change", entity_type: "synthetic_candidate", entity_id: "TEST-1", entity_revision: "0", source_event_id: null, reason: "test", fields: [] };
  const now = new Date();
  await assert.rejects(() => insertApproval(session, actor, preview, { provider: "x", decisionBy: "operator", decision: "approved", decidedAt: now, expiresAt: new Date(now.getTime() + 60_000) }), /Provider/);
  await assert.rejects(() => insertApproval(session, actor, preview, { provider: "manual", decisionBy: "operator", decision: "approved", decidedAt: now, expiresAt: new Date(now.getTime() + 25 * 60 * 60 * 1000) }), /Laufzeit/);
});

test("poslovni entiteti pocinju sa approve-write, a nesigurne tabele ostaju read-only", () => {
  const policies = publicEntityPolicies();
  assert.equal(policies.length, 8);
  for (const entityType of ["candidate", "company", "order", "candidate_group"]) {
    const policy = policies.find((item) => item.entity_type === entityType);
    assert.equal(policy?.access, "approve_write");
    assert.deepEqual(policy?.available_access, ["read", "approve_write", "write"]);
    assert.equal(policy?.operations.update, true);
    assert.equal(policy?.operations.insert, false);
    assert.equal(policy?.operations.delete, false);
    assert.equal(policy?.operations.drop, false);
    assert.doesNotThrow(() => assertWritableEntity(entityByType(entityType), false));
  }
  for (const entityType of ["candidate_education", "candidate_language", "candidate_experience"]) {
    const policy = policies.find((item) => item.entity_type === entityType);
    assert.equal(policy?.access, "approve_write");
    assert.equal(policy?.operations.insert, true);
    assert.equal(policy?.operations.delete, false);
    assert.ok(policy?.primary_key);
    assert.doesNotThrow(() => assertWritableEntity(entityByType(entityType), false));
  }
  for (const entityType of ["candidate_status"]) {
    const policy = policies.find((item) => item.entity_type === entityType);
    assert.equal(policy?.access, "read");
    assert.deepEqual(policy?.available_access, ["read"]);
    assert.equal(policy?.primary_key, null);
    assert.equal(policy?.operations.insert, false);
    assert.throws(() => assertWritableEntity(entityByType(entityType), false), /gesperrt/);
  }
});

test("WorkOS role iz JWT-a daju samo predvidjene dozvole po entitetu", () => {
  assert.deepEqual(rolesFromPayload({ roles: ["crm-reader-entities", "crm-writer-approval"], role: "crm-approver" }), ["crm-reader-entities", "crm-writer-approval", "crm-approver"]);
  const reader = { issuer: "manufact-db-rollback-mcp", subject: "reader-1", scopes: permissionsFromRoles(["crm-reader-entities"]) };
  assert.equal(canReadEntity(reader, "candidate"), true);
  assert.equal(canRequestWrite(reader, "candidate"), false);

  const requester = { issuer: "manufact-db-rollback-mcp", subject: "writer-1", scopes: permissionsFromRoles(["crm-writer-approval"]) };
  assert.equal(canRequestWrite(requester, "candidate"), true);
  assert.equal(canRequestWrite(requester, "candidate_language"), true);
  assert.equal(canRequestWrite(requester, "candidate_status"), false);
  assert.equal(canAutomaticWrite(requester, "candidate"), false);

  const automatic = { issuer: "manufact-db-rollback-mcp", subject: "writer-2", scopes: permissionsFromRoles(["crm-writer-auto"]) };
  assert.equal(canAutomaticWrite(automatic, "candidate"), true);
  assert.equal(canRequestWrite(automatic, "company"), false);
  assert.equal(canAutomaticWrite(automatic, "company"), false);
  assert.equal(entityRequiresApproval("approve_write", automatic, "company"), true);
  assert.equal(entityRequiresApproval("write", automatic, "company"), true);
  assert.equal(entityRequiresApproval("write", requester, "company"), true);

  const approver = { issuer: "manufact-db-rollback-mcp", subject: "approver-1", scopes: permissionsFromRoles(["crm-approver"]) };
  assert.equal(canApproveWrite(approver, "candidate"), true);
  assert.equal(canApproveWrite(approver, "order"), false);
  assert.equal(canRequestWrite(approver, "order"), false);
  assert.equal(canReadEntity(approver, "order"), false);
  assert.equal(canReadEntity(reader, "company"), false);
  assert.equal(canReadEntity(requester, "candidate"), true);
  assert.equal(canReadEntity(requester, "company"), false);
  const admin = { issuer: "manufact-db-rollback-mcp", subject: "admin-1", scopes: permissionsFromRoles(["admin"]) };
  assert.equal(canReadEntity(admin, "company"), true);
  assert.equal(canReadEntity(admin, "order"), true);
  assert.equal(canReadEntity(admin, "candidate"), true);
  assert.equal(canRequestWrite(admin, "candidate"), false);
  const crmAdmin = { issuer: "manufact-db-rollback-mcp", subject: "admin-2", scopes: permissionsFromRoles(["crm-admin"]) };
  assert.equal(canReadEntity(crmAdmin, "order"), true);
  const adminWriter = { issuer: "manufact-db-rollback-mcp", subject: "admin-writer", scopes: permissionsFromRoles(["admin", "crm-writer-approval"]) };
  assert.equal(canRequestWrite(adminWriter, "candidate"), true);
  assert.equal(canAutomaticWrite(adminWriter, "candidate"), false);
  assert.equal(canApproveWrite(adminWriter, "candidate"), false);
  const adminApprover = { issuer: "manufact-db-rollback-mcp", subject: "admin-approver", scopes: permissionsFromRoles(["admin", "crm-approver"]) };
  assert.equal(canApproveWrite(adminApprover, "candidate"), true);
  assert.equal(canRequestWrite(adminApprover, "candidate"), false);
  assert.equal(canReadEntity(adminApprover, "company"), true);
});

test("minimalna DB prava ne daju DELETE, DROP ni INSERT u postojece CRM zapise", () => {
  const privileges = minimalPrivileges();
  assert.equal(privileges.some((item) => item.delete || item.drop), false);
  for (const item of privileges) {
    if (item.table.startsWith("rb_")) {
      assert.equal(item.insert, true);
      assert.deepEqual(item.update, []);
    } else {
      assert.equal(item.insert, false);
    }
  }
  assert.deepEqual(privileges.find((item) => item.table === "idk_kandidati")?.insertColumns, []);
  assert.ok(privileges.find((item) => item.table === "idk_kandidat_radno_iskustvo")?.insertColumns.includes("kri_naziv"));
  assert.ok(privileges.find((item) => item.table === "idk_kandidat_edukacija")?.insertColumns.includes("ke_kandidat_id"));
  assert.ok(privileges.find((item) => item.table === "idk_kandidat_jezici")?.insertColumns.includes("kj_govorna_interakcija"));
  assert.ok(privileges.find((item) => item.table === "idk_kandidati")?.update.includes("kandidat_ime"));
  assert.equal(privileges.find((item) => item.table === "idk_kandidati")?.update.includes("kandidat_status"), false);
  assert.ok(privileges.find((item) => item.table === "idk_kandidat_jezici")?.update.includes("kj_naziv"));
  assert.deepEqual(privileges.find((item) => item.table === "idk_kandidat_status")?.update, []);
  assert.deepEqual(privileges.find((item) => item.table === "idk_kandidat_status")?.insertColumns, []);

  const jwtActor = actorFromOAuth({ payload: { sub: "workos-user", roles: ["crm-writer-approval"] } });
  assert.equal(canRequestWrite(jwtActor, "candidate"), true);
  assert.equal(canRequestWrite(jwtActor, "candidate_language"), true);
  assert.equal(canRequestWrite(jwtActor, "candidate_status"), false);
  const adminActor = actorFromOAuth({ payload: { sub: "workos-admin", roles: ["admin"] } });
  assert.equal(canReadEntity(adminActor, "candidate"), true);
  assert.equal(canReadEntity(adminActor, "company"), true);
  assert.equal(canRequestWrite(adminActor, "candidate"), false);
});

test("interni approval inbox veze odluku za neizmijenjeni preview", async () => {
  const unsigned = {
    operation: "change" as const, entity_type: "candidate", entity_id: "42", entity_revision: "0",
    source_event_id: null, reason: "Telefon aktualisieren",
    fields: [{ name: "first_name", before: { type: "string" as const, value: "Alt" }, after: { type: "string" as const, value: "Neu" }, field_revision: "0" }],
  };
  const preview = { ...unsigned, preview_sha256: sha256((await import("../src/canonical.ts")).canonicalJson(unsigned)) };
  const writer = { issuer: "manufact-db-rollback-mcp", subject: "writer-1", scopes: ["crm:candidate:request_write"] };
  const approver = { issuer: "manufact-db-rollback-mcp", subject: "approver-1", scopes: ["crm:candidate:approve_write"] };
  let pendingRow: unknown[] | undefined;
  const requestSession = { async query(_sql: string, params?: unknown[]) { pendingRow = params; return { rows: [], affectedRows: 1 }; }, async release() {} };
  const approvalId = await requestApproval(requestSession, writer, preview, new Date("2026-10-13T11:00:00.000Z"));
  assert.match(approvalId, /^[a-f0-9-]{36}$/);
  assert.ok(pendingRow);

  let committed = false;
  const decideSession = { async query(sql: string) {
    if (sql === "START TRANSACTION") return { rows: [], affectedRows: 0 };
    if (sql.includes("principal_hash, preview_sha256, preview_json")) return { rows: [{ principal_hash: principalHash(writer), preview_sha256: preview.preview_sha256, preview_json: JSON.stringify(preview), decision: "pending", expires_at: "2026-10-14 11:00:00.000000" }], affectedRows: 1 };
    if (sql.startsWith("UPDATE rb_approvals")) return { rows: [], affectedRows: 1 };
    if (sql === "COMMIT") { committed = true; return { rows: [], affectedRows: 0 }; }
    if (sql === "ROLLBACK") return { rows: [], affectedRows: 0 };
    throw new Error("UNEXPECTED_QUERY");
  }, async release() {} };
  const result = await decideApproval(decideSession, approvalId, "approved", approver, new Date("2026-10-13T12:00:00.000Z"));
  assert.equal(result.decision, "approved");
  assert.equal(result.expires_at, "2026-10-13T12:15:00.000Z");
  assert.equal(committed, true);
  await assert.rejects(() => decideApproval(decideSession, approvalId, "approved", writer, new Date("2026-10-13T12:00:00.000Z")), /eigene Freigabe/);
  await assert.rejects(() => requestApproval(requestSession, writer, { ...preview, reason: "Izmijenjeno" }, new Date()), /veraendert/);
});

test("Worker odbija mutation ulaz koji MCP ugovor ne prihvata", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const privatePem = await exportPem(pair.privateKey, "pkcs8");
  const publicPem = await exportPem(pair.publicKey, "spki");
  const env = { MCP_SERVICE_TOKEN: "svc", IDENTITY_ASSERTION_PUBLIC_KEY: publicPem, WRITES_ENABLED: "false", ALLOW_TEST_ENTITIES: "false" };
  const actor = { issuer: "manufact-db-rollback-mcp", subject: "user-1", scopes: ["crm:read", "crm:write"] };
  const base = {
    entity_type: "synthetic_candidate", entity_id: "TEST-1", expected_revision: "0",
    patch: { telephone: "+49-1" }, reason: "Kontrollierter Test", idempotency_key: "preview-test-0001",
  };
  async function post(body: Record<string, unknown>) {
    const raw = JSON.stringify(body);
    const assertion = await signAssertion(privatePem, { actor, audience: WORKER_AUDIENCE, requestSha256: sha256(raw) });
    const queries: string[] = [];
    const response = await handleWorker(new Request("https://worker.test/v1/changes/preview", {
      method: "POST",
      headers: { authorization: "Bearer svc", "x-crm-identity": assertion, "content-type": "application/json" },
      body: raw,
    }), env, {
      host: "127.0.0.1",
      openSession: async () => ({
        async query(sql: string) {
          queries.push(sql);
          if (sql.includes("DATABASE()")) return { rows: [{ selected_database: "rollback_test" }], affectedRows: 1 };
          throw new Error("BUSINESS_QUERY");
        },
        async release() {},
      }),
    });
    return { response, queries };
  }
  const extra = await post({ ...base, unexpected: true });
  assert.equal(extra.response.status, 400);
  assert.equal((await extra.response.json() as { error: { code: string } }).error.code, "INVALID_INPUT");
  assert.deepEqual(extra.queries, ["SELECT DATABASE() AS selected_database"]);
  const long = await post({ ...base, patch: { telephone: "a".repeat(10_001) } });
  assert.equal(long.response.status, 400);
  assert.equal((await long.response.json() as { error: { code: string } }).error.code, "INVALID_INPUT");
  assert.equal(long.queries.some((sql) => sql.includes("START TRANSACTION")), false);
});

test("R2 arhiva cuva sva hashirana polja dogadjaja", async () => {
  const event = {
    event_id: "11111111-1111-4111-8111-111111111111",
    entity_type: "synthetic_candidate",
    entity_id: "TEST-1",
    revision_before: "0",
    revision_after: "1",
    operation: "change",
    actor_issuer: "manufact-db-rollback-mcp",
    actor_subject: "user-1",
    request_id: "22222222-2222-4222-8222-222222222222",
    source_event_id: null,
    created_at: "2026-10-20 13:00:00.000000",
    typed_changes: { telephone: { before: { type: "null" }, after: { type: "string", value: "+49-1" }, field_revision_before: "0", field_revision_after: "1" } },
    reason: "Kontrollierter Test",
  };
  const stored = { ...event, event_sha256: sha256(canonicalJson(event)) };
  const queries: string[] = [];
  const archived = new Map<string, string>();
  const session = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.startsWith("SELECT event_id FROM rb_outbox")) return { rows: [{ event_id: event.event_id }], affectedRows: 1 };
      if (sql.startsWith("SELECT event_id, entity_type")) return { rows: [stored], affectedRows: 1 };
      if (sql.startsWith("UPDATE rb_outbox SET status='archived'")) return { rows: [], affectedRows: 1 };
      return { rows: [], affectedRows: 1 };
    },
    async release() {},
  };
  const result = await archiveDue(session, { async put(key, body) { archived.set(key, body); } }, new Date("2026-10-20T13:00:00.000Z"));
  assert.equal(result.archived, 1);
  const body = archived.get("events/" + event.event_id + ".json");
  assert.equal(body, canonicalJson(event));
  assert.equal(sha256(body ?? ""), stored.event_sha256);
  assert.match(body ?? "", /actor_issuer/);
  assert.match(body ?? "", /request_id/);
  assert.equal(body?.includes("event_sha256"), false);
  const broken = { ...stored, reason: "promijenjeno" };
  const rejected: string[] = [];
  const rejectSession = {
    async query(sql: string) {
      if (sql.startsWith("SELECT event_id FROM rb_outbox")) return { rows: [{ event_id: event.event_id }], affectedRows: 1 };
      if (sql.startsWith("SELECT event_id, entity_type")) return { rows: [broken], affectedRows: 1 };
      if (sql.startsWith("UPDATE rb_outbox SET status='archived'")) throw new Error("ARCHIVED");
      return { rows: [], affectedRows: 1 };
    },
    async release() {},
  };
  const rejectedResult = await archiveDue(rejectSession, { async put(key) { rejected.push(key); } }, new Date("2026-10-20T13:00:00.000Z"));
  assert.equal(rejectedResult.archived, 0);
  assert.deepEqual(rejected, []);
  assert.equal(queries.some((sql) => sql.includes("actor_issuer")), true);
});
