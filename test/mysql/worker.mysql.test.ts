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

const { sha256 } = await import("../../src/canonical.ts");
const { insertApproval } = await import("../../src/history.ts");
const { exportPem, MCP_ISSUER, signAssertion, WORKER_AUDIENCE } = await import("../../src/identity.ts");
const { openMysqlUrl } = await import("../../src/sql-session.ts");
const { drainWorkerOutbox, handleWorker } = await import("../../src/worker/http.ts");

const url = process.env.MYSQL_TEST_URL ?? "";
const actor = { issuer: MCP_ISSUER, subject: "worker-e2e-user", scopes: ["crm:read", "crm:write"] };

async function statements(session, relative) {
  const text = readFileSync(new URL(relative, import.meta.url), "utf8");
  for (const part of text.split(";")) {
    const sql = part.trim();
    if (sql) await session.query(sql);
  }
}

async function reset() {
  const session = await openMysqlUrl(url);
  try {
    for (const table of ["rb_outbox", "rb_events", "rb_requests", "rb_approvals", "rb_baselines", "rb_field_state", "rb_entity_state", "rb_synth_candidate"]) {
      await session.query("DROP TABLE IF EXISTS " + table);
    }
    await statements(session, "../../sql/migrations/001_history_schema.sql");
    await statements(session, "../../sql/migrations/002_synthetic_candidate.TEST.sql");
    await session.query("INSERT INTO rb_synth_candidate (candidate_id, telephone, address) VALUES (?,?,?)", ["TEST-HTTP-1", "+49-000-111", "Teststrasse A"]);
  } finally {
    await session.release();
  }
}

test("Worker HTTP fuehrt Preview, Approval, Apply, History und Restore atomar aus", { skip: url ? false : "MYSQL_TEST_URL fehlt" }, async () => {
  await reset();
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const privatePem = await exportPem(pair.privateKey, "pkcs8");
  const publicPem = await exportPem(pair.publicKey, "spki");
  const env = {
    MCP_SERVICE_TOKEN: "worker-e2e-service-token",
    IDENTITY_ASSERTION_PUBLIC_KEY: publicPem,
    WRITES_ENABLED: "true",
    RESTORES_ENABLED: "true",
    REQUIRE_APPROVAL: "true",
    ALLOW_TEST_ENTITIES: "true",
  };

  async function call(path, body) {
    const raw = JSON.stringify(body);
    const assertion = await signAssertion(privatePem, { actor, audience: WORKER_AUDIENCE, requestSha256: sha256(raw) });
    const response = await handleWorker(new Request("https://worker.test" + path, {
      method: "POST",
      headers: {
        authorization: "Bearer worker-e2e-service-token",
        "content-type": "application/json",
        "x-crm-identity": assertion,
      },
      body: raw,
    }), env, { host: "rollback-test.local", openSession: () => openMysqlUrl(url) });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    return payload.result;
  }

  const change = {
    entity_type: "synthetic_candidate",
    entity_id: "TEST-HTTP-1",
    expected_revision: "0",
    patch: { telephone: "+49-000-222" },
    reason: "Worker HTTP integration test",
    idempotency_key: "worker-http-change-0001",
  };
  const preview = await call("/v1/changes/preview", change);
  const approvalSession = await openMysqlUrl(url);
  const approvalId = await insertApproval(approvalSession, actor, preview, approval());
  await approvalSession.release();
  const applied = await call("/v1/changes/apply", { ...change, expected_revision: preview.entity_revision, approval_id: approvalId });
  assert.equal(applied.status, "applied");

  const history = await call("/v1/history/list", { entity_type: "synthetic_candidate", entity_id: "TEST-HTTP-1" });
  assert.equal(history.rows.length, 1);
  const sourceEventId = String(history.rows[0].event_id);

  const restore = {
    entity_type: "synthetic_candidate",
    entity_id: "TEST-HTTP-1",
    expected_revision: applied.revision,
    source_event_id: sourceEventId,
    fields: ["telephone"],
    reason: "Worker HTTP restore integration test",
    idempotency_key: "worker-http-restore-0001",
  };
  const restorePreview = await call("/v1/restores/preview", restore);
  const restoreApprovalSession = await openMysqlUrl(url);
  const restoreApprovalId = await insertApproval(restoreApprovalSession, actor, restorePreview, approval());
  await restoreApprovalSession.release();
  const restored = await call("/v1/restores/apply", { ...restore, expected_revision: restorePreview.entity_revision, approval_id: restoreApprovalId });
  assert.equal(restored.status, "applied");

  const check = await openMysqlUrl(url);
  try {
    const row = await check.query("SELECT telephone, address FROM rb_synth_candidate WHERE candidate_id=?", ["TEST-HTTP-1"]);
    assert.equal(row.rows[0]?.telephone, "+49-000-111");
    assert.equal(row.rows[0]?.address, "Teststrasse A");
    const events = await check.query("SELECT operation FROM rb_events ORDER BY revision_after");
    assert.deepEqual(events.rows.map((item) => item.operation), ["change", "restore"]);
  } finally {
    await check.release();
  }

  const archive = new Map();
  const drained = await drainWorkerOutbox(
    { ...env, AUDIT_ARCHIVE: { async put(key, body) { archive.set(key, body); } } },
    { host: "rollback-test.local", openSession: () => openMysqlUrl(url) },
  );
  assert.deepEqual(drained, { claimed: 2, archived: 2 });
  assert.equal(archive.size, 2);
  const archivedCheck = await openMysqlUrl(url);
  try {
    const outbox = await archivedCheck.query("SELECT status, COUNT(*) AS n FROM rb_outbox GROUP BY status");
    assert.deepEqual(outbox.rows.map((item) => [item.status, Number(item.n)]), [["archived", 2]]);
  } finally { await archivedCheck.release(); }
});

function approval() {
  const decidedAt = new Date();
  return { provider: "integration-test", decisionBy: "test-operator", decision: "approved", decidedAt, expiresAt: new Date(decidedAt.getTime() + 3_600_000) };
}
