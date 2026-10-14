import type { TypedValue } from "./canonical.js";

export interface FieldDefinition {
  apiField: string;
  column: string;
  type: Exclude<TypedValue["type"], "null">;
  nullable: boolean;
}

export interface EntityDefinition {
  entityType: string;
  table: string;
  primaryKey: string | null;
  schemaVerified: boolean;
  testOnly: boolean;
  access: "read" | "write" | "approve_write";
  operations: {
    read: boolean;
    update: boolean;
    insert: boolean;
    restore: boolean;
    delete: false;
    drop: false;
  };
  fields: FieldDefinition[];
}

const approveUpdate = { read: true, update: true, insert: false, restore: true, delete: false, drop: false } as const;
const approveChild = { read: true, update: true, insert: true, restore: true, delete: false, drop: false } as const;
const readOnly = { read: true, update: false, insert: false, restore: false, delete: false, drop: false } as const;

export const ENTITIES: readonly EntityDefinition[] = [
  {
    entityType: "synthetic_candidate",
    table: "rb_synth_candidate",
    primaryKey: "candidate_id",
    schemaVerified: true,
    testOnly: true,
    access: "approve_write",
    operations: approveUpdate,
    fields: [
      { apiField: "telephone", column: "telephone", type: "string", nullable: true },
      { apiField: "address", column: "address", type: "string", nullable: true },
      { apiField: "fee", column: "fee", type: "decimal", nullable: true },
      { apiField: "external_no", column: "external_no", type: "integer", nullable: true },
    ],
  },
  {
    entityType: "candidate",
    table: "idk_kandidati",
    primaryKey: "kandidat_id",
    schemaVerified: true,
    testOnly: false,
    access: "approve_write",
    operations: approveUpdate,
    fields: [
      { apiField: "first_name", column: "kandidat_ime", type: "string", nullable: false },
      { apiField: "last_name", column: "kandidat_prezime", type: "string", nullable: false },
      { apiField: "birth_date", column: "kandidat_datumrodjenja", type: "string", nullable: true },
      { apiField: "citizenship_type", column: "kandidat_drzavljanstvo_vrsta", type: "string", nullable: true },
      { apiField: "status", column: "kandidat_status", type: "integer", nullable: false },
      { apiField: "group_id", column: "kandidat_group", type: "integer", nullable: false },
    ],
  },
  {
    entityType: "company",
    table: "idk_companies",
    primaryKey: "company_id",
    schemaVerified: true,
    testOnly: false,
    access: "approve_write",
    operations: approveUpdate,
    fields: [
      { apiField: "name", column: "company_name", type: "string", nullable: false },
      { apiField: "country", column: "company_country", type: "string", nullable: true },
      { apiField: "status", column: "company_status", type: "integer", nullable: true },
    ],
  },
  {
    entityType: "order",
    table: "idk_nalozi",
    primaryKey: "nalog_id",
    schemaVerified: true,
    testOnly: false,
    access: "approve_write",
    operations: approveUpdate,
    fields: [
      { apiField: "name", column: "nalog_naziv", type: "string", nullable: true },
      { apiField: "description", column: "nalog_opis", type: "string", nullable: true },
      { apiField: "status", column: "nalog_status", type: "integer", nullable: true },
    ],
  },
  {
    entityType: "candidate_group",
    table: "idk_kandidati_grupe",
    primaryKey: "kg_id",
    schemaVerified: true,
    testOnly: false,
    access: "approve_write",
    operations: approveUpdate,
    fields: [
      { apiField: "title", column: "kg_title", type: "string", nullable: false },
    ],
  },
  {
    entityType: "candidate_education",
    table: "idk_kandidat_edukacija",
    primaryKey: "ke_id",
    schemaVerified: true,
    testOnly: false,
    access: "approve_write",
    operations: approveChild,
    fields: [
      { apiField: "qualification", column: "ke_naziv_kvalifikacije", type: "string", nullable: false },
      { apiField: "name", column: "ke_naziv", type: "string", nullable: true },
      { apiField: "candidate_id", column: "ke_kandidat_id", type: "integer", nullable: false },
    ],
  },
  {
    entityType: "candidate_language",
    table: "idk_kandidat_jezici",
    primaryKey: "kj_id",
    schemaVerified: true,
    testOnly: false,
    access: "approve_write",
    operations: approveChild,
    fields: [
      { apiField: "name", column: "kj_naziv", type: "string", nullable: false },
      { apiField: "listening", column: "kj_slusanje", type: "string", nullable: false },
      { apiField: "reading", column: "kj_citanje", type: "string", nullable: false },
      { apiField: "spoken_interaction", column: "kj_govorna_interakcija", type: "string", nullable: false },
      { apiField: "spoken_production", column: "kj_govorna_produkcija", type: "string", nullable: false },
      { apiField: "writing", column: "kj_pisanje", type: "string", nullable: false },
      { apiField: "candidate_id", column: "kj_kandidatid", type: "integer", nullable: false },
    ],
  },
  {
    entityType: "candidate_experience",
    table: "idk_kandidat_radno_iskustvo",
    primaryKey: "kri_id",
    schemaVerified: true,
    testOnly: false,
    access: "approve_write",
    operations: approveChild,
    fields: [
      { apiField: "from_date", column: "kri_darum_od", type: "string", nullable: false },
      { apiField: "to_date", column: "kri_datum_do", type: "string", nullable: true },
      { apiField: "position", column: "kri_pozicija", type: "string", nullable: false },
      { apiField: "employer", column: "kri_naziv", type: "string", nullable: false },
      { apiField: "candidate_id", column: "kri_kandidat_id", type: "integer", nullable: false },
    ],
  },
  {
    entityType: "candidate_status",
    table: "idk_kandidat_status",
    primaryKey: null,
    schemaVerified: true,
    testOnly: false,
    access: "read",
    operations: readOnly,
    fields: [
      { apiField: "status_id", column: "status_id", type: "integer", nullable: true },
      { apiField: "name", column: "status_naziv", type: "string", nullable: true },
    ],
  },
];

