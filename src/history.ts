import { canonicalJson, newId, sameTyped, sha256, sqlUtc, type TypedValue } from "./canonical.js";
import { CrmError } from "./crm-error.js";
import { principalHash, type Actor } from "./identity.js";
import { assertWritableEntity, entityByType, fieldByApi, quoteIdent, type FieldDefinition } from "./registry.js";
import { isDuplicate, type SqlSession } from "./sql-session.js";

export interface ChangeInput {
  operation: "change" | "restore";
  entity_type: string;
  entity_id: string;
  expected_revision: string;
  patch: Record<string, string | null>;
  reason: string;
  idempotency_key: string;
  approval_id?: string;
  source_event_id?: string | null;
}

export interface ApplyOptions {
  allowTestEntities: boolean;
  requireApproval: boolean;
  now?: Date;
  failBefore?: "event" | "after-commit";
}

export interface PreviewField {
  name: string;
  before: TypedValue;
  after: TypedValue;
  field_revision: string;
}

export interface Preview {
  preview_sha256: string;
  operation: "change" | "restore";
  entity_type: string;
  entity_id: string;
  entity_revision: string;
  source_event_id: string | null;
  reason: string;
  fields: PreviewField[];
}

export interface ChangeResult {
  status: "applied" | "noop" | "replayed";
  original_status?: "applied" | "noop";
  request_id: string;
  event_id: string | null;
  revision: string;
  field_revisions: Record<string, string>;
}

interface Locked {
  preview: Preview;
  changes: Array<{ field: FieldDefinition; before: TypedValue; after: TypedValue; revision: bigint }>;
  allBefore: Record<string, TypedValue>;
}

export async function previewChange(session: SqlSession, input: ChangeInput, options: ApplyOptions): Promise<Preview> {
  validateInput(input);
  await session.query("START TRANSACTION");
  try {
    const locked = await lockState(session, input, options);
    await session.query("ROLLBACK");
    return locked.preview;
  } catch (error) {
    await rollbackQuiet(session);
    throw error;
  }
}

