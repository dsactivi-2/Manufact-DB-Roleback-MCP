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
  primaryKey: string;
  schemaVerified: boolean;
  testOnly: boolean;
  fields: FieldDefinition[];
}

export const ENTITIES: readonly EntityDefinition[] = [
  {
    entityType: "synthetic_candidate",
    table: "rb_synth_candidate",
    primaryKey: "candidate_id",
    schemaVerified: true,
    testOnly: true,
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
    schemaVerified: false,
    testOnly: false,
    fields: [],
  },
];

export function entityByType(entityType: string): EntityDefinition {
  const found = ENTITIES.find((entity) => entity.entityType === entityType);
  if (!found) throw new Error("Unbekannter Datensatztyp.");
  return found;
}

export function assertWritableEntity(entity: EntityDefinition, allowTestEntities: boolean): void {
  if (!entity.schemaVerified || entity.fields.length === 0) {
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
