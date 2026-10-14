import { z } from "zod";

const entityType = z.string().regex(/^[a-z_]{1,64}$/);
const entityId = z.string().regex(/^[A-Za-z0-9._:-]{1,191}$/);
const revision = z.string().regex(/^\d+$/);
const reason = z.string().trim().min(3).max(500);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);
const approvalId = z.string().uuid();
const fieldName = z.string().regex(/^[a-z_][a-z0-9_]{0,63}$/);
const patch = z.record(fieldName, z.string().max(10_000).nullable())
  .refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 20, "Patch muss 1 bis 20 Felder enthalten.");

const changeBase = z.object({
  entity_type: entityType,
  entity_id: entityId,
  expected_revision: revision,
  patch,
  reason,
  idempotency_key: idempotencyKey,
  operation: z.enum(["change", "insert"]).optional(),
}).strict();

const typedValue = z.discriminatedUnion("type", [
  z.object({ type: z.literal("null") }).strict(),
  z.object({ type: z.enum(["string", "decimal", "integer"]), value: z.string().max(10_000) }).strict(),
]);

const preview = z.object({
  preview_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  operation: z.enum(["change", "restore", "insert"]),
  entity_type: entityType,
  entity_id: entityId,
  entity_revision: revision,
  source_event_id: z.string().uuid().nullable(),
  reason,
  fields: z.array(z.object({
    name: fieldName,
    before: typedValue,
    after: typedValue,
    field_revision: revision,
  }).strict()).min(1).max(20),
}).strict();

const restoreBase = z.object({
  entity_type: entityType,
  entity_id: entityId,
  expected_revision: revision,
  source_event_id: z.string().uuid(),
  fields: z.array(fieldName).min(1).max(20).refine((items) => new Set(items).size === items.length, "Felder muessen eindeutig sein."),
  reason,
  idempotency_key: idempotencyKey,
}).strict();

export const mutationSchemas = {
  history: z.object({ entity_type: entityType, entity_id: entityId }).strict(),
  changePreview: changeBase,
  changeApply: changeBase.extend({ approval_id: approvalId }).strict(),
  restorePreview: restoreBase,
  restoreApply: restoreBase.extend({ approval_id: approvalId }).strict(),
  approvalRequest: z.object({ preview }).strict(),
  approvalList: z.object({ entity_type: entityType }).strict(),
  approvalDecide: z.object({ approval_id: approvalId, decision: z.enum(["approved", "rejected"]) }).strict(),
} as const;
