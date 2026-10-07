import { readSchemas, type ReadOperation } from "../contracts/read.js";
import { sha256 } from "./canonical.js";
import { actorFromSharedToken, signAssertion, WORKER_AUDIENCE, type Actor } from "./identity.js";

const MAX_RESPONSE = 2 * 1024 * 1024;
const READ_PATHS: Record<ReadOperation, string> = {
  candidates: "/v1/read/candidates", companies: "/v1/read/companies", orders: "/v1/read/orders",
  professions: "/v1/read/professions", resolve_profession: "/v1/read/resolve_profession",
  profile: "/v1/read/profile", stats: "/v1/read/stats", tables: "/v1/read/tables",
  describe: "/v1/read/describe", query: "/v1/read/query",
};

export function validateWorkerSettings(env: NodeJS.ProcessEnv) {
  const address = env.CRM_WORKER_BASE_URL;
  const token = env.CRM_WORKER_SERVICE_TOKEN;
  if (!address || !token || token.length < 32) throw new Error("Nedostaje Worker adresa ili servisni token.");
  const base = new URL(address);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new Error("Worker mora imati HTTPS origin bez putanje ili pristupnih podataka.");
  }
  return { base, token };
}

export function createWorkerClient(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch) {
  const { base, token } = validateWorkerSettings(env);
  const privateKey = env.CRM_IDENTITY_ASSERTION_PRIVATE_KEY ?? "";
  async function post(path: string, input: unknown, actor: Actor): Promise<unknown> {
    if (env.CRM_TRANSPORT !== "cloudflare") throw new Error("CRM_TRANSPORT=cloudflare nije aktivan.");
    if (!/^\/v1\/(read|changes|restores|history)\/[a-z_]+$/.test(path)) throw new Error("Nepoznata Worker ruta.");
    const raw = JSON.stringify(input ?? {});
    const headers: Record<string, string> = { authorization: "Bearer " + token, "content-type": "application/json" };
    if (privateKey) headers["x-crm-identity"] = await signAssertion(privateKey, { actor, audience: WORKER_AUDIENCE, requestSha256: sha256(raw) });
    else if (!path.startsWith("/v1/read/")) throw new Error("CRM_IDENTITY_ASSERTION_PRIVATE_KEY nedostaje.");
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, base), { method: "POST", redirect: "error", headers, body: raw, signal: AbortSignal.timeout(25_000) });
    } catch { throw new Error("DEPENDENCY_UNAVAILABLE"); }
    const text = await response.text();
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE || new TextEncoder().encode(text).length > MAX_RESPONSE) throw new Error("RESULT_TOO_LARGE");
    let payload: { ok?: boolean; result?: unknown; data?: unknown; error?: { code?: string } };
    try { payload = JSON.parse(text); } catch { throw new Error("INVALID_WORKER_RESPONSE"); }
    if (!response.ok || payload.ok === false) {
      const code = payload.error?.code;
      throw new Error(typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code) ? code : "DEPENDENCY_UNAVAILABLE");
    }
    if (Object.hasOwn(payload, "result")) return payload.result;
    if (Object.hasOwn(payload, "data")) return payload.data;
    throw new Error("INVALID_WORKER_RESPONSE");
  }
  return {
    async read(operation: ReadOperation, input: unknown, actor: Actor = actorFromSharedToken()) {
      return post(READ_PATHS[operation], readSchemas[operation].parse(input), actor);
    },
    post,
  };
}
