const LANGUAGE_CANONICAL: Record<string, string> = {
  njemacki: "Njemački", nemacki: "Njemački", deutsch: "Njemački", german: "Njemački", de: "Njemački",
  engleski: "Engleski", english: "Engleski", en: "Engleski",
  talijanski: "Talijanski", italijanski: "Talijanski", italiano: "Talijanski", italian: "Talijanski", it: "Talijanski",
  spanjolski: "Španjolski", spanski: "Španjolski", spanish: "Španjolski", espanol: "Španjolski", es: "Španjolski",
  francuski: "Francuski", french: "Francuski", francais: "Francuski", fr: "Francuski",
  ruski: "Ruski", russian: "Ruski", ru: "Ruski",
  arapski: "Arapski", arabic: "Arapski", ar: "Arapski",
  turski: "Turski", turkish: "Turski", turkisch: "Turski", tr: "Turski",
  bosanski: "Bosanski", bosnian: "Bosanski", bosnisch: "Bosanski",
  srpski: "Srpski", srbski: "Srpski", serbian: "Srpski", serbisch: "Srpski",
  hrvatski: "Hrvatski", hrvaski: "Hrvatski", croatian: "Hrvatski", kroatisch: "Hrvatski",
  svedski: "Svedski", swedish: "Svedski", schwedisch: "Svedski",
  madjarski: "Mađarski", madarski: "Mađarski", hungarian: "Mađarski", ungarisch: "Mađarski",
  danski: "Danski", danish: "Danski", danisch: "Danski",
  slovacki: "slovački", slovak: "slovački", slowakisch: "slovački",
  norveski: "Norveški", norwegian: "Norveški", norwegisch: "Norveški",
  bugarski: "Bugarski", bulgarian: "Bugarski", bulgarisch: "Bugarski",
  albanski: "Albanski", albanian: "Albanski", albanisch: "Albanski",
  rumunski: "Rumunski", romanian: "Rumunski", rumaenisch: "Rumunski",
  ceski: "češki", czech: "češki", tschechisch: "češki",
  makedonski: "makedonski", macedonian: "makedonski",
  portugalski: "Portugalski", portuguese: "Portugalski", portugiesisch: "Portugalski",
  holandski: "Holandski", dutch: "Holandski", niederlaendisch: "Holandski",
  grcki: "Grčki", greek: "Grčki", griechisch: "Grčki",
  slovenacki: "Slovenacki", slovenski: "Slovenski", slovenian: "Slovenski", slowenisch: "Slovenski",
};

const SAME_OCCUPATION: Record<string, string[]> = {
  vozac: ["vozac", "fahrer", "driver"],
  fahrer: ["vozac", "fahrer", "driver"],
  driver: ["vozac", "fahrer", "driver"],
  konobar: ["konobar", "kellner", "kellnerin", "waiter"],
  kellner: ["konobar", "kellner", "kellnerin", "waiter"],
  waiter: ["konobar", "kellner", "kellnerin", "waiter"],
  elektricar: ["elektricar", "elektriker", "electrician"],
  elektriker: ["elektricar", "elektriker", "electrician"],
  electrician: ["elektricar", "elektriker", "electrician"],
  automehanicar: ["automehanicar", "automechaniker"],
  automechaniker: ["automehanicar", "automechaniker"],
  trgovac: ["trgovac", "kaufmann", "kauffrau"],
  kaufmann: ["trgovac", "kaufmann", "kauffrau"],
  kauffrau: ["trgovac", "kaufmann", "kauffrau"],
  prodavac: ["prodavac", "verkaufer", "verkauferin"],
  verkaufer: ["prodavac", "verkaufer", "verkauferin"],
  elektroinstalater: ["elektroinstalater", "elektroinstallateur"],
  elektroinstallateur: ["elektroinstalater", "elektroinstallateur"],
  "gradjevinski radnik": ["gradjevinski radnik", "bauarbeiter"],
  bauarbeiter: ["gradjevinski radnik", "bauarbeiter"],
  "skolska praksa": ["skolska praksa", "schulpraktikum"],
  schulpraktikum: ["skolska praksa", "schulpraktikum"],
  kuhar: ["kuhar", "koch", "koechin"],
  koch: ["kuhar", "koch", "koechin"],
  zavarivac: ["zavarivac", "schweisser"],
  schweisser: ["zavarivac", "schweisser"],
  moler: ["moler", "maler"],
  maler: ["moler", "maler"],
  bravar: ["bravar", "schlosser"],
  schlosser: ["bravar", "schlosser"],
  magacioner: ["magacioner", "lagerist", "lagerarbeiter"],
  skladistar: ["skladistar", "lagerist", "lagerarbeiter"],
  lagerist: ["magacioner", "skladistar", "lagerist", "lagerarbeiter"],
  elektromonter: ["elektromonter", "elektromonteur"],
  elektromonteur: ["elektromonter", "elektromonteur"],
  viljuskarista: ["viljuskarista", "staplerfahrer", "gabelstaplerfahrer"],
  staplerfahrer: ["viljuskarista", "staplerfahrer", "gabelstaplerfahrer"],
  dostavljac: ["dostavljac", "zusteller", "kurier"],
  zusteller: ["dostavljac", "zusteller", "kurier"],
};

