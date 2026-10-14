import { MCPServer } from "mcp-use";
import { z } from "zod";
import { mutationSchemas } from "./contracts/mutations.js";
import { assertMcpMutationConfiguration } from "./src/config.js";
import { createOAuthProvider } from "./src/auth.js";
import { actorFromOAuth, actorFromSharedToken, type Actor } from "./src/identity.js";
import { isCrmAdmin, statsVisibleTo } from "./src/permissions.js";
import { createWorkerClient } from "./src/worker-client.js";
import { openDatabase } from "./src/db.js";
import { assertSeparateInfrastructure } from "./src/guard.js";
import { GUIDE_JSON_URI, GUIDE_MARKDOWN_URI, readGuide } from "./src/guides.js";
import { publicEntityPolicies } from "./src/registry.js";
import {
  runBerufReport,
  runCandidateSearch,
  runCompanySearch,
  runDescribeTable,
  runListTables,
  runOrderSearch,
  runProfile,
  runResolveBeruf,
  runStats,
  type Db,
} from "./src/read.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const mutating = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
let database: Db | null = null;
let databaseEnv: NodeJS.ProcessEnv = process.env;

export function setDatabase(next: Db | null): void {
  database = next;
}


type AuthCtx = { auth?: { user?: { id?: string }; payload?: Record<string, unknown>; scopes?: string[]; permissions?: string[] } };

function actorFor(ctx?: AuthCtx): Actor {
  if (ctx?.auth) return actorFromOAuth(ctx.auth);
  return actorFromSharedToken();
}

function assertAdmin(ctx: AuthCtx | undefined): void {
  if (!isCrmAdmin(actorFor(ctx))) throw new Error("Lesen ist fuer diese Rolle nicht erlaubt.");
}

function cloudflareTransport(): boolean {
  return (databaseEnv.CRM_TRANSPORT ?? "").trim() === "cloudflare";
}

async function performRead(ctx: AuthCtx | undefined, path: string, args: unknown, direct: () => Promise<unknown>) {
  assertAdmin(ctx);
  if (!cloudflareTransport()) return direct();
  return createWorkerClient(databaseEnv).post(path, args, actorFor(ctx));
}

async function performWrite(ctx: AuthCtx | undefined, path: string, args: unknown) {
  assertAdmin(ctx);
  return createWorkerClient(databaseEnv).post(path, args, actorFor(ctx));
}

function db(): Db {
  if (!database) {
    if (!databaseEnv.CRM_DATABASE_URL) throw new Error("CRM_DATABASE_URL fehlt. Ein neuer, eigener Datenbankanschluss ist noch nicht gesetzt.");
    database = openDatabase(databaseEnv);
  }
  return database;
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data };
}

