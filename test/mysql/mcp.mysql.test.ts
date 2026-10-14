import { existsSync, readFileSync } from "node:fs";
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

const { createCloudCrmServer } = await import("../../index.ts");
const { insertApproval } = await import("../../src/history.ts");
const { exportPem, MCP_ISSUER } = await import("../../src/identity.ts");
const { openMysqlUrl } = await import("../../src/sql-session.ts");
const { handleWorker } = await import("../../src/worker/http.ts");

const mysqlUrl = process.env.MYSQL_TEST_URL ?? "";
const workerToken = "mcp-e2e-worker-token-0000000000000000";
const oauthIssuer = "https://login.test/";
const oauthAudience = "https://mcp.test";
const oauthSubject = "mcp-e2e-user";

async function statements(session, relative) {
  const text = readFileSync(new URL(relative, import.meta.url), "utf8");
  for (const part of text.split(";")) {
    const sql = part.trim();
    if (sql) await session.query(sql);
  }
}

async function reset() {
  const session = await openMysqlUrl(mysqlUrl);
  try {
    for (const table of ["rb_outbox", "rb_events", "rb_requests", "rb_approvals", "rb_baselines", "rb_field_state", "rb_entity_state", "rb_synth_candidate"]) {
      await session.query("DROP TABLE IF EXISTS " + table);
    }
    await statements(session, "../../sql/migrations/001_history_schema.sql");
    await statements(session, "../../sql/migrations/002_synthetic_candidate.TEST.sql");
    await session.query("INSERT INTO rb_synth_candidate (candidate_id, telephone, address) VALUES (?,?,?)", ["TEST-MCP-1", "+49-100", "MCP Test A"]);
  } finally {
    await session.release();
  }
}

function jsonRpc(text) {
  const data = text.startsWith("{") ? text : text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  assert.ok(data, text);
  return JSON.parse(data);
}

async function oauthFixture() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const kid = "mcp-e2e-rsa";
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: oauthIssuer, aud: oauthAudience, sub: oauthSubject, iat: now, exp: now + 600,
    scope: "crm:read crm:write", permissions: ["crm:read", "crm:write"],
  })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, Buffer.from(unsigned));
  return { token: `${unsigned}.${Buffer.from(signature).toString("base64url")}`, jwks: { keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] } };
}

test("MCP OAuth tok izvrsava preview, apply, history i restore kroz Worker i MySQL", { skip: mysqlUrl ? false : "MYSQL_TEST_URL fehlt" }, async () => {
  await reset();
  const oauth = await oauthFixture();
  const assertionPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const assertionPrivate = await exportPem(assertionPair.privateKey, "pkcs8");
  const assertionPublic = await exportPem(assertionPair.publicKey, "spki");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === "https://login.test/jwks") return Response.json(oauth.jwks);
    if (url.startsWith("https://worker.test/")) {
      return handleWorker(new Request(url, init), {
        MCP_SERVICE_TOKEN: workerToken,
        IDENTITY_ASSERTION_PUBLIC_KEY: assertionPublic,
        WRITES_ENABLED: "true", RESTORES_ENABLED: "true", REQUIRE_APPROVAL: "true", ALLOW_TEST_ENTITIES: "true",
      }, { host: "rollback-test.local", openSession: () => openMysqlUrl(mysqlUrl) });
    }
    throw new Error("UNEXPECTED_FETCH_TARGET");
  }) as typeof fetch;

  try {
    const server = createCloudCrmServer({
      CRM_TRANSPORT: "cloudflare", CRM_WORKER_BASE_URL: "https://worker.test", CRM_WORKER_SERVICE_TOKEN: workerToken,
      CRM_IDENTITY_ASSERTION_PRIVATE_KEY: assertionPrivate, CRM_MUTATION_TOOLS_ENABLED: "true", CRM_MUTATION_POLICY_VERSION: "test-policy-v1",
      OAUTH_ISSUER: oauthIssuer, OAUTH_AUTHORIZATION_ENDPOINT: "https://login.test/authorize", OAUTH_TOKEN_ENDPOINT: "https://login.test/token",
      OAUTH_JWKS_URL: "https://login.test/jwks", OAUTH_RESOURCE: "https://mcp.test/mcp", OAUTH_AUDIENCE: oauthAudience,
    });
    const headers = new Headers({ authorization: `Bearer ${oauth.token}`, accept: "application/json, text/event-stream", "content-type": "application/json" });
    async function rpc(id, method, params) {
      const response = await server.fetch(new Request("https://mcp.test/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }));
      assert.equal(response.status, 200, await response.clone().text());
      const session = response.headers.get("mcp-session-id");
      if (session) headers.set("mcp-session-id", session);
      const message = jsonRpc(await response.text());
      assert.equal(message.error, undefined, JSON.stringify(message));
      assert.equal(message.result?.isError, undefined, JSON.stringify(message));
      return message.result?.structuredContent ?? message.result;
    }
    await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mysql-mcp-e2e", version: "1" } });
    const change = { entity_type: "synthetic_candidate", entity_id: "TEST-MCP-1", expected_revision: "0", patch: { telephone: "+49-200" }, reason: "MCP end to end change", idempotency_key: "mcp-e2e-change-0001" };
    const preview = await rpc(2, "tools/call", { name: "crm_change_preview", arguments: change });
    const actor = { issuer: MCP_ISSUER, subject: oauthSubject, scopes: ["crm:read", "crm:write"] };
    const approvalSession = await openMysqlUrl(mysqlUrl);
    const approvalId = await insertApproval(approvalSession, actor, preview, approval());
    await approvalSession.release();
    const applied = await rpc(3, "tools/call", { name: "crm_change_apply", arguments: { ...change, expected_revision: preview.entity_revision, approval_id: approvalId } });
    assert.equal(applied.status, "applied");
    const history = await rpc(4, "tools/call", { name: "crm_history_list", arguments: { entity_type: "synthetic_candidate", entity_id: "TEST-MCP-1" } });
    assert.equal(history.rows.length, 1);
    const restore = { entity_type: "synthetic_candidate", entity_id: "TEST-MCP-1", expected_revision: applied.revision, source_event_id: history.rows[0].event_id, fields: ["telephone"], reason: "MCP end to end restore", idempotency_key: "mcp-e2e-restore-0001" };
    const restorePreview = await rpc(5, "tools/call", { name: "crm_restore_preview", arguments: restore });
    const restoreApprovalSession = await openMysqlUrl(mysqlUrl);
    const restoreApprovalId = await insertApproval(restoreApprovalSession, actor, restorePreview, approval());
    await restoreApprovalSession.release();
    const restored = await rpc(6, "tools/call", { name: "crm_restore_apply", arguments: { ...restore, expected_revision: restorePreview.entity_revision, approval_id: restoreApprovalId } });
    assert.equal(restored.status, "applied");
    const check = await openMysqlUrl(mysqlUrl);
    try {
      const row = await check.query("SELECT telephone, address FROM rb_synth_candidate WHERE candidate_id=?", ["TEST-MCP-1"]);
      assert.equal(row.rows[0]?.telephone, "+49-100");
      assert.equal(row.rows[0]?.address, "MCP Test A");
    } finally { await check.release(); }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function approval() {
  const decidedAt = new Date();
  return { provider: "integration-test", decisionBy: "test-operator", decision: "approved", decidedAt, expiresAt: new Date(decidedAt.getTime() + 3_600_000) };
}