const LANGUAGE_FILLERS = new Set(["i", "und", "and", "jezik", "sprache", "language", "kenntnisse", "sprachkenntnisse"]);
const LANGUAGE_OR = new Set(["ili", "oder", "or"]);
const NO_KNOWLEDGE = ["Bez znanja", "Bezznanja", "Bez poznavanja"];

interface TextMatch {
  sql: string;
  params: string[];
}

function foldText(value: string): string {
  const stripped = value
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  let out = "";
  let pendingSpace = false;
  for (const ch of stripped) {
    const code = ch.codePointAt(0) ?? 0;
    const keep = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
    if (keep) {
      if (pendingSpace && out.length > 0) out += " ";
      out += ch;
      pendingSpace = false;
    } else {
      pendingSpace = true;
    }
  }
  return out;
}

function accentLike(column: string): string {
  return column + " LIKE ?";
}

function accentEquals(column: string): string {
  return column + " = ?";
}

function nameMatch(name: string): TextMatch | null {
  const tokens = foldText(name).split(" ").filter((token) => token.length > 0).slice(0, 6);
  if (tokens.length === 0) return null;
  const params: string[] = [];
  const parts = tokens.map((token) => {
    const variants = token.includes("dj") ? [token, token.replaceAll("dj", "d")] : [token];
    const checks = variants.map(() => accentLike("k.kandidat_ime") + " OR " + accentLike("k.kandidat_prezime"));
    for (const variant of variants) params.push("%" + variant + "%", "%" + variant + "%");
    return "(" + checks.join(" OR ") + ")";
  });
  return { sql: parts.length === 1 ? parts[0] : "(" + parts.join(" AND ") + ")", params };
}

function occupationStems(term: string): string[][] {
  const folded = foldText(term);
  const phrase = SAME_OCCUPATION[folded];
  if (phrase) return [[...new Set(phrase)]];
  return folded.split(" ").filter((token) => token.length >= 2).map((token) => [...new Set(SAME_OCCUPATION[token] ?? [token])]);
}

function positionMatch(column: string, term: string): TextMatch {
  const groups = occupationStems(term);
  if (groups.length === 0) throw new Error("Berufstext fehlt.");
  const params: string[] = [];
  const parts = groups.map((stems) => {
    const likes = stems.map((stem) => {
      params.push("%" + stem + "%");
      return accentLike(column);
    });
    return "(" + likes.join(" OR ") + ")";
  });
  return { sql: parts.join(" AND "), params };
}

