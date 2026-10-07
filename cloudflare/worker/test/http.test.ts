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
const { handleRequest } = await import("../src/index.ts");
const env = {
  MCP_SERVICE_TOKEN: "a".repeat(48), ENVIRONMENT: "production", EXPECTED_DATABASE: "jsicrm",
  WRITES_ENABLED: "false", RESTORES_ENABLED: "false",
  HYPERDRIVE_FRESH: { host: "test", port: 3306, user: "reader", password: "fake", database: "jsicrm" },
};
function request(operation: string, body: unknown = {}, auth = true) {
  return new Request("https://gateway.example.com/v1/read/" + operation, {
    method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: "Bearer " + env.MCP_SERVICE_TOKEN } : {}) },
    body: JSON.stringify(body),
  });
}
test("Neprijavljen poziv nikada ne otvara DB", async () => {
  let calls = 0;
  const response = await handleRequest(request("stats", {}, false), env, async () => {
    calls++; throw new Error("unexpected");
  });
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});
test("Nepoznat ulaz i slobodni SQL ne dolaze do baze", async () => {
  let calls = 0;
  const open = async () => { calls++; throw new Error("unexpected"); };
  assert.equal((await handleRequest(request("stats", { actor: "fake" }), env, open)).status, 400);
  assert.equal((await handleRequest(request("query", { sql: "SELECT kandidat_password FROM idk_kandidati" }), env, open)).status, 403);
  assert.equal(calls, 0);
});
test("Statistika izvrsava citanje i zatvara konekciju", async () => {
  let closed = 0;
  const response = await handleRequest(request("stats"), env, async () => ({
    async query(sql: string) { assert.match(sql, /^SELECT /); return [{ kandidaten: 4, aktiv: 3, firmen: 2, auftraege: 1 }]; },
    async close() { closed++; },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { kandidaten: 4, aktiv: 3, firmen: 2, auftraege: 1 } });
  assert.equal(closed, 1);
});
test("DB greska vraca siguran kod i zatvara konekciju", async () => {
  let closed = 0;
  const response = await handleRequest(request("stats"), env, async () => ({
    async query() { throw new Error("password=private candidate=test"); },
    async close() { closed++; },
  }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: "DEPENDENCY_UNAVAILABLE" } });
  assert.equal(closed, 1);
});
test("Preveliko tijelo odbijeno i bez content-length", async () => {
  let called = false;
  const response = await handleRequest(request("candidates", { name: "x".repeat(20000) }), env, async () => {
    called = true; throw new Error("unexpected");
  });
  assert.equal(response.status, 400);
  assert.equal(called, false);
});
test("Health ne tvrdi da su DB i rollback povezani", async () => {
  const response = await handleRequest(new Request("https://gateway.example.com/health"), env);
  assert.deepEqual(await response.json(), {
    status: "ok", service: "manufact-db-rollback", version: "0.1.0",
    writes_enabled: false, restores_enabled: false,
  });
});