export function createCloudCrmServer(env: NodeJS.ProcessEnv = process.env) {
  assertSeparateInfrastructure(env);
  assertMcpMutationConfiguration(env);
  databaseEnv = env;
  database = null;
  if (env.CRM_TRANSPORT && !["direct", "cloudflare"].includes(env.CRM_TRANSPORT)) throw new Error("Nepoznat CRM_TRANSPORT.");
  const oauth = createOAuthProvider(env);
  const config = {
    name: "cloud-crm-mcp",
    title: "Cloud CRM MCP",
    version: "0.1.0",
    description: "CRM MCP server for search and approved changes on separate infrastructure.",
    skills: true,
  } as const;
  const server = oauth ? new MCPServer({ ...config, oauth }) : new MCPServer(config);


server.app.use("/mcp", async (c, next) => {
    if (c.req.query("token")) return c.json({ error: "Token in der URL ist verboten." }, 401);
    if (!oauth) {
      const expected = env.CRM_MCP_SERVER_TOKEN ?? "";
      if (!expected) return c.json({ error: "CRM_MCP_SERVER_TOKEN fehlt." }, 503);
      if (c.req.header("authorization") !== "Bearer " + expected) return c.json({ error: "Nicht angemeldet." }, 401);
    }
    await next();
  });

  if (oauth) {
    server.app.use("*", async (c, next) => {
      if (c.req.path !== "/.well-known/oauth-protected-resource") return next();
      const url = new URL(c.req.url);
      url.pathname = "/.well-known/oauth-protected-resource/mcp";
      return server.fetch(new Request(url, c.req.raw));
    });
  }

  server.tool({
  name: "crm_search_kandidaten",
  title: "Kandidaten suchen",
  description: "Kandidaten nur mit den Filtern suchen, die der Nutzer genannt hat. Ein Vor- und Nachname allein ist eine reine Namenssuche: Beruf, Sprache, Alter und EU-Status nicht hinzufuegen. name nimmt Vorname, Nachname oder beides; jedes Wort muss in Vorname oder Nachname vorkommen, Grossschreibung und Diakritika sind egal. position_text sucht in der Berufserfahrung und versteht dieselbe Taetigkeit unter einem gebraeuchlichen Namen, zum Beispiel vozac/Fahrer/driver, elektricar/Elektriker, konobar/Kellner. Keine verwandten Berufe ergaenzen. alter_von und alter_bis sind inklusive vollendete Jahre von 0 bis 150; ohne Geburtsdatum kein Treffer. sprache akzeptiert den gespeicherten oder gesprochenen Namen, zum Beispiel Njemački, njemacki, Deutsch oder German, ebenso Engleski/English. niveau ist ein Mindestniveau. Mehrere gesetzte Filter gelten zusammen. Archivstatus 3 bleibt ausgeschlossen, bis archived=true. Hoechstens 50 Zeilen. Geburtsdatum wird nicht ausgegeben.",
  inputSchema: z.object({
    name: z.string().min(1).describe("Nur setzen, wenn der Nutzer einen Namen nennt. Vorname, Nachname oder beides. Jedes Wort muss in Vorname oder Nachname vorkommen.").optional(),
    eu_buerger: z.boolean().describe("true: Staatsbuergerschaftstyp beginnt mit EU. false: Typ beginnt nicht mit EU oder ist NULL/leer. Ohne Wert kein EU-Filter.").optional(),
    alter_von: z.number().int().min(0).max(150).describe("Inklusive untere Altersgrenze in vollendeten Jahren, 0 bis 150.").optional(),
    alter_bis: z.number().int().min(0).max(150).describe("Inklusive obere Altersgrenze in vollendeten Jahren, 0 bis 150; muss groesser oder gleich alter_von sein.").optional(),
    position_text: z.string().min(1).describe("Nur setzen, wenn der Nutzer einen Beruf nennt. Gespeicherte Position, auch ohne Diakritika oder unter dem gebraeuchlichen Namen derselben Taetigkeit.").optional(),
    sprache: z.string().min(1).describe("Nur setzen, wenn der Nutzer eine Sprache nennt. Njemački, njemacki, Deutsch, German, Engleski oder English und die anderen gespeicherten Sprachen.").optional(),
    niveau: z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "BEZ ZNANJA"]).describe("Mindestniveau A1-C2. BEZ ZNANJA trifft auch Bez znanja, Bezznanja und Bez poznavanja, nicht leere Werte.").optional(),
    fertigkeit: z.enum(["zuhoeren", "lesen", "schreiben"]).optional(),
    archived: z.boolean().describe("Standard false/ausgelassen: Kandidaten mit Status 3 werden ausgeschlossen. true: archivierte Kandidaten werden nicht aufgrund von Status 3 ausgeschlossen.").optional(),
    page_size: z.number().int().min(1).max(50).optional(),
    cursor: z.string().regex(/^[0-9]+$/).optional(),
    count_only: z.boolean().optional(),
  }).strict(),
  annotations: readOnly,
}, async (args, ctx) => ok(await performRead(ctx, "/v1/read/candidates", args, () => runCandidateSearch(db(), args))));