export async function applyChange(session: SqlSession, input: ChangeInput, actor: Actor, options: ApplyOptions): Promise<ChangeResult> {
  validateInput(input);
  const now = options.now ?? new Date();
  const payloadHash = sha256(canonicalJson(normalized(input)));
  const principal = principalHash(actor);
  await session.query("START TRANSACTION");
  let committed = false;
  try {
    const requestId = newId();
    try {
      await session.query(
        "INSERT INTO rb_requests (request_id, principal_hash, idempotency_key, payload_sha256, result_json, created_at, completed_at) VALUES (?,?,?,?,NULL,?,NULL)",
        [requestId, principal, input.idempotency_key, payloadHash, sqlUtc(now)],
      );
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      await rollbackQuiet(session);
      return await replay(session, principal, input, payloadHash);
    }
    const locked = await lockState(session, input, options);
    if (options.requireApproval) await consumeApproval(session, input, actor, locked.preview, requestId, now);
    const changed = locked.changes.filter((item) => !sameTyped(item.before, item.after));
    let eventId: string | null = null;
    let revision = BigInt(locked.preview.entity_revision);
    const fieldRevisions: Record<string, string> = {};
    for (const item of locked.changes) fieldRevisions[item.field.apiField] = item.revision.toString();
    if (changed.length === 0) {
      const result = finish(requestId, null, revision, fieldRevisions, "noop");
      await session.query("UPDATE rb_requests SET result_json=?, completed_at=? WHERE request_id=?", [canonicalJson(result), sqlUtc(now), requestId]);
      await session.query("COMMIT");
      committed = true;
      if (options.failBefore === "after-commit") throw new CrmError("RESPONSE_LOST", "Antwort nach Commit verloren.", 503);
      return result;
    }
    if (options.failBefore === "event") throw new CrmError("HISTORY_FAILURE", "Historieneintrag fehlgeschlagen.", 500);
    const entity = entityByType(input.entity_type);
    const table = quoteIdent(entity.table);
    const pk = quoteIdent(entity.primaryKey);
    await session.query(
      "UPDATE " + table + " SET " + changed.map((item) => quoteIdent(item.field.column) + "=?").join(", ") + " WHERE " + pk + "=?",
      [...changed.map((item) => wire(item.after)), input.entity_id],
    );
    revision += 1n;
    const updated = await session.query("UPDATE rb_entity_state SET revision=? WHERE entity_type=? AND entity_id=? AND revision=?", [revision.toString(), input.entity_type, input.entity_id, locked.preview.entity_revision]);
    if (updated.affectedRows !== 1) throw new CrmError("REVISION_CONFLICT", "Revision hat sich geaendert.");
    for (const item of changed) {
      const next = item.revision + 1n;
      const fieldUpdate = await session.query(
        "UPDATE rb_field_state SET revision=? WHERE entity_type=? AND entity_id=? AND field_name=? AND revision=?",
        [next.toString(), input.entity_type, input.entity_id, item.field.apiField, item.revision.toString()],
      );
      if (fieldUpdate.affectedRows !== 1) throw new CrmError("REVISION_CONFLICT", "Feldrevision hat sich geaendert.");
      fieldRevisions[item.field.apiField] = next.toString();
    }
    if (locked.preview.entity_revision === "0") await captureBaseline(session, input, locked, now);
    eventId = newId();
    const typedChanges = Object.fromEntries(changed.map((item) => [item.field.apiField, { before: item.before, after: item.after, field_revision_before: item.revision.toString(), field_revision_after: (item.revision + 1n).toString() }]));
    const eventBody = { event_id: eventId, entity_type: input.entity_type, entity_id: input.entity_id, revision_before: locked.preview.entity_revision, revision_after: revision.toString(), operation: input.operation, actor_issuer: actor.issuer, actor_subject: actor.subject, request_id: requestId, source_event_id: input.source_event_id ?? null, created_at: sqlUtc(now), typed_changes: typedChanges, reason: input.reason };
    await session.query(
      "INSERT INTO rb_events (event_id, entity_type, entity_id, revision_before, revision_after, operation, actor_issuer, actor_subject, request_id, source_event_id, created_at, typed_changes, reason, event_sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [eventId, input.entity_type, input.entity_id, locked.preview.entity_revision, revision.toString(), input.operation, actor.issuer, actor.subject, requestId, input.source_event_id ?? null, sqlUtc(now), canonicalJson(typedChanges), input.reason, sha256(canonicalJson(eventBody))],
    );
    await session.query("INSERT INTO rb_outbox (event_id, status, attempts, next_attempt_at) VALUES (?,?,0,?)", [eventId, "pending", sqlUtc(now)]);
    const result = finish(requestId, eventId, revision, fieldRevisions, "applied");
    await session.query("UPDATE rb_requests SET result_json=?, completed_at=? WHERE request_id=?", [canonicalJson(result), sqlUtc(now), requestId]);
    await session.query("COMMIT");
    committed = true;
    if (options.failBefore === "after-commit") throw new CrmError("RESPONSE_LOST", "Antwort nach Commit verloren.", 503);
    return result;
  } catch (error) {
    if (!committed) await rollbackQuiet(session);
    if (error instanceof CrmError) throw error;
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    throw new CrmError("HISTORY_FAILURE", /^[A-Z0-9_]{1,64}$/.test(code) ? "Die Transaktion wurde zurueckgerollt (" + code + ")." : "Die Transaktion wurde zurueckgerollt.", 500);
  }
}

