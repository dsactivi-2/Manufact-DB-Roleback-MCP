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

import type { ApplyOptions, ChangeInput, ChangeResult } from "../../src/history.ts";
import type { Actor } from "../../src/identity.ts";
import type { SqlSession } from "../../src/sql-session.ts";

const { CrmError } = await import("../../src/crm-error.ts");
const { applyChange, insertApproval, previewChange } = await import("../../src/history.ts");
const { MCP_ISSUER } = await import("../../src/identity.ts");
const { archiveDue } = await import("../../src/outbox.ts");
const { openMysqlUrl } = await import("../../src/sql-session.ts");

const url = process.env.MYSQL_TEST_URL ?? "";
const actor: Actor = { issuer: MCP_ISSUER, subject: "user-1", scopes: ["crm:read", "crm:write"] };
const options: ApplyOptions = { allowTestEntities: true, requireApproval: true };

async function statements(session: SqlSession, relative: string) {
  const text = readFileSync(new URL(relative, import.meta.url), "utf8");
  for (const part of text.split(";")) {
    const sql = part.trim();
    if (sql) await session.query(sql);
  }
}

async function reset(session: SqlSession) {
  for (const table of ["rb_outbox", "rb_events", "rb_requests", "rb_approvals", "rb_baselines", "rb_field_state", "rb_entity_state", "rb_synth_candidate"]) {
    await session.query("DROP TABLE IF EXISTS " + table);
  }
  await statements(session, "../../sql/migrations/001_history_schema.sql");
  await statements(session, "../../sql/migrations/002_synthetic_candidate.TEST.sql");
  await session.query("INSERT INTO rb_synth_candidate (candidate_id, telephone, address) VALUES (?,?,?)", ["TEST-1001", "+49-000-111", "Teststrasse A"]);
}

async function row(session: SqlSession) {
  const result = await session.query("SELECT telephone, address, fee, external_no FROM rb_synth_candidate WHERE candidate_id=?", ["TEST-1001"]);
  return result.rows[0];
}

async function eventCount(session: SqlSession) {
  const result = await session.query("SELECT COUNT(*) AS n FROM rb_events");
  return Number(result.rows[0]?.n);
}

async function currentRevision(session: SqlSession) {
  const result = await session.query("SELECT revision FROM rb_entity_state WHERE entity_type=? AND entity_id=?", ["synthetic_candidate", "TEST-1001"]);
  return String(result.rows[0]?.revision ?? "0");
}

async function prepare(session: SqlSession, patch: Record<string, string | null>, key: string, extra: Partial<ApplyOptions> = {}): Promise<ChangeInput> {
  const input: ChangeInput = { operation: "change", entity_type: "synthetic_candidate", entity_id: "TEST-1001", expected_revision: await currentRevision(session), patch, reason: "Synthetischer Test", idempotency_key: key };
  const preview = await previewChange(session, input, { ...options, ...extra });
  input.expected_revision = preview.entity_revision;
  input.approval_id = await insertApproval(session, actor, preview, "approved", new Date(Date.now() + 3_600_000));
  return input;
}

async function change(session: SqlSession, patch: Record<string, string | null>, key: string, extra: Partial<ApplyOptions> = {}): Promise<ChangeResult> {
  const input = await prepare(session, patch, key, extra);
  return applyChange(session, input, actor, { ...options, ...extra });
}

