import { MCPServer } from "mcp-use";
import { z } from "zod";
import { createOAuthProvider } from "./src/auth.js";
import { actorFromOAuth, actorFromSharedToken, type Actor } from "./src/identity.js";
import { createWorkerClient } from "./src/worker-client.js";
import { openDatabase } from "./src/db.js";
import { assertSeparateInfrastructure } from "./src/guard.js";
import { GUIDE_JSON_URI, GUIDE_MARKDOWN_URI, readGuide } from "./src/guides.js";
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
let database: Db | null = null;
let databaseEnv: NodeJS.ProcessEnv = process.env;

export function setDatabase(next: Db | null): void {
  database = next;
}


type AuthCtx = { auth?: { user?: { id?: string }; payload?: Record<string, unknown>; scopes?: string[] } };

function actorFor(ctx?: AuthCtx): Actor {
  if (ctx?.auth) return actorFromOAuth(ctx.auth);
  return actorFromSharedToken();
}

function cloudflareTransport(): boolean {
  return (databaseEnv.CRM_TRANSPORT ?? "").trim() === "cloudflare";
}

async function performRead(ctx: AuthCtx | undefined, path: string, args: unknown, direct: () => Promise<unknown>) {
  if (!cloudflareTransport()) return direct();
  return createWorkerClient(databaseEnv).post(path, args, actorFor(ctx));
}

async function performWrite(ctx: AuthCtx | undefined, path: string, args: unknown) {
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
  databaseEnv = env;
  database = null;
  if (env.CRM_TRANSPORT && !["direct", "cloudflare"].includes(env.CRM_TRANSPORT)) throw new Error("Nepoznat CRM_TRANSPORT.");
  const oauth = createOAuthProvider(env);
  const config = {
    name: "cloud-crm-mcp",
    title: "Cloud CRM MCP",
    version: "0.1.0",
    description: "Read-only CRM MCP server on separate infrastructure.",
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
  description: "Kandidaten mit minimierten Suchfeldern lesen. Geburtsdatum wird nicht ausgegeben; Alter wird nur abgeleitet. Eine Seite hat 50 Zeilen.",
  inputSchema: z.object({
    name: z.string().optional(),
    eu_buerger: z.boolean().optional(),
    alter_von: z.number().int().optional(),
    alter_bis: z.number().int().optional(),
    position_text: z.string().optional(),
    sprache: z.string().optional(),
    niveau: z.string().optional(),
    fertigkeit: z.enum(["zuhoeren", "lesen", "schreiben"]).optional(),
    archived: z.boolean().optional(),
    page_size: z.number().int().min(1).max(50).optional(),
    cursor: z.string().regex(/^[0-9]+$/).optional(),
    count_only: z.boolean().optional(),
  }).strict(),
  annotations: readOnly,
}, async (args, ctx) => ok(await performRead(ctx, "/v1/read/candidates", args, () => runCandidateSearch(db(), args))));

server.tool({
  name: "crm_search_companies",
  title: "Firmen suchen",
  description: "Firmen lesen, 50 Zeilen pro Seite.",
  inputSchema: z.object({ q: z.string().optional(), country: z.string().optional(), status: z.number().int().optional(), page_size: z.number().int().min(1).max(50).optional(), cursor: z.string().regex(/^[0-9]+$/).optional() }).strict(),
  annotations: readOnly,
}, async (args, ctx) => ok(await performRead(ctx, "/v1/read/companies", args, () => runCompanySearch(db(), args))));

server.tool({
  name: "crm_search_nalozi",
  title: "Aufträge suchen",
  description: "Auftraege lesen, ohne SELECT *.",
  inputSchema: z.object({ q: z.string().optional(), status: z.number().int().optional(), page_size: z.number().int().min(1).max(50).optional(), cursor: z.string().regex(/^[0-9]+$/).optional() }).strict(),
  annotations: readOnly,
}, async (args, ctx) => ok(await performRead(ctx, "/v1/read/orders", args, () => runOrderSearch(db(), args))));

server.tool({
  name: "crm_beruf_report",
  title: "Berufsreport",
  description: "Berufsreport. Sprache nur wenn sie genannt wird.",
  inputSchema: z.object({ begriffe: z.array(z.string()).min(1), archived: z.boolean().optional(), sprache: z.string().optional(), top_positionen: z.number().int().min(1).max(50).optional() }).strict(),
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
  description: "Minimiertes Profil eines Kandidaten.",
  inputSchema: z.object({ kandidat_id: z.number().int().positive() }).strict(),
  annotations: readOnly,
}, async (args, ctx) => ok(await performRead(ctx, "/v1/read/profile", args, () => runProfile(db(), args.kandidat_id))));

