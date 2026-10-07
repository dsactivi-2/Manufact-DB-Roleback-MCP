import { z } from "zod";

const shortText = z.string().max(500);
const cursor = z.string().regex(/^[0-9]+$/);
const pageSize = z.number().int().min(1).max(50);
export const readSchemas = {
  candidates: z.object({
    name: shortText.optional(), eu_buerger: z.boolean().optional(),
    alter_von: z.number().int().min(0).max(150).optional(),
    alter_bis: z.number().int().min(0).max(150).optional(),
    position_text: shortText.optional(), sprache: shortText.optional(),
    niveau: shortText.optional(), fertigkeit: z.enum(["zuhoeren", "lesen", "schreiben"]).optional(),
    archived: z.boolean().optional(), page_size: pageSize.optional(),
    cursor: cursor.optional(), count_only: z.boolean().optional(),
  }).strict(),
  companies: z.object({ q: shortText.optional(), country: shortText.optional(),
    status: z.number().int().optional(), page_size: pageSize.optional(), cursor: cursor.optional() }).strict(),
  orders: z.object({ q: shortText.optional(), status: z.number().int().optional(),
    page_size: pageSize.optional(), cursor: cursor.optional() }).strict(),
  professions: z.object({ begriffe: z.array(shortText.min(1)).min(1).max(30),
    archived: z.boolean().optional(), sprache: shortText.optional(),
    top_positionen: pageSize.optional() }).strict(),
  resolve_profession: z.object({ begriff: shortText.min(1), archived: z.boolean().optional(),
    limit: pageSize.optional() }).strict(),
  profile: z.object({ kandidat_id: z.number().int().positive().safe() }).strict(),
  stats: z.object({}).strict(),
  tables: z.object({ search: shortText.optional() }).strict(),
  describe: z.object({ table: shortText.min(1) }).strict(),
  query: z.object({ sql: z.string().min(1).max(10000) }).strict(),
} as const;
export type ReadOperation = keyof typeof readSchemas;
export function isReadOperation(value: string): value is ReadOperation {
  return Object.prototype.hasOwnProperty.call(readSchemas, value);
}
