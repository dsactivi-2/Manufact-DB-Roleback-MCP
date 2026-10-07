import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const runtimeUrl = new URL("../.gateway-runtime.local.json", import.meta.url);
const runtime = JSON.parse(fs.readFileSync(runtimeUrl, "utf8"));
const pem = (label, bytes) => `-----BEGIN ${label}-----\n${Buffer.from(bytes).toString("base64").match(/.{1,64}/g).join("\n")}\n-----END ${label}-----\n`;
if (!runtime.identityPrivateKey || !runtime.identityPublicKey) {
  const pair = await crypto.webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  runtime.identityPrivateKey = pem("PRIVATE KEY", await crypto.webcrypto.subtle.exportKey("pkcs8", pair.privateKey));
  runtime.identityPublicKey = pem("PUBLIC KEY", await crypto.webcrypto.subtle.exportKey("spki", pair.publicKey));
  fs.writeFileSync(runtimeUrl, JSON.stringify(runtime, null, 2));
}
const wrangler = fileURLToPath(new URL("../cloudflare/worker/node_modules/wrangler/bin/wrangler.js", import.meta.url));
const worker = spawnSync(process.execPath, [wrangler, "secret", "put", "IDENTITY_ASSERTION_PUBLIC_KEY"], {
  cwd: new URL("../cloudflare/worker/", import.meta.url), input: runtime.identityPublicKey, encoding: "utf8",
});
if (worker.status !== 0) throw new Error("WORKER_PUBLIC_KEY_CONFIGURATION_FAILED");
const mcp = fileURLToPath(new URL("../node_modules/mcp-use/dist/bin.js", import.meta.url));
const hosted = spawnSync(process.execPath, [mcp, "servers", "env", "set", "77a6298d-34e9-4d70-9454-d47c8d300361",
  "CRM_IDENTITY_ASSERTION_PRIVATE_KEY=" + runtime.identityPrivateKey, "--secret", "--json"], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
if (hosted.status !== 0) throw new Error("MCP_PRIVATE_KEY_CONFIGURATION_FAILED");
console.log(JSON.stringify({ identityKeyPair: "configured", workerSecret: true, mcpSecret: true }));
