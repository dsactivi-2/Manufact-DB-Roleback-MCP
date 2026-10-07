const PAGE_SIZE = 50;
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "BEZ ZNANJA"] as const;
const ALLOWED_TABLE = /^(?:idk_[A-Za-z0-9_]+|beruf_mapping)$/;
const WRITE_WORD = /\b(insert|update|delete|drop|alter|create|replace|grant|revoke|call|load|into|outfile|dumpfile|union|intersect|except)\b/i;

export type SqlParams = unknown[];

export interface ReadPlan {
  countSql: string;
  countParams: SqlParams;
  rowSql: string;
  rowParams: SqlParams;
  pageSize: number;
}

function pageSize(value: unknown): number {
  if (value === undefined) return PAGE_SIZE;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > PAGE_SIZE) {
    throw new Error("Seitengroesse ist 50. Eine groessere Seite ist nicht erlaubt.");
  }
  return value;
}

function whereSql(clauses: string[]): string {
  return clauses.length ? "WHERE " + clauses.join(" AND ") : "";
}

function cursorValue(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new Error("Ungueltiger Fortsetzungscursor.");
  }
  return value;
}

export interface CandidateArgs {
  name?: string;
  eu_buerger?: boolean;
  alter_von?: number;
  alter_bis?: number;
  position_text?: string;
  berufsgruppe_id?: string;
  sprache?: string;
  niveau?: string;
  fertigkeit?: "zuhoeren" | "lesen" | "schreiben";
  archived?: boolean;
  page_size?: number;
  limit?: number;
  cursor?: string;
  count_only?: boolean;
}

export function buildCandidateSearch(args: CandidateArgs = {}): ReadPlan {
  if (args.limit !== undefined && args.page_size !== undefined) {
    throw new Error("Nur limit oder page_size angeben.");
  }
  const size = pageSize(args.page_size ?? args.limit);
  const clauses: string[] = [];
  const params: SqlParams = [];
  if (!args.archived) clauses.push("k.kandidat_status <> 3");
  if (args.name) {
    clauses.push("(k.kandidat_ime LIKE ? OR k.kandidat_prezime LIKE ?)");
    params.push("%" + args.name + "%", "%" + args.name + "%");
  }
  if (args.eu_buerger === true) {
    clauses.push("k.kandidat_drzavljanstvo_vrsta LIKE ?");
    params.push("EU%");
  } else if (args.eu_buerger === false) {
    clauses.push("(k.kandidat_drzavljanstvo_vrsta NOT LIKE ? OR k.kandidat_drzavljanstvo_vrsta IS NULL OR TRIM(k.kandidat_drzavljanstvo_vrsta) = '')");
    params.push("EU%");
  }
  if (args.alter_von !== undefined || args.alter_bis !== undefined) {
    const from = args.alter_von ?? 0;
    const to = args.alter_bis ?? 150;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to > 150 || from > to) {
      throw new Error("Alter muss zwischen 0 und 150 liegen.");
    }
    clauses.push("k.kandidat_datumrodjenja IS NOT NULL");
    clauses.push("TIMESTAMPDIFF(YEAR, k.kandidat_datumrodjenja, CURRENT_DATE) BETWEEN ? AND ?");
    params.push(from, to);
  }
  if (args.position_text || args.berufsgruppe_id) {
    const term = args.position_text ?? args.berufsgruppe_id;
    clauses.push("EXISTS (SELECT 1 FROM idk_kandidat_radno_iskustvo w WHERE w.kri_kandidat_id = k.kandidat_id AND w.kri_pozicija LIKE ?)");
    params.push("%" + term + "%");
  }
  if (args.sprache || args.niveau) {
    const column = args.fertigkeit === "lesen" ? "kj_citanje" : args.fertigkeit === "schreiben" ? "kj_pisanje" : "kj_slusanje";
    const languageClauses = ["j.kj_kandidatid = k.kandidat_id"];
    if (args.sprache) {
      languageClauses.push("TRIM(j.kj_naziv) = ?");
      params.push(args.sprache.trim());
    }
    if (args.niveau) {
      const minimum = args.niveau.trim().toUpperCase();
      const start = LEVELS.indexOf(minimum as (typeof LEVELS)[number]);
      if (start < 0) throw new Error("Sprachniveau ist ungueltig.");
      const accepted = minimum === "BEZ ZNANJA" ? ["BEZ ZNANJA"] : LEVELS.slice(start).filter((level) => level !== "BEZ ZNANJA");
      languageClauses.push("j." + column + " IN (" + accepted.map(() => "?").join(", ") + ")");
      params.push(...accepted);
    }
    clauses.push("EXISTS (SELECT 1 FROM idk_kandidat_jezici j WHERE " + languageClauses.join(" AND ") + ")");
  }
  const countSql = "SELECT COUNT(DISTINCT k.kandidat_id) AS total_count FROM idk_kandidati k " + whereSql(clauses);
  const rowParams = params.slice();
  const rowClauses = clauses.slice();
  if (args.cursor !== undefined) {
    rowClauses.push("k.kandidat_id < ?");
    rowParams.push(cursorValue(args.cursor));
  }
  const rowSql = [
    "SELECT k.kandidat_id, k.kandidat_ime, k.kandidat_prezime, k.kandidat_status,",
    "k.kandidat_datumrodjenja,",
    "TIMESTAMPDIFF(YEAR, k.kandidat_datumrodjenja, CURRENT_DATE) AS alter_jahre",
    "FROM idk_kandidati k " + whereSql(rowClauses),
    "ORDER BY k.kandidat_id DESC",
    "LIMIT " + (size + 1),
  ].join(" ");
  return { countSql, countParams: params, rowSql, rowParams, pageSize: size };
}