test("MySQL-History bleibt atomar, selektiv und wiederholbar", { skip: url ? false : "MYSQL_TEST_URL fehlt" }, async () => {
  const session = await openMysqlUrl(url);
  const version = await session.query("SELECT VERSION() AS version, DATABASE() AS selected_database");
  assert.match(String(version.rows[0]?.version), /^8\./);
  assert.equal(version.rows[0]?.selected_database, "rollback_test");
  await reset(session);

  const phone = await prepare(session, { telephone: "+49-000-222" }, "change-telephone-0001");
  const first = await applyChange(session, phone, actor, options);
  assert.equal(first.status, "applied");
  assert.equal(first.revision, "1");
  assert.equal((await row(session))?.telephone, "+49-000-222");
  const replay = await applyChange(session, phone, actor, options);
  assert.equal(replay.status, "replayed");
  assert.equal(await eventCount(session), 1);
  await assert.rejects(() => applyChange(session, { ...phone, patch: { telephone: "+49-000-333" } }, actor, options), (error: unknown) => error instanceof CrmError && error.code === "IDEMPOTENCY_CONFLICT");

  await assert.rejects(() => change(session, { address: "Teststrasse B" }, "history-fails-0001", { failBefore: "event" }), (error: unknown) => error instanceof CrmError && error.code === "HISTORY_FAILURE");
  assert.equal((await row(session))?.address, "Teststrasse A");
  assert.equal(await eventCount(session), 1);

  const address = await prepare(session, { address: "Teststrasse B" }, "address-lost-0001");
  await assert.rejects(() => applyChange(session, address, actor, { ...options, failBefore: "after-commit" }), (error: unknown) => error instanceof CrmError && error.code === "RESPONSE_LOST");
  const recovered = await applyChange(session, address, actor, options);
  assert.equal(recovered.status, "replayed");
  assert.equal((await row(session))?.address, "Teststrasse B");
  assert.equal((await row(session))?.telephone, "+49-000-222");

  const events = await session.query("SELECT event_id, operation, typed_changes FROM rb_events ORDER BY revision_after");
  const phoneEvent = events.rows.find((item) => JSON.stringify(item.typed_changes).includes("telephone"));
  assert.ok(phoneEvent);
  const restoreInput: ChangeInput = { operation: "restore", entity_type: "synthetic_candidate", entity_id: "TEST-1001", expected_revision: await currentRevision(session), patch: { telephone: "+49-000-111" }, reason: "Telefon zurueck", idempotency_key: "restore-phone-0001", source_event_id: String(phoneEvent?.event_id) };
  const restorePreview = await previewChange(session, restoreInput, options);
  restoreInput.expected_revision = restorePreview.entity_revision;
  const restoreApproval = await insertApproval(session, actor, restorePreview, "approved", new Date(Date.now() + 3_600_000));
  const restored = await applyChange(session, { ...restoreInput, approval_id: restoreApproval }, actor, options);
  assert.equal(restored.status, "applied");
  assert.equal((await row(session))?.telephone, "+49-000-111");
  assert.equal((await row(session))?.address, "Teststrasse B");

  const stale = await previewChange(session, { operation: "change", entity_type: "synthetic_candidate", entity_id: "TEST-1001", expected_revision: restored.revision, patch: { telephone: "+49-000-999" }, reason: "Spaeter Konflikt", idempotency_key: "stale-phone-0001" }, options);
  const staleApproval = await insertApproval(session, actor, stale, "approved", new Date(Date.now() + 3_600_000));
  await change(session, { telephone: "+49-000-444" }, "newer-phone-0001");
  await assert.rejects(() => applyChange(session, { operation: "change", entity_type: "synthetic_candidate", entity_id: "TEST-1001", expected_revision: stale.entity_revision, patch: { telephone: "+49-000-999" }, reason: "Spaeter Konflikt", idempotency_key: "stale-phone-0001", approval_id: staleApproval }, actor, options), (error: unknown) => error instanceof CrmError && error.code === "REVISION_CONFLICT");
  assert.equal((await row(session))?.telephone, "+49-000-444");
  assert.equal((await row(session))?.address, "Teststrasse B");

  const typed = await change(session, { fee: "10.50", external_no: "42", telephone: null }, "types-0001");
  assert.equal(typed.status, "applied");
  const typedRow = await row(session);
  assert.equal(typedRow?.telephone, null);
  assert.equal(String(typedRow?.fee), "10.50");
  assert.equal(String(typedRow?.external_no), "42");

  const archive = new Map<string, string>();
  const archived = await archiveDue(session, { async put(key, body) { archive.set(key, body); } });
  assert.ok(archived.archived >= 1);
  assert.equal(archive.size, archived.archived);
  const again = await archiveDue(session, { async put() { throw new Error("R2 down"); } });
  assert.equal(again.claimed, 0);
  await change(session, { address: "Teststrasse C" }, "outbox-fail-0001");
  const failed = await archiveDue(session, { async put() { throw new Error("R2 down"); } });
  assert.equal(failed.archived, 0);
  const pending = await session.query("SELECT COUNT(*) AS n FROM rb_outbox WHERE status='pending'");
  assert.equal(Number(pending.rows[0]?.n), 1);
  const caughtUp = await archiveDue(session, { async put(key, body) { archive.set(key, body); } });
  assert.equal(caughtUp.archived, 1);

  await assert.rejects(() => change(session, { telephone: "+49-000-000" }, "real-schema-0001").then(() => previewChange(session, { operation: "change", entity_type: "candidate", entity_id: "1", expected_revision: "0", patch: { telephone: "1" }, reason: "Nicht geprueft", idempotency_key: "real-schema-0001" }, options)), (error: unknown) => error instanceof Error && /nicht geprueft/.test(error.message));

  await session.release();
});

test("zwei MySQL-Verbindungen verlieren keine gleichzeitige Revision", { skip: url ? false : "MYSQL_TEST_URL fehlt" }, async () => {
  const setup = await openMysqlUrl(url);
  await reset(setup);
  await setup.release();
  const left = await openMysqlUrl(url);
  const right = await openMysqlUrl(url);
  const results = await Promise.allSettled([
    change(left, { telephone: "+49-000-222" }, "race-left-00001"),
    change(right, { address: "Teststrasse B" }, "race-right-0001"),
  ]);
  const codes = results.map((result) => result.status === "fulfilled" ? result.value.status : result.reason instanceof CrmError ? result.reason.code : "OTHER");
  assert.equal(codes.filter((code) => code === "applied").length, 1);
  assert.equal(codes.filter((code) => code === "REVISION_CONFLICT").length, 1);
  const check = await openMysqlUrl(url);
  assert.equal(await eventCount(check), 1);
  await left.release();
  await right.release();
  await check.release();
});
