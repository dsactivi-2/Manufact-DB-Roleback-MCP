import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js") && context.parentURL) {
    const tsUrl = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
    if (existsSync(fileURLToPath(tsUrl))) return nextResolve(tsUrl.href, context);
  }
  return nextResolve(specifier, context);
}});
const { createWorkerClient, validateWorkerSettings } = await import("../src/worker-client.ts");
const { exportPem } = await import("../src/identity.ts");
const { buildOrderSearch } = await import("../src/sql.ts");
const settings = { CRM_TRANSPORT: "cloudflare", CRM_WORKER_BASE_URL: "https://gateway.example.com", CRM_WORKER_SERVICE_TOKEN: "a".repeat(48) };
const mutationSettings = {
  ...settings,
  CRM_MCP_SERVER_TOKEN: "test-token",
  CRM_MUTATION_TOOLS_ENABLED: "true",
  CRM_MUTATION_POLICY_VERSION: "test-policy-v1",
  CRM_IDENTITY_ASSERTION_PRIVATE_KEY: "test-private-key",
  OAUTH_ISSUER: "https://login.example.com/",
  OAUTH_AUTHORIZATION_ENDPOINT: "https://login.example.com/authorize",
  OAUTH_TOKEN_ENDPOINT: "https://login.example.com/token",
  OAUTH_JWKS_URL: "https://login.example.com/jwks",
  OAUTH_RESOURCE: "https://mcp.example.com/mcp",
};

function rpcMessage(text: string) {
  const messageText = text.startsWith("{") ? text : text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  assert.ok(messageText);
  return JSON.parse(messageText);
}