server.tool({
  name: "crm_search_companies",
  title: "Firmen suchen",
  description: "Firmen nach Name, Land oder numerischem CRM-Status suchen. q sucht im Firmennamen, country vergleicht das gespeicherte Land exakt. Der numerische company_status hat in diesem Server noch keine verifizierte fachliche Werteliste; status daher nur verwenden, wenn der konkrete CRM-Statuswert bereits aus dem Nutzerkontext stammt. 50 Zeilen pro Seite.",
  inputSchema: z.object({ q: z.string().optional(), country: z.string().optional(), status: z.number().int().describe("Exakter numerischer company_status aus dem CRM. Keine Statusnummer raten; nur verwenden, wenn der Wert explizit bekannt ist.").optional(), page_size: z.number().int().min(1).max(50).optional(), cursor: z.string().regex(/^[0-9]+$/).optional() }).strict(),
  annotations: readOnly,
}, async (args, ctx) => ok(await performRead(ctx, "/v1/read/companies", args, () => runCompanySearch(db(), args))));

server.tool({
  name: "crm_search_nalozi",
  title: "Aufträge suchen",
  description: "Aufträge nach Freitext oder numerischem CRM-Status suchen. q sucht in Titel und Beschreibung. Der numerische nalog_status hat in diesem Server noch keine verifizierte fachliche Werteliste; status daher nur verwenden, wenn der konkrete CRM-Statuswert bereits aus dem Nutzerkontext stammt.",
  inputSchema: z.object({ q: z.string().optional(), status: z.number().int().describe("Exakter numerischer nalog_status aus dem CRM. Keine Statusnummer raten; nur verwenden, wenn der Wert explizit bekannt ist.").optional(), page_size: z.number().int().min(1).max(50).optional(), cursor: z.string().regex(/^[0-9]+$/).optional() }).strict(),
  annotations: readOnly,
}, async (args, ctx) => ok(await performRead(ctx, "/v1/read/orders", args, () => runOrderSearch(db(), args))));

server.tool({
  name: "crm_beruf_report",
  title: "Berufsreport",
  description: "Berufsreport fuer eine oder mehrere vom Nutzer genannte Berufs- oder Positionsbezeichnungen. Verwenden, wenn eine aggregierte Auswertung statt einer Kandidatenliste gewuenscht ist. Liefert die Anzahl unterschiedlicher passender Kandidaten, Treffer je Suchbegriff und die haeufigsten gespeicherten Positionstexte; eine Sprachverteilung wird nur berechnet, wenn sprache angegeben ist. Archivierte Kandidaten bleiben standardmaessig ausgeschlossen.",
  inputSchema: z.object({ begriffe: z.array(z.string().min(1)).min(1).describe("Vom Nutzer gemeinte Berufs- oder Positionsbegriffe, z. B. Elektriker. Jeder Eintrag bildet eine eigene Treffergruppe."), archived: z.boolean().optional(), sprache: z.string().optional(), top_positionen: z.number().int().min(1).max(50).describe("Maximale Anzahl der haeufigsten passenden Positionstexte im Report; Standard 15, Maximum 50.").optional() }).strict(),
  annotations: readOnly,
}, async (args, ctx) => ok(await performRead(ctx, "/v1/read/professions", args, () => runBerufReport(db(), args))));

server.tool({
  name: "crm_resolve_beruf",
  title: "Berufsbezeichnungen auflösen",
  description: "Berufsvarianten anzeigen. Startet selbst keine Kandidatensuche.",
  inputSchema: z.object({ begriff: z.string().min(1), archived: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() }).strict(),
  annotations: readOnly,
}, async (args, ctx) => ok(await performRead(ctx, "/v1/read/resolve_profession", args, () => runResolveBeruf(db(), args))));

