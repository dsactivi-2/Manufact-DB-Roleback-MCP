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
const { buildOrderSearch } = await import("../src/sql.ts");
const settings = { CRM_WORKER_BASE_URL: "https://gateway.example.com", CRM_WORKER_SERVICE_TOKEN: "a".repeat(48) };
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
test("MCP crm_stats prolazi kroz gateway bez direktnog DB pristupa", async () => {
  const { createCloudCrmServer } = await import("../index.ts");
  const { handleRequest } = await import("../cloudflare/worker/src/index.ts");
  const originalFetch = globalThis.fetch;
  let gatewayCalls = 0;
  globalThis.fetch = (async (url, init) => {
    gatewayCalls++;
    assert.equal(String(url), "https://gateway.example.com/v1/read/stats");
    return handleRequest(new Request(url, init), {
      MCP_SERVICE_TOKEN: settings.CRM_WORKER_SERVICE_TOKEN, ENVIRONMENT: "production",
      EXPECTED_DATABASE: "jsicrm", WRITES_ENABLED: "false", RESTORES_ENABLED: "false",
      HYPERDRIVE_FRESH: { host: "fake", port: 3306, user: "fake", password: "fake", database: "jsicrm" },
    }, async () => ({
      async query() { return [{ kandidaten: 4, aktiv: 3, firmen: 2, auftraege: 1 }]; },
      async close() {},
    }));
  }) as typeof fetch;
  try {
    const server = createCloudCrmServer({ ...settings, CRM_TRANSPORT: "cloudflare", CRM_MCP_SERVER_TOKEN: "test-token" });
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
    const body = await callResponse.text();
    const messageText = body.startsWith("{") ? body : body.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    assert.ok(messageText);
    const message = JSON.parse(messageText);
    assert.equal(message.error, undefined);
    assert.equal(message.result.isError, undefined);
    assert.deepEqual(message.result.structuredContent, { kandidaten: 4, aktiv: 3, firmen: 2, auftraege: 1 });
    assert.equal(gatewayCalls, 1);
  } finally { globalThis.fetch = originalFetch; }
});
