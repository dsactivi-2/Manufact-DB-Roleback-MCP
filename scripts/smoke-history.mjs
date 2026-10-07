import crypto from "node:crypto";
import fs from "node:fs";

const runtime = JSON.parse(fs.readFileSync(new URL("../.gateway-runtime.local.json", import.meta.url), "utf8"));
const base = "https://manufact-db-rollback.6f484zn9bd.workers.dev";
async function call(path, body) {
  const raw = JSON.stringify(body);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url");
  const claims = { iss: "manufact-db-rollback-mcp", aud: "manufact-db-rollback-worker", sub: "smoke-test",
    scope: "crm:read crm:write", iat: now, exp: now + 60, jti: crypto.randomUUID(),
    request_sha256: crypto.createHash("sha256").update(raw).digest("hex") };
  const unsigned = header + "." + Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.sign(null, Buffer.from(unsigned), crypto.createPrivateKey(runtime.identityPrivateKey)).toString("base64url");
  const response = await fetch(base + path, { method: "POST", headers: { authorization: "Bearer " + runtime.serviceToken,
    "content-type": "application/json", "x-crm-identity": unsigned + "." + signature }, body: raw });
  return { status: response.status, body: await response.json() };
}
const history = await call("/v1/history/list", { entity_type: "candidate", entity_id: "1" });
const blocked = await call("/v1/changes/apply", {});
console.log(JSON.stringify({ history: { status: history.status, count: history.body.result?.rows?.length },
  apply: { status: blocked.status, code: blocked.body.error?.code } }));
if (history.status !== 200 || blocked.status !== 403 || blocked.body.error?.code !== "WRITES_DISABLED") process.exitCode = 1;
