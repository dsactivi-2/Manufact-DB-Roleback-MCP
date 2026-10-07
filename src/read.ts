import {
  buildBerufReport,
  buildCandidateSearch,
  buildCompanySearch,
  buildCrmQuery,
  buildDescribeTable,
  buildListTables,
  buildOrderSearch,
  buildProfile,
  buildResolveBeruf,
  type CandidateArgs,
  type ListArgs,
  type ReadPlan,
  type ReportArgs,
} from "./sql.js";

export interface Db {
  query(sql: string, params: unknown[]): Promise<Array<Record<string, unknown>>>;
}

export interface Page {
  total_count: number;
  returned_count: number;
  has_more: boolean;
  next_cursor: string | null;
  page_size: number;
  rows: Array<Record<string, unknown>>;
}

function fullCount(rows: Array<Record<string, unknown>>): number {
  const total = Number(rows[0]?.total_count);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("Gesamtzahl konnte nicht bestimmt werden.");
  return total;
}

async function page(db: Db, plan: ReadPlan, idColumn: string): Promise<Page> {
  const total = fullCount(await db.query(plan.countSql, plan.countParams));
  const fetched = await db.query(plan.rowSql, plan.rowParams);
  const hasMore = fetched.length > plan.pageSize;
  const rows = fetched.slice(0, plan.pageSize);
  const last = rows.at(-1)?.[idColumn];
  return {
    total_count: total,
    returned_count: rows.length,
    has_more: hasMore,
    next_cursor: hasMore && last !== undefined ? String(last) : null,
    page_size: plan.pageSize,
    rows,
  };
}

export async function runCandidateSearch(db: Db, args: CandidateArgs = {}) {
  const plan = buildCandidateSearch(args);
  const total = fullCount(await db.query(plan.countSql, plan.countParams));
  if (args.count_only) {
    return { count: total, total_count: total, returned_count: 0, has_more: false, next_cursor: null, rows: [] };
  }
  const result = await page(db, plan, "kandidat_id");
  return { count: total, ...result };
}

export function runCompanySearch(db: Db, args: ListArgs = {}) {
  return page(db, buildCompanySearch(args), "company_id");
}

export function runOrderSearch(db: Db, args: ListArgs = {}) {
  return page(db, buildOrderSearch(args), "nalog_id");
}

export async function runProfile(db: Db, kandidatId: number) {
  const plan = buildProfile(kandidatId);
  const base = await db.query(plan.baseSql, plan.params);
  if (!base.length) return { error: "not_found", kandidat_id: kandidatId };
  const [sprachen, berufserfahrung, edukacija] = await Promise.all([
    db.query(plan.languageSql, plan.params),
    db.query(plan.experienceSql, plan.params),
    db.query(plan.educationSql, plan.params),
  ]);
  return { kandidat: base[0], sprachen, berufserfahrung, edukacija };
}

export async function runListTables(db: Db, search?: string) {
  const plan = buildListTables(search);
  const rows = await db.query(plan.sql, plan.params);
  return { count: rows.length, rows };
}

export async function runDescribeTable(db: Db, table: string) {
  const plan = buildDescribeTable(table);
  const rows = await db.query(plan.sql, plan.params);
  return { table, count: rows.length, rows };
}

export async function runCrmQuery(db: Db, sql: string) {
  const plan = buildCrmQuery(sql);
  const rows = await db.query(plan.sql, plan.params);
  if (plan.mode === "count") return { mode: "count", complete: true, has_more: false, returned_count: rows.length, rows };
  const hasMore = rows.length > 50;
  const pageRows = rows.slice(0, 50);
  return {
    mode: "page",
    complete: false,
    has_more: hasMore,
    page_size: 50,
    returned_count: pageRows.length,
    next_page: hasMore ? "Naechste Seite nur mit demselben SELECT und einer engeren Bedingung. OFFSET ist verboten." : null,
    rows: pageRows,
  };
}

export async function runBerufReport(db: Db, args: ReportArgs = {}) {
  const plan = buildBerufReport(args);
  const counted = await db.query(plan.countSql, plan.countParams);
  const positionen = await db.query(plan.positionSql, plan.positionParams);
  const sprache = plan.languageSql ? await db.query(plan.languageSql, plan.languageParams ?? []) : null;
  return { distinct_candidates: Number(counted[0]?.n), positionen, sprache };
}

export async function runResolveBeruf(db: Db, args: { begriff?: string; archived?: boolean; limit?: number }) {
  const plan = buildResolveBeruf(args);
  const rows = await db.query(plan.sql, plan.params);
  return { varianten: rows, suchlauf: false };
}

export async function runStats(db: Db) {
  const rows = await db.query(
    "SELECT (SELECT COUNT(*) FROM idk_kandidati) AS kandidaten, (SELECT COUNT(*) FROM idk_kandidati WHERE kandidat_status <> 3) AS aktiv, (SELECT COUNT(*) FROM idk_companies) AS firmen, (SELECT COUNT(*) FROM idk_nalozi) AS auftraege",
    [],
  );
  return rows[0];
}
