import type { Actor } from "./identity.js";

const BUSINESS_ENTITIES = [
  "candidate", "company", "order", "candidate_group",
] as const;
const CHILD_ENTITIES = [
  "candidate_education", "candidate_language", "candidate_experience",
] as const;

const ADMIN_ONLY_ENTITIES = ["company", "order"] as const;

const READ_ENTITIES = [
  "candidate", "candidate_group",
  ...CHILD_ENTITIES,
  "candidate_status",
] as const;

export const WORKOS_ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  "crm-reader": ["crm:read"],
  "crm-sql": ["crm:read", "sql:read"],
  "crm-reader-entities": entityPermissions("read"),
  "crm-writer-approval": [...entityPermissions("read"), ...entityPermissions("request_write")],
  "crm-writer-auto": [...entityPermissions("read"), ...entityPermissions("write")],
  "crm-approver": [...entityPermissions("read"), ...entityPermissions("approve_write")],
  admin: ["crm:admin"],
  "crm-admin": ["crm:admin"],
};

export function rolesFromPayload(payload: Record<string, unknown>): string[] {
  const roles = stringList(payload.roles);
  if (typeof payload.role === "string" && payload.role.trim()) roles.push(payload.role.trim());
  return [...new Set(roles)];
}

export function permissionsFromRoles(roles: readonly string[]): string[] {
  return [...new Set(roles.flatMap((role) => WORKOS_ROLE_PERMISSIONS[role] ?? []))];
}

export function isCrmAdmin(actor: Actor): boolean {
  return validActor(actor) && actor.scopes.includes("crm:admin");
}

export function canReadCandidates(actor: Actor): boolean {
  return validActor(actor) && (actor.scopes.includes("crm:read") || actor.scopes.includes("crm:candidate:read") || isCrmAdmin(actor));
}

export function canReadEntity(actor: Actor, entityType: string): boolean {
  if (!validActor(actor) || entityType.trim().length === 0) return false;
  if (isAdminOnlyEntity(entityType)) return isCrmAdmin(actor);
  return isCrmAdmin(actor) || actor.scopes.includes("crm:read") || actor.scopes.includes("crm:" + entityType + ":read");
}

export function canReadAll(actor: Actor, entityTypes: readonly string[]): boolean {
  return entityTypes.every((entityType) => canReadEntity(actor, entityType));
}

export function canReadMetadata(actor: Actor): boolean {
  return isCrmAdmin(actor);
}

export function canRequestWrite(actor: Actor, entityType: string): boolean {
  if (!validNamedActor(actor) || (isAdminOnlyEntity(entityType) && !isCrmAdmin(actor))) return false;
  return actor.scopes.includes("crm:write")
    || actor.scopes.includes("crm:" + entityType + ":request_write")
    || actor.scopes.includes("crm:" + entityType + ":write");
}

export function canAutomaticWrite(actor: Actor, entityType: string): boolean {
  return validNamedActor(actor) && (!isAdminOnlyEntity(entityType) || isCrmAdmin(actor)) && (actor.scopes.includes("crm:write") || actor.scopes.includes("crm:" + entityType + ":write"));
}

export function canApproveWrite(actor: Actor, entityType: string): boolean {
  return validNamedActor(actor) && (!isAdminOnlyEntity(entityType) || isCrmAdmin(actor)) && actor.scopes.includes("crm:" + entityType + ":approve_write");
}

export function entityRequiresApproval(access: "read" | "write" | "approve_write", actor: Actor, entityType: string): boolean {
  return access !== "write" || !canAutomaticWrite(actor, entityType);
}

export function canWriteAny(actor: Actor): boolean {
  return validNamedActor(actor) && (actor.scopes.includes("crm:write") || actor.scopes.some((scope) => /^crm:[a-z_]+:(request_write|write|approve_write)$/.test(scope)));
}

export function isAdminOnlyEntity(entityType: string): boolean {
  return (ADMIN_ONLY_ENTITIES as readonly string[]).includes(entityType);
}

export function statsVisibleTo(actor: Actor, row: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!canReadCandidates(actor)) return {};
  const source = row ?? {};
  const visible: Record<string, unknown> = {};
  if ("kandidaten" in source) visible.kandidaten = source.kandidaten;
  if ("aktiv" in source) visible.aktiv = source.aktiv;
  if (isCrmAdmin(actor) && "firmen" in source) visible.firmen = source.firmen;
  if (isCrmAdmin(actor) && "auftraege" in source) visible.auftraege = source.auftraege;
  return visible;
}

function entityPermissions(operation: "read" | "request_write" | "write" | "approve_write"): string[] {
  const entities = operation === "read" ? READ_ENTITIES : [...BUSINESS_ENTITIES, ...CHILD_ENTITIES];
  return entities.map((entity) => `crm:${entity}:${operation}`);
}

function validActor(actor: Actor): boolean {
  return actor.subject !== "unknown";
}

function validNamedActor(actor: Actor): boolean {
  return validActor(actor) && actor.subject !== "shared-token";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}