server.tool({
  name: "crm_kandidat_profile",
  title: "Kandidatenprofil",
  description: "Detailprofil fuer genau einen bereits identifizierten Kandidaten. Verwenden, wenn der Nutzer Details zu einer konkreten kandidat_id verlangt, nicht fuer Suche oder Listen. Liefert die freigegebenen Profildaten des Kandidaten einschliesslich Basisdaten sowie zugeordneter beruflicher, Sprach- und Ausbildungsinformationen, soweit im CRM vorhanden; nicht benoetigte Kontakt- oder interne Daten werden nicht fuer eine allgemeine Suche geladen.",
  inputSchema: z.object({ kandidat_id: z.number().int().positive().describe("Positive interne Kandidaten-ID aus einem vorherigen CRM-Suchergebnis oder einer vom Nutzer eindeutig angegebenen Kandidaten-ID.") }).strict(),
  annotations: readOnly,
}, async (args, ctx) => ok(await performRead(ctx, "/v1/read/profile", args, () => runProfile(db(), args.kandidat_id))));

server.tool({
  name: "crm_stats",
  title: "CRM-Statistik",
  description: "CRM-weite Uebersichtsstatistik fuer Nutzerfragen nach Gesamtzahlen. Liefert Kandidatenzahlen fuer jede Lesrolle. Firmen- und Auftragszahlen nur fuer eine Admin-Rolle. Nicht auf eine 50-Zeilen-Suchseite begrenzt. Nicht verwenden, wenn der Nutzer einzelne Datensaetze, gefilterte Kandidaten oder ein Kandidatenprofil verlangt.",
  inputSchema: z.object({}).strict(),
  annotations: readOnly,
}, async (_args, ctx) => ok(statsVisibleTo(actorFor(ctx), await performRead(ctx, "/v1/read/stats", {}, () => runStats(db())) as Record<string, unknown>)));

server.tool({
  name: "crm_list_tables",
  title: "Erlaubte Tabellen",
  description: "Erlaubte Tabellen auflisten.",
  inputSchema: z.object({ search: z.string().optional() }).strict(),
  annotations: readOnly,
}, async (args, ctx) => ok(await performRead(ctx, "/v1/read/tables", args, () => runListTables(db(), args.search))));

server.tool({
  name: "crm_describe_table",
  title: "Tabelle beschreiben",
  description: "Spalten einer erlaubten Tabelle.",
  inputSchema: z.object({ table: z.string() }).strict(),
  annotations: readOnly,
}, async (args, ctx) => ok(await performRead(ctx, "/v1/read/describe", args, () => runDescribeTable(db(), args.table))));


server.tool({
  name: "crm_entity_policy_list",
  title: "CRM-Entitaeten und Rechte anzeigen",
  description: "Zeigt alle fachlichen CRM-Entitaeten mit READ, WRITE oder APPROVE_WRITE, erlaubten Operationen und freigegebenen Feldern.",
  inputSchema: z.object({}).strict(),
  annotations: readOnly,
}, async (_args, ctx) => { assertAdmin(ctx); return ok({ default_write_access: "approve_write", entities: publicEntityPolicies() }); });

server.tool({
  name: "crm_search_guide",
  title: "CRM-Suchleitfaden",
  description: "Regeln fuer die lesenden Werkzeuge, ohne Geheimnisse.",
  inputSchema: z.object({}).strict(),
  annotations: readOnly,
}, async (_args, ctx) => { assertAdmin(ctx); return ok({
  seite: 50,
  zaehlung: "vollstaendig",
  geburtsdatum: false,
  eu_buerger: "false zaehlt leere Staatsangehoerigkeit mit",
  verboten: ["SELECT *", "Token in der URL", "alte Worker-Infrastruktur", "Geschlecht", "Religion", "Gesundheit", "Herkunft"],
  ressourcen: {
    json: GUIDE_JSON_URI,
    markdown: GUIDE_MARKDOWN_URI,
  },
  skill: "skill://crm-kandidatensuche/SKILL.md",
}); });

server.resource({
  name: "crm_search_guide_json",
  uri: GUIDE_JSON_URI,
  title: "CRM-Suchregeln",
  description: "Strukturierte Regeln fuer Cloud CRM MCP, Version 1.4.0.",
  mimeType: "application/json",
}, (uri) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: readGuide("json") }],
}));

