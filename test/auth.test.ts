import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js") && context.parentURL) {
      const tsUrl = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(tsUrl))) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

import assert from "node:assert/strict";
import test from "node:test";

const { createCloudCrmServer } = await import("../index.ts");

const legacyEnv = { CRM_MCP_SERVER_TOKEN: "test-token" };
const oauthEnv = {
  ...legacyEnv,
  OAUTH_ISSUER: "https://login.example.com/",
  OAUTH_AUTHORIZATION_ENDPOINT: "https://login.example.com/authorize",
  OAUTH_TOKEN_ENDPOINT: "https://login.example.com/token",
  OAUTH_JWKS_URL: "https://login.example.com/jwks",
  OAUTH_RESOURCE: "https://crm.example.com/mcp",
  OAUTH_AUDIENCE: "https://crm.example.com",
};

function mcp(path: string, init: RequestInit = {}) {
  return new Request("https://crm.example.com" + path, init);
}

test("ohne OAuth bleibt der gemeinsame Token die Anmeldung", async () => {
  const server = createCloudCrmServer(legacyEnv);
  const missing = await server.fetch(mcp("/mcp", { method: "POST" }));
  assert.equal(missing.status, 401);
  const discovery = await server.fetch(mcp("/.well-known/oauth-protected-resource"));
  assert.equal(discovery.status, 404);
  const urlToken = await server.fetch(mcp("/mcp?token=test-token", { method: "POST" }));
  assert.equal(urlToken.status, 401);
});

test("OAuth nennt den Anmeldewunsch und laesst den alten Token weiter", async () => {
  const server = createCloudCrmServer(oauthEnv);
  const missing = await server.fetch(mcp("/mcp", { method: "POST", headers: { accept: "application/json" } }));
  assert.equal(missing.status, 401);
  const challenge = missing.headers.get("www-authenticate") ?? "";
  assert.match(challenge, /resource_metadata=/);
  assert.match(challenge, /oauth-protected-resource\/mcp/);

  const root = await server.fetch(mcp("/.well-known/oauth-protected-resource"));
  assert.equal(root.status, 200);
  const metadata = await root.json() as { resource: string; authorization_servers: string[]; scopes_supported: string[] };
  assert.equal(metadata.resource, "https://crm.example.com/mcp");
  assert.deepEqual(metadata.authorization_servers, ["https://login.example.com/"]);
  assert.ok(metadata.scopes_supported.includes("sql:read"));

  const path = await server.fetch(mcp("/.well-known/oauth-protected-resource/mcp"));
  assert.equal(path.status, 200);

  const accepted = await server.fetch(mcp("/mcp", {
    method: "POST",
    headers: { authorization: "Bearer test-token", accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } }),
  }));
  assert.notEqual(accepted.status, 401);
});

test("halbes OAuth startet nicht", () => {
  assert.throws(() => createCloudCrmServer({ OAUTH_ISSUER: "https://login.example.com/" }), /OAUTH_AUTHORIZATION_ENDPOINT fehlt/);
});

test("WorkOS-Adresse schaltet die Anmeldung ohne einzelne Endpunkte ein", async () => {
  const server = createCloudCrmServer({
    CRM_MCP_SERVER_TOKEN: "test-token",
    MCP_USE_OAUTH_WORKOS_SUBDOMAIN: "balanced-lantern-65-staging.authkit.app",
    OAUTH_RESOURCE: "https://crm.example.com/mcp",
  });
  const root = await server.fetch(mcp("/.well-known/oauth-protected-resource"));
  assert.equal(root.status, 200);
  const metadata = await root.json() as { authorization_servers: string[] };
  assert.deepEqual(metadata.authorization_servers, ["https://balanced-lantern-65-staging.authkit.app"]);
});