export interface ListArgs {
  q?: string;
  country?: string;
  status?: number;
  page_size?: number;
  limit?: number;
  cursor?: string;
}

function filteredRead(table: string, columns: string, idColumn: string, args: ListArgs, filters: (clauses: string[], params: SqlParams) => void): ReadPlan {
  const size = pageSize(args.page_size ?? args.limit);
  const clauses: string[] = [];
  const params: SqlParams = [];
  filters(clauses, params);
  const rowClauses = clauses.slice();
  const rowParams = params.slice();
  if (args.cursor !== undefined) {
    rowClauses.push(idColumn + " < ?");
    rowParams.push(cursorValue(args.cursor));
  }
  return {
    countSql: "SELECT COUNT(*) AS total_count FROM " + table + " " + whereSql(clauses),
    countParams: params,
    rowSql: "SELECT " + columns + " FROM " + table + " " + whereSql(rowClauses) + " ORDER BY " + idColumn + " DESC LIMIT " + (size + 1),
    rowParams,
    pageSize: size,
  };
}

export function buildCompanySearch(args: ListArgs = {}): ReadPlan {
  return filteredRead("idk_companies", "company_id, company_name, company_country, company_status", "company_id", args, (clauses, params) => {
    if (args.q) {
      clauses.push("company_name LIKE ?");
      params.push("%" + args.q + "%");
    }
    if (args.country) {
      clauses.push("company_country = ?");
      params.push(args.country);
    }
    if (args.status !== undefined) {
      clauses.push("company_status = ?");
      params.push(args.status);
    }
  });
}

export function buildOrderSearch(args: ListArgs = {}): ReadPlan {
  return filteredRead("idk_nalozi", "nalog_id, nalog_naziv AS nalog_naslov, nalog_opis, nalog_status", "nalog_id", args, (clauses, params) => {
    if (args.q) {
      clauses.push("(nalog_naziv LIKE ? OR nalog_opis LIKE ?)");
      params.push("%" + args.q + "%", "%" + args.q + "%");
    }
    if (args.status !== undefined) {
      clauses.push("nalog_status = ?");
      params.push(args.status);
    }
  });
}

export function buildProfile(kandidatId: number) {
  if (!Number.isSafeInteger(kandidatId) || kandidatId < 1) throw new Error("kandidat_id fehlt.");
  return {
    baseSql: "SELECT k.kandidat_id, k.kandidat_ime, k.kandidat_prezime, k.kandidat_status, k.kandidat_datumrodjenja, g.kg_title AS gruppe, s.status_naziv AS status_label FROM idk_kandidati k LEFT JOIN idk_kandidati_grupe g ON g.kg_id = k.kandidat_group LEFT JOIN idk_kandidat_status s ON s.status_id = k.kandidat_status WHERE k.kandidat_id = ?",
    languageSql: "SELECT kj_naziv, kj_slusanje, kj_citanje, kj_pisanje FROM idk_kandidat_jezici WHERE kj_kandidatid = ?",
    experienceSql: "SELECT w.kri_pozicija, w.kri_darum_od, w.kri_datum_do FROM idk_kandidat_radno_iskustvo w WHERE w.kri_kandidat_id = ?",
    educationSql: "SELECT ke_naziv, ke_naziv_kvalifikacije FROM idk_kandidat_edukacija WHERE ke_kandidat_id = ?",
    params: [kandidatId],
  };
}

export function buildListTables(search?: string) {
  const clauses = ["TABLE_SCHEMA = DATABASE()", "TABLE_NAME LIKE 'idk_%'"];
  const params: SqlParams = [];
  if (search) {
    clauses.push("TABLE_NAME LIKE ?");
    params.push("%" + search + "%");
  }
  return {
    sql: "SELECT TABLE_NAME AS table_name, TABLE_ROWS AS approx_rows FROM information_schema.TABLES WHERE " + clauses.join(" AND ") + " ORDER BY TABLE_NAME",
    params,
  };
}

export function buildDescribeTable(table: string) {
  if (!ALLOWED_TABLE.test(table)) throw new Error("Tabelle nicht erlaubt.");
  return {
    sql: "SELECT COLUMN_NAME AS column_name, COLUMN_TYPE AS column_type, IS_NULLABLE AS nullable, COLUMN_KEY AS key_kind FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
    params: [table],
  };
}