server.resource({
  name: "crm_search_guide_markdown",
  uri: GUIDE_MARKDOWN_URI,
  title: "CRM-Suchleitfaden",
  description: "Lesbarer Leitfaden fuer Cloud CRM MCP, Version 1.4.0.",
  mimeType: "text/markdown",
}, (uri) => ({
  contents: [{ uri: uri.href, mimeType: "text/markdown", text: readGuide("markdown") }],
}));


  if (env.CRM_MUTATION_TOOLS_ENABLED === "true") {
    server.tool({
      name: "crm_history_list",
      title: "Aenderungsverlauf anzeigen",
      description: "Bis zu 50 versionierte Aenderungs- und Wiederherstellungsereignisse fuer genau einen Datensatz anzeigen.",
      inputSchema: mutationSchemas.history,
      annotations: readOnly,
    }, async (args, ctx) => ok(await performWrite(ctx, "/v1/history/list", args)));

    server.tool({
      name: "crm_change_preview",
      title: "CRM-Aenderung pruefen",
      description: "Eine Aenderung ohne dauerhaften Schreibvorgang pruefen. Liefert aktuelle Revision, Vorher-/Nachher-Werte und einen Hash fuer die externe Freigabe.",
      inputSchema: mutationSchemas.changePreview,
      annotations: readOnly,
    }, async (args, ctx) => ok(await performWrite(ctx, "/v1/changes/preview", args)));

    server.tool({
      name: "crm_change_apply",
      title: "Freigegebene CRM-Aenderung anwenden",
      description: "Eine zuvor gepruefte und extern freigegebene Aenderung atomar anwenden. Benoetigt Schreibrolle, passende Revision, einmalige Freigabe und Idempotenzschluessel.",
      inputSchema: mutationSchemas.changeApply,
      annotations: mutating,
    }, async (args, ctx) => ok(await performWrite(ctx, "/v1/changes/apply", args)));

    server.tool({
      name: "crm_restore_preview",
      title: "Selektive Wiederherstellung pruefen",
      description: "Aus einem History-Ereignis nur die angegebenen Felder zur Wiederherstellung vorbereiten, ohne dauerhaft zu schreiben.",
      inputSchema: mutationSchemas.restorePreview,
      annotations: readOnly,
    }, async (args, ctx) => ok(await performWrite(ctx, "/v1/restores/preview", args)));

    server.tool({
      name: "crm_restore_apply",
      title: "Freigegebene Wiederherstellung anwenden",
      description: "Eine zuvor gepruefte selektive Wiederherstellung als neues History-Ereignis atomar anwenden. Benoetigt Schreibrolle und externe Freigabe.",
      inputSchema: mutationSchemas.restoreApply,
      annotations: mutating,
    }, async (args, ctx) => ok(await performWrite(ctx, "/v1/restores/apply", args)));

    server.tool({
      name: "crm_write_request_approval",
      description: "Eine unveraenderte Schreib- oder Restore-Vorschau zur internen Freigabe einreichen.",
      inputSchema: mutationSchemas.approvalRequest,
      annotations: mutating,
    }, async (args, ctx) => ok(await performWrite(ctx, "/v1/approvals/request", args)));

    server.tool({
      name: "crm_write_approval_list",
      description: "Offene interne Freigaben fuer einen Entitaetstyp auflisten. Nur fuer CRM Approver.",
      inputSchema: mutationSchemas.approvalList,
      annotations: readOnly,
    }, async (args, ctx) => ok(await performWrite(ctx, "/v1/approvals/list", args)));

    server.tool({
      name: "crm_write_decide",
      description: "Eine offene interne Freigabe genehmigen oder ablehnen. Nur fuer CRM Approver.",
      inputSchema: mutationSchemas.approvalDecide,
      annotations: mutating,
    }, async (args, ctx) => ok(await performWrite(ctx, "/v1/approvals/decide", args)));
  }

  return server;
}

const server = createCloudCrmServer();
export default server;