export async function restorePatchFromEvent(session: SqlSession, entityType: string, entityId: string, eventId: string, fields: string[]): Promise<Record<string, string | null>> {
  const rows = await session.query("SELECT entity_type, entity_id, typed_changes FROM rb_events WHERE event_id=?", [eventId]);
  const row = rows.rows[0];
  if (!row || row.entity_type !== entityType || row.entity_id !== entityId) throw new CrmError("INVALID_INPUT", "History-Ereignis gehoert nicht zu diesem Datensatz.");
  const changes = typeof row.typed_changes === "string" ? JSON.parse(row.typed_changes) as Record<string, { before?: TypedValue }> : row.typed_changes as Record<string, { before?: TypedValue }>;
  const patch: Record<string, string | null> = {};
  for (const name of fields) {
    const before = changes[name]?.before;
    if (!before) throw new CrmError("INVALID_INPUT", "Feld ist in dem Ereignis nicht enthalten.");
    patch[name] = before.type === "null" ? null : before.value;
  }
  return patch;
}

export async function insertApproval(session: SqlSession, actor: Actor, preview: Preview, decision: "approved" | "pending" | "rejected", expiresAt: Date): Promise<string> {
  const approvalId = newId();
  await session.query(
    "INSERT INTO rb_approvals (approval_id, principal_hash, preview_sha256, preview_json, decision, decision_by, decided_at, expires_at) VALUES (?,?,?,?,?,?,?,?)",
    [approvalId, principalHash(actor), preview.preview_sha256, canonicalJson(preview), decision, "trusted-operator", sqlUtc(new Date()), sqlUtc(expiresAt)],
  );
  return approvalId;
}

async function lockState(session: SqlSession, input: ChangeInput, options: ApplyOptions): Promise<Locked> {
  const entity = entityByType(input.entity_type);
  assertWritableEntity(entity, options.allowTestEntities);
  const parsed = parsePatch(entity, input.patch);
  await session.query("INSERT IGNORE INTO rb_entity_state (entity_type, entity_id, revision, baseline_at) VALUES (?,?,0,?)", [input.entity_type, input.entity_id, sqlUtc(options.now ?? new Date())]);
  const state = await session.query("SELECT revision FROM rb_entity_state WHERE entity_type=? AND entity_id=? FOR UPDATE", [input.entity_type, input.entity_id]);
  const revision = asBig(state.rows[0]?.revision);
  if (revision.toString() !== input.expected_revision) throw new CrmError("REVISION_CONFLICT", "Datensatzrevision ist nicht mehr aktuell.");
  const table = quoteIdent(entity.table);
  const pk = quoteIdent(entity.primaryKey);
  const selected = await session.query("SELECT " + entity.fields.map((field) => quoteIdent(field.column)).join(", ") + " FROM " + table + " WHERE " + pk + "=? FOR UPDATE", [input.entity_id]);
  const row = selected.rows[0];
  if (!row) throw new CrmError("INVALID_INPUT", "Datensatz wurde nicht gefunden.");
  for (const item of parsed) {
    await session.query("INSERT IGNORE INTO rb_field_state (entity_type, entity_id, field_name, revision) VALUES (?,?,?,0)", [input.entity_type, input.entity_id, item.field.apiField]);
  }
  const names = parsed.map((item) => item.field.apiField).sort();
  const fieldRows = await session.query(
    "SELECT field_name, revision FROM rb_field_state WHERE entity_type=? AND entity_id=? AND field_name IN (" + names.map(() => "?").join(", ") + ") ORDER BY field_name FOR UPDATE",
    [input.entity_type, input.entity_id, ...names],
  );
  const revisions = new Map(fieldRows.rows.map((item) => [String(item.field_name), asBig(item.revision)]));
  const changes = parsed.map((item) => ({ field: item.field, before: fromDb(item.field, row[item.field.column]), after: item.after, revision: revisions.get(item.field.apiField) ?? 0n }));
  const fields = changes.map((item) => ({ name: item.field.apiField, before: item.before, after: item.after, field_revision: item.revision.toString() })).sort((a, b) => a.name.localeCompare(b.name));
  const previewWithoutHash = { operation: input.operation, entity_type: input.entity_type, entity_id: input.entity_id, entity_revision: revision.toString(), source_event_id: input.source_event_id ?? null, reason: input.reason, fields };
  const preview: Preview = { ...previewWithoutHash, preview_sha256: sha256(canonicalJson(previewWithoutHash)) };
  const allBefore = Object.fromEntries(entity.fields.map((field) => [field.apiField, fromDb(field, row[field.column])]));
  return { preview, changes, allBefore };
}

