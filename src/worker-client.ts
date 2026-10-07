import { sha256 } from "./canonical.js";
import { signAssertion, WORKER_AUDIENCE, type Actor } from "./identity.js";

export interface WorkerClient {
  post(path: string, body: unknown, actor: Actor): Promise<unknown>;
}

export function createWorkerClient(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): WorkerClient {
  const base = (env.CRM_WORKER_BASE_URL ?? "").replace(/\/$/, "");
  const token = env.CRM_WORKER_SERVICE_TOKEN ?? "";
  const privateKey = env.CRM_IDENTITY_ASSERTION_PRIVATE_KEY ?? "";
  return {
    async post(path, body, actor) {
      if ((env.CRM_TRANSPORT ?? "").trim() !== "cloudflare") {
        throw new Error("CRM_TRANSPORT=cloudflare ist nicht aktiv. Der MCP schreibt nicht direkt in MySQL.");
      }
      if (!base || !token || !privateKey) throw new Error("CRM_WORKER_BASE_URL, CRM_WORKER_SERVICE_TOKEN oder CRM_IDENTITY_ASSERTION_PRIVATE_KEY fehlt.");
      const raw = JSON.stringify(body ?? {});
      const assertion = await signAssertion(privateKey, { actor, audience: WORKER_AUDIENCE, requestSha256: sha256(raw) });
      const response = await fetchImpl(base + path, {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json", "x-crm-identity": assertion },
        body: raw,
      });
      const payload = await response.json() as { ok?: boolean; result?: unknown; error?: { code?: string; message?: string } };
      if (!response.ok || payload.ok === false) {
        throw new Error((payload.error?.code ?? "WORKER_ERROR") + ": " + (payload.error?.message ?? "Workerfehler"));
      }
      return payload.result;
    },
  };
}