function languageNames(input: string): { mode: "and" | "or"; names: string[] } {
  const folded = foldText(input);
  if (!folded) throw new Error("Sprache fehlt.");
  const direct = LANGUAGE_CANONICAL[folded];
  if (direct) return { mode: "and", names: [direct] };
  const tokens = folded.split(" ");
  const mode = tokens.some((token) => LANGUAGE_OR.has(token)) ? "or" : "and";
  const words = tokens.filter((token) => !LANGUAGE_FILLERS.has(token) && !LANGUAGE_OR.has(token));
  const mapped = words.map((word) => LANGUAGE_CANONICAL[word]);
  if (words.length > 0 && mapped.every((name): name is string => Boolean(name))) {
    return { mode, names: [...new Set(mapped)] };
  }
  return { mode: "and", names: [folded] };
}

function storedSpellings(name: string): string[] {
  if (name === "Mađarski") return ["Mađarski", "Madjarski"];
  if (name === "Slovenski" || name === "Slovenacki") return ["Slovenski", "Slovenacki"];
  return [name];
}

function noKnowledgeMatch(column: string): TextMatch {
  return {
    sql: "(" + NO_KNOWLEDGE.map(() => accentEquals("TRIM(" + column + ")")).join(" OR ") + ")",
    params: [...NO_KNOWLEDGE],
  };
}

function citizenshipMatch(isEu: boolean): TextMatch {
  if (isEu) return { sql: "TRIM(k.kandidat_drzavljanstvo_vrsta) LIKE ?", params: ["EU%"] };
  return {
    sql: "(k.kandidat_drzavljanstvo_vrsta IS NULL OR TRIM(k.kandidat_drzavljanstvo_vrsta) = '' OR TRIM(k.kandidat_drzavljanstvo_vrsta) NOT LIKE ?)",
    params: ["EU%"],
  };
}

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

