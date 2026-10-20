import { ENTITIES } from "./registry.js";

export interface TablePrivilege {
  table: string;
  select: readonly string[];
  update: readonly string[];
  insertColumns: readonly string[];
  insert: boolean;
  delete: false;
  drop: false;
}

const HISTORY_TABLES = [
  "rb_entity_state",
  "rb_field_state",
  "rb_baselines",
  "rb_events",
  "rb_requests",
  "rb_outbox",
  "rb_approvals",
] as const;

export function minimalPrivileges(): TablePrivilege[] {
  const business = ENTITIES.filter((entity) => !entity.testOnly).map((entity) => ({
    table: entity.table,
    select: [...new Set([entity.primaryKey, ...entity.fields.map((field) => field.column)].filter((column): column is string => Boolean(column)))],
    update: entity.operations.update ? entity.fields.filter((field) => field.writable !== false).map((field) => field.column) : [],
    insertColumns: entity.operations.insert ? entity.fields.map((field) => field.column) : [],
    insert: false,
    delete: false as const,
    drop: false as const,
  }));
  const history = HISTORY_TABLES.map((table) => ({
    table,
    select: [],
    update: [],
    insertColumns: [],
    insert: true,
    delete: false as const,
    drop: false as const,
  }));
  return [...business, ...history];
}
