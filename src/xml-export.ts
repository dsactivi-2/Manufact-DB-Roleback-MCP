export const EXPORT_PAGE_SIZE = 50;
export const EXPORT_MAX_ROWS = 1000;

const FIELDS = ["kandidat_id", "kandidat_ime", "kandidat_prezime", "kandidat_status", "alter_jahre"] as const;

export interface CandidateExportPage {
  total_count: number;
  has_more: boolean;
  next_cursor: string | null;
  rows: Array<Record<string, unknown>>;
}

export interface CandidateExportResult {
  xml: string;
  total_count: number;
  returned_count: number;
  truncated: boolean;
  next_cursor: string | null;
}

export function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return xmlEscape(value);
  return null;
}

export function candidatesToXml(rows: Array<Record<string, unknown>>, meta: { totalCount: number; truncated: boolean; nextCursor: string | null }, options: { includePhone?: boolean } = {}): string {
  const selected = options.includePhone ? [...FIELDS, "telefon"] : [...FIELDS];
  const body = rows.map((row) => {
    const fields = selected.flatMap((field) => {
      const value = xmlValue(row[field]);
      return value === null ? [] : ["    <" + field + ">" + value + "</" + field + ">"];
    });
    return ["  <kandidat>", ...fields, "  </kandidat>"].join("\n");
  });
  const next = meta.nextCursor === null ? "" : ' next_cursor="' + xmlEscape(meta.nextCursor) + '"';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kandidaten total_count="' + String(meta.totalCount) + '" returned_count="' + String(rows.length) + '" truncated="' + String(meta.truncated) + '"' + next + ">",
    ...body,
    "</kandidaten>",
    "",
  ].join("\n");
}

export async function collectCandidateExport(
  search: (args: Record<string, unknown>) => Promise<CandidateExportPage>,
  filters: Record<string, unknown>,
  options: { maxRows: number; cursor?: string },
): Promise<CandidateExportResult> {
  if (!Number.isSafeInteger(options.maxRows) || options.maxRows < 1 || options.maxRows > EXPORT_MAX_ROWS) {
    throw new Error("max_rows mora biti izmedju 1 i " + EXPORT_MAX_ROWS + ".");
  }
  const rows: Array<Record<string, unknown>> = [];
  let cursor = options.cursor;
  let total = 0;
  let truncated = false;
  let next: string | null = null;
  const steps = Array.isArray(filters.koraci) ? filters.koraci as Array<Record<string, unknown>> : [];
  const includePhone = filters.ukljuci_telefon === true || typeof filters.telefon === "string" || steps.some((step) => typeof step.telefon === "string");
  while (rows.length < options.maxRows) {
    const page = await search({ ...filters, page_size: Math.min(EXPORT_PAGE_SIZE, options.maxRows - rows.length), cursor });
    total = page.total_count;
    const room = options.maxRows - rows.length;
    const take = page.rows.slice(0, room);
    rows.push(...take);
    if (take.length < page.rows.length) {
      truncated = true;
      const last = take.at(-1)?.kandidat_id;
      next = last === undefined ? null : String(last);
      break;
    }
    if (!page.has_more || !page.next_cursor) break;
    if (rows.length >= options.maxRows) {
      truncated = true;
      next = page.next_cursor;
      break;
    }
    cursor = page.next_cursor;
  }
  return {
    xml: candidatesToXml(rows, { totalCount: total, truncated, nextCursor: next }, { includePhone }),
    total_count: total,
    returned_count: rows.length,
    truncated,
    next_cursor: next,
  };
}
