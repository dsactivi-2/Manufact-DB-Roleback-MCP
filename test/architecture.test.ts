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
const { assertSeparateInfrastructure } = await import("../src/guard.ts");
const { actorFromSharedToken, canWrite, exportPem, signAssertion, verifyAssertion, WORKER_AUDIENCE } = await import("../src/identity.ts");
const { handleWorker } = await import("../src/worker/http.ts");

test("bekannte produktive Hyperdrive-Ziele bleiben verboten", () => {
  assert.throws(() => assertSeparateInfrastructure({ CRM_HYPERDRIVE_ID: "71d03de751b74a5ca1f71dd382328c2b" }), /verboten/);
  assert.throws(() => assertSeparateInfrastructure({ CRM_DATABASE_URL: "mysql://user:pw@activi-dsactivi-d23a.b.aivencloud.com:26718/defaultdb" }), /verboten/);
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

  async function call(actor: { issuer: string; subject: string; scopes: string[] }, path: string, schema: string, host = "127.0.0.1") {
    const raw = "{}";
    const assertion = await signAssertion(privatePem, { actor, audience: WORKER_AUDIENCE, requestSha256: sha256(raw) });
    return handleWorker(new Request("https://worker.test" + path, { method: "POST", headers: { authorization: "Bearer svc", "x-crm-identity": assertion, "content-type": "application/json" }, body: raw }), env, {
      host,
      openSession: async () => ({ async query(sql: string) { return sql.includes("DATABASE()") ? { rows: [{ selected_database: schema }], affectedRows: 1 } : { rows: [], affectedRows: 0 }; }, async release() {} }),
    });
  }

  const shared = await call(actorFromSharedToken(), "/v1/changes/apply", "rollback_test");
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