export function publicEntityPolicies() {
  return ENTITIES.filter((entity) => !entity.testOnly).map((entity) => ({
    entity_type: entity.entityType,
    table: entity.table,
    primary_key: entity.primaryKey,
    access: entity.access,
    available_access: entity.primaryKey && (entity.operations.update || entity.operations.insert) ? ["read", "approve_write", "write"] as const : ["read"] as const,
    operations: entity.operations,
    fields: entity.fields.map((field) => ({ name: field.apiField, type: field.type, nullable: field.nullable })),
  }));
}

export function entityByType(entityType: string): EntityDefinition {
  const found = ENTITIES.find((entity) => entity.entityType === entityType);
  if (!found) throw new Error("Unbekannter Datensatztyp.");
  return found;
}

export function assertWritableEntity(entity: EntityDefinition, allowTestEntities: boolean): asserts entity is EntityDefinition & { primaryKey: string } {
  if (!entity.schemaVerified || !entity.primaryKey || entity.fields.length === 0 || entity.access === "read" || !(entity.operations.update || entity.operations.insert)) {
    throw new Error("Das echte CRM-Schema ist noch nicht geprueft. Schreibfelder bleiben gesperrt.");
  }
  if (entity.testOnly && !allowTestEntities) throw new Error("Testentitaeten sind in dieser Umgebung aus.");
}

export function fieldByApi(entity: EntityDefinition, apiField: string): FieldDefinition {
  const field = entity.fields.find((item) => item.apiField === apiField);
  if (!field) throw new Error("Feld ist nicht freigegeben.");
  return field;
}

export function quoteIdent(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("SQL-Name ist nicht zugelassen.");
  return "`" + value + "`";
}