function levelMatch(column: string, niveau: string | undefined): { sql: string; params: string[] } | null {
  if (!niveau) return null;
  const folded = niveau.trim().toLowerCase().split(" ").filter(Boolean).join(" ");
  const compact = folded.replace(/ /g, "");
  const minimum = compact === "bezznanja" || folded === "bez znanja" || folded === "bez poznavanja" ? "BEZ ZNANJA" : niveau.trim().toUpperCase();
  if (minimum === "BEZ ZNANJA") return noKnowledgeMatch(column);
  const start = LEVELS.indexOf(minimum as (typeof LEVELS)[number]);
  if (start < 0) throw new Error("Sprachniveau ist ungueltig.");
  const accepted = LEVELS.slice(start).filter((level) => level !== "BEZ ZNANJA");
  return { sql: "UPPER(TRIM(" + column + ")) IN (" + accepted.map(() => "?").join(", ") + ")", params: [...accepted] };
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
    const name = nameMatch(args.name);
    if (name) {
      clauses.push(name.sql);
      params.push(...name.params);
    }
  }
  if (args.eu_buerger !== undefined) {
    const citizenship = citizenshipMatch(args.eu_buerger);
    clauses.push(citizenship.sql);
    params.push(...citizenship.params);
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
    const position = positionMatch("w.kri_pozicija", String(term));
    clauses.push("EXISTS (SELECT 1 FROM idk_kandidat_radno_iskustvo w WHERE w.kri_kandidat_id = k.kandidat_id AND " + position.sql + ")");
    params.push(...position.params);
  }
  if (args.sprache || args.niveau) {
    const column = args.fertigkeit === "lesen" ? "kj_citanje" : args.fertigkeit === "schreiben" ? "kj_pisanje" : "kj_slusanje";
    const level = levelMatch("j." + column, args.niveau);
    if (args.sprache) {
      const spoken = languageNames(args.sprache);
      const exists = spoken.names.map((spokenName) => {
        const spellings = storedSpellings(spokenName);
        const nameSql = "(" + spellings.map(() => accentEquals("TRIM(j.kj_naziv)")).join(" OR ") + ")";
        const pieces = ["j.kj_kandidatid = k.kandidat_id", nameSql];
        if (level) pieces.push(level.sql);
        return "EXISTS (SELECT 1 FROM idk_kandidat_jezici j WHERE " + pieces.join(" AND ") + ")";
      });
      clauses.push(spoken.mode === "or" ? "(" + exists.join(" OR ") + ")" : exists.join(" AND "));
      for (const spokenName of spoken.names) params.push(...storedSpellings(spokenName), ...(level?.params ?? []));
    } else if (level) {
      clauses.push("EXISTS (SELECT 1 FROM idk_kandidat_jezici j WHERE j.kj_kandidatid = k.kandidat_id AND " + level.sql + ")");
      params.push(...level.params);
    }
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
  const positions = args.begriffe.map((term) => positionMatch("w.kri_pozicija", term));
  const like = positions.map((item) => item.sql).join(" OR ");
  const likeParams = positions.flatMap((item) => item.params);
  const archive = args.archived ? "" : " AND k.kandidat_status <> 3";
  const spoken = args.sprache?.trim() ? languageNames(args.sprache) : null;
  const languageName = spoken && spoken.names.length === 1 ? spoken.names[0] : "";
  const extra = spoken && spoken.names.length > 1
    ? spoken.names.map(() => " AND EXISTS (SELECT 1 FROM idk_kandidat_jezici jx WHERE jx.kj_kandidatid = k.kandidat_id AND " + accentEquals("TRIM(jx.kj_naziv)") + ")").join("")
    : "";
  const extraParams = spoken && spoken.names.length > 1 ? spoken.names : [];
  return {
    countSql: "SELECT COUNT(DISTINCT k.kandidat_id) AS n FROM idk_kandidati k WHERE EXISTS (SELECT 1 FROM idk_kandidat_radno_iskustvo w WHERE w.kri_kandidat_id = k.kandidat_id AND (" + like + "))" + extra + archive,
    countParams: likeParams.concat(extraParams),
    positionSql: "SELECT w.kri_pozicija AS position, COUNT(DISTINCT w.kri_kandidat_id) AS kandidaten FROM idk_kandidat_radno_iskustvo w JOIN idk_kandidati k ON k.kandidat_id = w.kri_kandidat_id WHERE (" + like + ")" + extra + archive + " GROUP BY w.kri_pozicija ORDER BY kandidaten DESC LIMIT " + top,
    positionParams: likeParams.concat(extraParams),
    languageSql: languageName
      ? "SELECT j.kj_slusanje AS zuhoeren, COUNT(DISTINCT k.kandidat_id) AS kandidaten FROM idk_kandidati k JOIN idk_kandidat_radno_iskustvo w ON w.kri_kandidat_id = k.kandidat_id JOIN idk_kandidat_jezici j ON j.kj_kandidatid = k.kandidat_id WHERE (" + like + ") AND " + accentEquals("TRIM(j.kj_naziv)") + archive + " GROUP BY j.kj_slusanje"
      : null,
    languageParams: languageName ? likeParams.concat(languageName) : null,
  };
}

export function buildResolveBeruf(args: { begriff?: string; archived?: boolean; limit?: number }) {
  const term = args.begriff?.trim() ?? "";
  if (!term) throw new Error("Ein Berufsbegriff ist noetig.");
  const requested = args.limit ?? 15;
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error("Die Variantenliste ist zu gross.");
  const top = Math.min(requested, 50);
  const archive = args.archived ? "" : " AND k.kandidat_status <> 3";
  const position = positionMatch("w.kri_pozicija", term);
  return {
    sql: "SELECT w.kri_pozicija AS position, COUNT(DISTINCT k.kandidat_id) AS kandidaten FROM idk_kandidat_radno_iskustvo w JOIN idk_kandidati k ON k.kandidat_id = w.kri_kandidat_id WHERE " + position.sql + archive + " GROUP BY w.kri_pozicija ORDER BY kandidaten DESC LIMIT " + top,
    params: position.params,
  };
}