async function rpc(server: { fetch(request: Request): Promise<Response> }, name: string, params: Record<string, unknown>, id = 1) {
  const headers = new Headers({
    authorization: "Bearer test-token", accept: "application/json, text/event-stream", "content-type": "application/json",
  });
  const initialized = await server.fetch(new Request("https://mcp.example.com/mcp", {
    method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mutation-test", version: "1" } } }),
  }));
  assert.equal(initialized.status, 200);
  const session = initialized.headers.get("mcp-session-id");
  if (session) headers.set("mcp-session-id", session);
  const response = await server.fetch(new Request("https://mcp.example.com/mcp", {
    method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: id + 1, method: name, params }),
  }));
  assert.equal(response.status, 200);
  return rpcMessage(await response.text());
}
test("Worker prevoz zahtijeva siguran origin i vlastiti token", () => {
  assert.throws(() => validateWorkerSettings({ ...settings, CRM_WORKER_BASE_URL: "http://gateway.example.com" }));
  assert.throws(() => validateWorkerSettings({ ...settings, CRM_WORKER_BASE_URL: "https://token@gateway.example.com" }));
  assert.throws(() => validateWorkerSettings({ ...settings, CRM_WORKER_BASE_URL: "https://gateway.example.com?token=a" }));
  assert.throws(() => validateWorkerSettings({ ...settings, CRM_WORKER_SERVICE_TOKEN: "" }));
});
test("Tipizirani MCP adapter salje radnju i filtere, bez DB tajni", async () => {
  const client = createWorkerClient(settings, (async (url, init) => {
    assert.equal(String(url), "https://gateway.example.com/v1/read/candidates");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer " + settings.CRM_WORKER_SERVICE_TOKEN);
    assert.deepEqual(JSON.parse(String(init?.body)), { count_only: true, position_text: "test" });
    assert.equal(init?.redirect, "error");
    return Response.json({ data: { count: 3 } });
  }) as typeof fetch);
  assert.deepEqual(await client.read("candidates", { count_only: true, position_text: "test" }), { count: 3 });
});
test("Nepoznata polja se odbijaju prije mreznog poziva", async () => {
  let calls = 0;
  const client = createWorkerClient(settings, (async () => { calls++; return Response.json({ data: {} }); }) as typeof fetch);
  await assert.rejects(client.read("stats", { actor_id: "untrusted" }));
  assert.equal(calls, 0);
});
test("Greska gatewaya ne prenosi njegove privatne detalje", async () => {
  const client = createWorkerClient(settings, (async () => Response.json({
    error: { code: "DEPENDENCY_UNAVAILABLE", message: "password=private" },
  }, { status: 503 })) as typeof fetch);
  await assert.rejects(client.read("stats", {}), (error: Error) => {
    assert.equal(error.message, "DEPENDENCY_UNAVAILABLE"); return true;
  });
});
test("Nalozi koriste stvarnu kolonu uz postojeci naziv izlaza", () => {
  const plan = buildOrderSearch({ q: "test" });
  assert.match(plan.rowSql, /nalog_naziv AS nalog_naslov/);
  assert.match(plan.countSql, /nalog_naziv LIKE/);
});
test("Mutation adapter salje tipiziran i potpisan preview zahtjev Workeru", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const privatePem = await exportPem(pair.privateKey, "pkcs8");
  const client = createWorkerClient({ ...settings, CRM_IDENTITY_ASSERTION_PRIVATE_KEY: privatePem }, (async (url, init) => {
    assert.equal(String(url), "https://gateway.example.com/v1/changes/preview");
    assert.ok(new Headers(init?.headers).get("x-crm-identity"));
    assert.deepEqual(JSON.parse(String(init?.body)), {
      entity_type: "synthetic_candidate", entity_id: "TEST-1", expected_revision: "0",
      patch: { telephone: "+49-1" }, reason: "Kontrollierter Test", idempotency_key: "preview-test-0001",
    });
    return Response.json({ ok: true, result: { entity_revision: "0", preview_sha256: "f".repeat(64), fields: [] } });
  }) as typeof fetch);
  const response = await client.post("/v1/changes/preview", {
    entity_type: "synthetic_candidate", entity_id: "TEST-1", expected_revision: "0",
    patch: { telephone: "+49-1" }, reason: "Kontrollierter Test", idempotency_key: "preview-test-0001",
  }, { issuer: "manufact-db-rollback-mcp", subject: "preview-user", scopes: ["crm:read", "crm:write"] });
  assert.deepEqual(response, { entity_revision: "0", preview_sha256: "f".repeat(64), fields: [] });
});
test("MCP crm_stats prolazi kroz gateway bez direktnog DB pristupa", async () => {
  const { createManufactDbRollbackServer } = await import("../index.ts");
  const { handleWorker } = await import("../src/worker/http.ts");
  const originalFetch = globalThis.fetch;
  let gatewayCalls = 0;
  globalThis.fetch = (async (url, init) => {
    gatewayCalls++;
    assert.equal(String(url), "https://gateway.example.com/v1/read/stats");
    return handleWorker(new Request(url, init), {
      MCP_SERVICE_TOKEN: settings.CRM_WORKER_SERVICE_TOKEN, ENVIRONMENT: "production",
      WRITES_ENABLED: "false", RESTORES_ENABLED: "false",
      HYPERDRIVE_FRESH: { host: "fake", port: 3306, user: "fake", password: "fake", database: "jsicrm" },
    }, { host: "fake", openSession: async () => ({
      async query(sql: string) {
        if (sql.includes("DATABASE()")) return { rows: [{ selected_database: "jsicrm" }], affectedRows: 1 };
        return { rows: [{ kandidaten: 4, aktiv: 3, firmen: 2, auftraege: 1 }], affectedRows: 1 };
      },
      async release() {},
    }) });
  }) as typeof fetch;
  try {
    const server = createManufactDbRollbackServer({ ...settings, CRM_TRANSPORT: "cloudflare", CRM_MCP_SERVER_TOKEN: "test-token" });
    const headers = new Headers({
      authorization: "Bearer test-token", accept: "application/json, text/event-stream", "content-type": "application/json",
    });
    const initResponse = await server.fetch(new Request("https://mcp.example.com/mcp", {
      method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "gateway-test", version: "1" } } }),
    }));
    assert.equal(initResponse.status, 200);
    const session = initResponse.headers.get("mcp-session-id");
    if (session) headers.set("mcp-session-id", session);
    const callResponse = await server.fetch(new Request("https://mcp.example.com/mcp", {
      method: "POST", headers, body: JSON.stringify({
        jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "crm_stats", arguments: {} },
      }),
    }));
    assert.equal(callResponse.status, 200);
    const message = rpcMessage(await callResponse.text());
    assert.equal(message.result?.isError, undefined);
    const data = JSON.parse(message.result.content[0].text) as Record<string, unknown>;
    assert.equal(data.kandidaten, 4);
    assert.equal(data.aktiv, 3);
    assert.equal(Object.hasOwn(data, "firmen"), false);
    assert.equal(Object.hasOwn(data, "auftraege"), false);
    assert.equal(gatewayCalls, 1);
  } finally { globalThis.fetch = originalFetch; }
});
test("MCP mutation alati su skriveni po defaultu i kompletni uz opt-in", async () => {
  const { createManufactDbRollbackServer } = await import("../index.ts");
  const disabled = await rpc(createManufactDbRollbackServer({ ...settings, CRM_MCP_SERVER_TOKEN: "test-token" }), "tools/list", {});
  const disabledNames = disabled.result.tools.map((tool: { name: string }) => tool.name);
  assert.equal(disabledNames.some((name: string) => name.startsWith("crm_change_") || name.startsWith("crm_restore_") || name === "crm_history_list"), false);

  const enabled = await rpc(createManufactDbRollbackServer(mutationSettings), "tools/list", {}, 10);
  const enabledNames = enabled.result.tools.map((tool: { name: string }) => tool.name);
  for (const name of ["crm_history_list", "crm_change_preview", "crm_change_apply", "crm_restore_preview", "crm_restore_apply", "crm_write_request_approval", "crm_write_approval_list", "crm_write_decide"]) {
    assert.ok(enabledNames.includes(name), name);
  }
  const cacheDelete = disabled.result.tools.find((tool: { name: string }) => tool.name === "crm_filter_cache_obrisi");
  assert.equal(cacheDelete.annotations.readOnlyHint, false);
});

test("MCP read granice odgovaraju zajednickom ugovoru", async () => {
  const { createManufactDbRollbackServer } = await import("../index.ts");
  const server = createManufactDbRollbackServer({ ...settings, CRM_MCP_SERVER_TOKEN: "test-token" });
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { calls++; return Response.json({ data: {} }); }) as typeof fetch;
  try {
    const longName = await rpc(server, "tools/call", { name: "crm_search_kandidaten", arguments: { name: "a".repeat(501) } }, 20);
    assert.equal(longName.result?.isError, true);
    const tooMany = await rpc(server, "tools/call", { name: "crm_beruf_report", arguments: { begriffe: Array.from({ length: 31 }, () => "fahrer") } }, 30);
    assert.equal(tooMany.error !== undefined || tooMany.result?.isError === true, true);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});