async function consumeApproval(session: SqlSession, input: ChangeInput, actor: Actor, preview: Preview, requestId: string, now: Date): Promise<void> {
  if (!input.approval_id) throw new CrmError("APPROVAL_EXPIRED", "Freigabe fehlt.");
  const rows = await session.query("SELECT principal_hash, preview_sha256, decision, expires_at, consumed_by_request_id FROM rb_approvals WHERE approval_id=? FOR UPDATE", [input.approval_id]);
  const approval = rows.rows[0];
  if (!approval) throw new CrmError("APPROVAL_EXPIRED", "Freigabe fehlt.");
  if (approval.principal_hash !== principalHash(actor)) throw new CrmError("FORBIDDEN", "Freigabe gehoert zu einem anderen Benutzer.", 403);
  if (approval.decision !== "approved" || approval.consumed_by_request_id) throw new CrmError("APPROVAL_EXPIRED", "Freigabe ist nicht mehr verwendbar.");
  if (String(approval.expires_at) <= sqlUtc(now)) throw new CrmError("APPROVAL_EXPIRED", "Freigabe ist abgelaufen.");
  if (approval.preview_sha256 !== preview.preview_sha256) throw new CrmError("REVISION_CONFLICT", "Freigabe passt nicht mehr zum aktuellen Feldstand.");
  const used = await session.query("UPDATE rb_approvals SET consumed_by_request_id=? WHERE approval_id=? AND consumed_by_request_id IS NULL", [requestId, input.approval_id]);
  if (used.affectedRows !== 1) throw new CrmError("APPROVAL_EXPIRED", "Freigabe ist nicht mehr verwendbar.");
}

async function captureBaseline(session: SqlSession, input: ChangeInput, locked: Locked, now: Date): Promise<void> {
  const existing = await session.query("SELECT baseline_id FROM rb_baselines WHERE entity_type=? AND entity_id=? AND revision=0 FOR UPDATE", [input.entity_type, input.entity_id]);
  if (existing.rows.length > 0) return;
  const values = locked.allBefore;
  await session.query(
    "INSERT INTO rb_baselines (baseline_id, entity_type, entity_id, revision, captured_at, typed_values) VALUES (?,?,?,?,?,?)",
    [newId(), input.entity_type, input.entity_id, "0", sqlUtc(now), canonicalJson(values)],
  );
}

async function replay(session: SqlSession, principal: string, input: ChangeInput, payloadHash: string): Promise<ChangeResult> {
  const rows = await session.query("SELECT payload_sha256, result_json FROM rb_requests WHERE principal_hash=? AND idempotency_key=?", [principal, input.idempotency_key]);
  const row = rows.rows[0];
  if (!row) throw new CrmError("DEPENDENCY_UNAVAILABLE", "Das fruehere Ergebnis ist noch nicht sichtbar.", 503);
  if (row.payload_sha256 !== payloadHash) throw new CrmError("IDEMPOTENCY_CONFLICT", "Der Schluessel wurde schon mit einer anderen Aenderung benutzt.");
  if (!row.result_json) throw new CrmError("DEPENDENCY_UNAVAILABLE", "Das fruehere Ergebnis ist noch nicht sichtbar.", 503);
  const stored = typeof row.result_json === "string" ? JSON.parse(row.result_json) as ChangeResult : row.result_json as ChangeResult;
  return { ...stored, status: "replayed", original_status: stored.status === "replayed" ? stored.original_status : stored.status };
}