server.tool({
  name: "crm_stats",
  title: "CRM-Statistik",
  description: "Gesamtzahlen, ohne Seitengrenze.",
  inputSchema: z.object({}).strict(),
  annotations: readOnly,
}, async (_args, ctx) => ok(await performRead(ctx, "/v1/read/stats", {}, () => runStats(db()))));

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
  name: "crm_search_guide",
  title: "CRM-Suchleitfaden",
  description: "Regeln fuer die lesenden Werkzeuge, ohne Geheimnisse.",
  inputSchema: z.object({}).strict(),
  annotations: readOnly,
}, async () => ok({
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
}));

server.resource({
  name: "crm_search_guide_json",
  uri: GUIDE_JSON_URI,
  title: "CRM-Suchregeln",
  description: "Strukturierte Regeln fuer Cloud CRM MCP, Version 1.2.0.",
  mimeType: "application/json",
}, (uri) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: readGuide("json") }],
}));

server.resource({
  name: "crm_search_guide_markdown",
  uri: GUIDE_MARKDOWN_URI,
  title: "CRM-Suchleitfaden",
  description: "Lesbarer Leitfaden fuer Cloud CRM MCP, Version 1.2.0.",
  mimeType: "text/markdown",
}, (uri) => ({
  contents: [{ uri: uri.href, mimeType: "text/markdown", text: readGuide("markdown") }],
}));


  const changing = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;
  const previewing = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
  const target = { entity_type: z.string().min(1).max(64), entity_id: z.string().min(1).max(191), expected_revision: z.string().regex(/^[0-9]+$/), reason: z.string().min(3).max(500) };
  server.tool({
    name: "crm_change_preview",
  title: "Änderung prüfen",
    description: "Zeigt eine Feldaenderung mit aktueller Revision. Schreibt nicht.",
    inputSchema: z.object({ ...target, patch: z.record(z.string(), z.string().nullable()), idempotency_key: z.string().min(8).max(128) }).strict(),
    annotations: previewing,
  }, async (args, ctx) => ok(await performWrite(ctx, "/v1/changes/preview", args)));
  server.tool({
    name: "crm_change_apply",
  title: "Änderung anwenden",
    description: "Wendet eine bereits freigegebene Feldaenderung ueber den Worker an und kann bestehende Werte ueberschreiben. Eine vorherige Freigabe ist erforderlich; das Tool kann selbst nichts genehmigen.",
    inputSchema: z.object({ ...target, patch: z.record(z.string(), z.string().nullable()), idempotency_key: z.string().min(8).max(128), approval_id: z.string().min(1) }).strict(),
    annotations: changing,
  }, async (args, ctx) => ok(await performWrite(ctx, "/v1/changes/apply", args)));
  server.tool({
    name: "crm_restore_preview",
  title: "Wiederherstellung prüfen",
    description: "Zeigt die Wiederherstellung ausgewaehlter Felder aus einem History-Ereignis. Schreibt nicht.",
    inputSchema: z.object({ ...target, source_event_id: z.string().min(1), fields: z.array(z.string()).min(1).max(20), idempotency_key: z.string().min(8).max(128) }).strict(),
    annotations: previewing,
  }, async (args, ctx) => ok(await performWrite(ctx, "/v1/restores/preview", args)));
  server.tool({
    name: "crm_restore_apply",
  title: "Wiederherstellung anwenden",
    description: "Stellt zuvor freigegebene Felder als neue protokollierte Aenderung wieder her und kann aktuelle Werte ueberschreiben. Eine vorherige Freigabe ist erforderlich.",
    inputSchema: z.object({ ...target, source_event_id: z.string().min(1), fields: z.array(z.string()).min(1).max(20), idempotency_key: z.string().min(8).max(128), approval_id: z.string().min(1) }).strict(),
    annotations: changing,
  }, async (args, ctx) => ok(await performWrite(ctx, "/v1/restores/apply", args)));
  server.tool({
    name: "crm_history_list",
  title: "Änderungshistorie",
    description: "Listet gespeicherte Feldaenderungen eines Datensatzes.",
    inputSchema: z.object({ entity_type: z.string().min(1).max(64), entity_id: z.string().min(1).max(191) }).strict(),
    annotations: readOnly,
  }, async (args, ctx) => ok(await performWrite(ctx, "/v1/history/list", args)));

  return server;
}

const server = createCloudCrmServer();
export default server;