export function buildCrmQuery(sql: string) {
  const text = String(sql ?? "").trim();
  if (text.includes(";")) throw new Error("Nur ein SELECT ist erlaubt.");
  if (text.includes("--") || text.includes("/*") || text.includes("#")) throw new Error("Kommentare sind nicht erlaubt.");
  if (!/^select\b/i.test(text)) throw new Error("Nur SELECT-Queries erlaubt.");
  if (WRITE_WORD.test(text)) throw new Error("Nur ein lesendes SELECT ist erlaubt.");
  if (/select\s+\*/i.test(text) || /select\s+[a-z_][a-z0-9_]*\.\*/i.test(text)) throw new Error("SELECT * ist nicht erlaubt.");
  if (/\boffset\b/i.test(text)) throw new Error("OFFSET ist verboten. Die naechste Seite kommt ueber den Cursor.");
  const tables = [...text.matchAll(/\b(?:from|join)\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map((match) => match[1] ?? "");
  if (tables.length === 0 || tables.some((table) => !ALLOWED_TABLE.test(table))) {
    const blocked = tables.find((table) => !ALLOWED_TABLE.test(table)) ?? "unbekannt";
    throw new Error("Tabelle '" + blocked + "' ist nicht erlaubt.");
  }
  const limit = text.match(/\blimit\s+(\d+)\b/i);
  const aggregate = /^select\s+(?:count|sum|min|max|avg)\s*\(/i.test(text);
  if (aggregate) {
    if (limit) throw new Error("Eine Zaehlung bekommt kein Seitenlimit.");
    return { mode: "count" as const, sql: text, params: [] as SqlParams };
  }
  if (limit && Number(limit[1]) > PAGE_SIZE) throw new Error("Eine Liste hat hoechstens 50 Zeilen pro Seite.");
  if (!limit) return { mode: "page" as const, sql: text + " LIMIT 51", params: [] as SqlParams };
  return { mode: "page" as const, sql: text, params: [] as SqlParams };
}

export interface ReportArgs {
  begriffe?: string[];
  archived?: boolean;
  sprache?: string;
  top_positionen?: number;
}

export function buildBerufReport(args: ReportArgs = {}) {
  if (!Array.isArray(args.begriffe) || args.begriffe.length === 0) throw new Error("Mindestens ein Suchbegriff ist noetig.");
  const requested = args.top_positionen ?? 15;
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error("Top-Positionen muessen eine positive ganze Zahl sein.");
  const top = Math.min(requested, 50);
  const like = args.begriffe.map(() => "w.kri_pozicija LIKE ?").join(" OR ");
  const likeParams = args.begriffe.map((term) => "%" + term + "%");
  const archive = args.archived ? "" : " AND k.kandidat_status <> 3";
  const language = args.sprache?.trim() ?? "";
  return {
    countSql: "SELECT COUNT(DISTINCT k.kandidat_id) AS n FROM idk_kandidati k WHERE EXISTS (SELECT 1 FROM idk_kandidat_radno_iskustvo w WHERE w.kri_kandidat_id = k.kandidat_id AND (" + like + "))" + archive,
    countParams: likeParams,
    positionSql: "SELECT w.kri_pozicija AS position, COUNT(DISTINCT w.kri_kandidat_id) AS kandidaten FROM idk_kandidat_radno_iskustvo w JOIN idk_kandidati k ON k.kandidat_id = w.kri_kandidat_id WHERE (" + like + ")" + archive + " GROUP BY w.kri_pozicija ORDER BY kandidaten DESC LIMIT " + top,
    positionParams: likeParams,
    languageSql: language
      ? "SELECT j.kj_slusanje AS zuhoeren, COUNT(DISTINCT k.kandidat_id) AS kandidaten FROM idk_kandidati k JOIN idk_kandidat_radno_iskustvo w ON w.kri_kandidat_id = k.kandidat_id JOIN idk_kandidat_jezici j ON j.kj_kandidatid = k.kandidat_id WHERE (" + like + ") AND TRIM(j.kj_naziv) = ?" + archive + " GROUP BY j.kj_slusanje"
      : null,
    languageParams: language ? likeParams.concat(language) : null,
  };
}

export function buildResolveBeruf(args: { begriff?: string; archived?: boolean; limit?: number }) {
  const term = args.begriff?.trim() ?? "";
  if (!term) throw new Error("Ein Berufsbegriff ist noetig.");
  const requested = args.limit ?? 15;
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error("Die Variantenliste ist zu gross.");
  const top = Math.min(requested, 50);
  const archive = args.archived ? "" : " AND k.kandidat_status <> 3";
  return {
    sql: "SELECT w.kri_pozicija AS position, COUNT(DISTINCT k.kandidat_id) AS kandidaten FROM idk_kandidat_radno_iskustvo w JOIN idk_kandidati k ON k.kandidat_id = w.kri_kandidat_id WHERE w.kri_pozicija LIKE ?" + archive + " GROUP BY w.kri_pozicija ORDER BY kandidaten DESC LIMIT " + top,
    params: ["%" + term + "%"],
  };
}