function finish(requestId: string, eventId: string | null, revision: bigint, fieldRevisions: Record<string, string>, status: "applied" | "noop"): ChangeResult {
  return { status, request_id: requestId, event_id: eventId, revision: revision.toString(), field_revisions: fieldRevisions };
}

function parsePatch(entity: ReturnType<typeof entityByType>, patch: Record<string, string | null>) {
  const entries = Object.entries(patch);
  if (entries.length === 0) throw new CrmError("INVALID_INPUT", "Patch ist leer.");
  return entries.map(([name, value]) => {
    const field = fieldByApi(entity, name);
    if (value === null) {
      if (!field.nullable) throw new CrmError("INVALID_INPUT", "Feld darf nicht null sein.");
      return { field, after: { type: "null" } as TypedValue };
    }
    if (typeof value !== "string") throw new CrmError("INVALID_INPUT", "Feldwert muss Text oder null sein.");
    if (field.type === "string") return { field, after: { type: "string", value } as TypedValue };
    if (field.type === "decimal" && /^-?\d+(\.\d+)?$/.test(value)) return { field, after: { type: "decimal", value } as TypedValue };
    if (field.type === "integer" && /^-?\d+$/.test(value)) return { field, after: { type: "integer", value } as TypedValue };
    throw new CrmError("INVALID_INPUT", "Feldwert hat den falschen Typ.");
  });
}

function fromDb(field: FieldDefinition, raw: unknown): TypedValue {
  if (raw === null || raw === undefined) return { type: "null" };
  const value = typeof raw === "bigint" ? raw.toString() : String(raw);
  if (field.type === "string") return { type: "string", value };
  if (field.type === "decimal") return { type: "decimal", value };
  return { type: "integer", value };
}

function wire(value: TypedValue): string | null {
  return value.type === "null" ? null : value.value;
}

function asBig(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new CrmError("HISTORY_FAILURE", "Revision ist ungueltig.", 500);
}

function validateInput(input: ChangeInput): void {
  if (input.operation !== "change" && input.operation !== "restore") throw new CrmError("INVALID_INPUT", "Operation ist nicht zugelassen.");
  if (!/^[A-Za-z0-9._:-]{1,191}$/.test(input.entity_id)) throw new CrmError("INVALID_INPUT", "Datensatz-ID ist ungueltig.");
  if (!/^\d+$/.test(input.expected_revision)) throw new CrmError("INVALID_INPUT", "Revision ist ungueltig.");
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotency_key)) throw new CrmError("INVALID_INPUT", "Idempotenzschluessel ist ungueltig.");
  if (input.reason.trim().length < 3 || input.reason.length > 500) throw new CrmError("INVALID_INPUT", "Begruendung fehlt.");
}

function normalized(input: ChangeInput) {
  return { operation: input.operation, entity_type: input.entity_type, entity_id: input.entity_id, expected_revision: input.expected_revision, patch: input.patch, reason: input.reason, idempotency_key: input.idempotency_key, approval_id: input.approval_id ?? null, source_event_id: input.source_event_id ?? null };
}

async function rollbackQuiet(session: SqlSession): Promise<void> {
  try {
    await session.query("ROLLBACK");
  } catch {
    return;
  }
}


export async function listHistory(session: SqlSession, entityType: string, entityId: string): Promise<{ rows: Array<Record<string, unknown>> }> {
  if (!/^[a-z_]{1,64}$/.test(entityType) || !/^[A-Za-z0-9._:-]{1,191}$/.test(entityId)) {
    throw new CrmError("INVALID_INPUT", "History-Ziel ist ungueltig.");
  }
  const rows = await session.query(
    "SELECT event_id, revision_before, revision_after, operation, created_at, source_event_id, reason, typed_changes FROM rb_events WHERE entity_type=? AND entity_id=? ORDER BY revision_after DESC LIMIT 50",
    [entityType, entityId],
  );
  return { rows: rows.rows };
}
