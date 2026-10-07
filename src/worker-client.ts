import { isReadOperation, readSchemas, type ReadOperation } from "../contracts/read.js";

export function validateWorkerSettings(env: NodeJS.ProcessEnv): URL {
  const address = env.CRM_WORKER_BASE_URL;
  const token = env.CRM_WORKER_SERVICE_TOKEN;
  if (!address || !token || token.length < 32) throw new Error("Nedostaje Worker adresa ili servisni token.");
  const url = new URL(address);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Worker mora imati HTTPS origin bez putanje ili pristupnih podataka.");
  }
  return url;
}

export function createWorkerClient(env: NodeJS.ProcessEnv, fetcher: typeof fetch = fetch) {
  const base = validateWorkerSettings(env);
  return {
    async read(operation: ReadOperation, input: unknown): Promise<unknown> {
      if (!isReadOperation(operation)) throw new Error("Nepoznata operacija.");
      const args = readSchemas[operation].parse(input);
      let response: Response;
      try {
        response = await fetcher(new URL("/v1/read/" + operation, base), {
          method: "POST", redirect: "error",
          headers: { "content-type": "application/json", authorization: "Bearer " + env.CRM_WORKER_SERVICE_TOKEN },
          body: JSON.stringify(args), signal: AbortSignal.timeout(25000),
        });
      } catch {
        throw new Error("DEPENDENCY_UNAVAILABLE: Worker nije dostupan.");
      }
      const length = Number(response.headers.get("content-length"));
      if (length > 2 * 1024 * 1024) throw new Error("Worker odgovor je prevelik.");
      const body = await response.text();
      if (new TextEncoder().encode(body).length > 2 * 1024 * 1024) throw new Error("Worker odgovor je prevelik.");
      let result: { data?: unknown; error?: { code?: string } };
      try { result = JSON.parse(body); } catch { throw new Error("Neispravan Worker odgovor."); }
      if (!response.ok) {
        const code = result.error?.code;
        throw new Error(typeof code === "string" && /^[A-Z_]{1,64}$/.test(code) ? code : "DEPENDENCY_UNAVAILABLE");
      }
      if (!Object.prototype.hasOwnProperty.call(result, "data")) throw new Error("Neispravan Worker odgovor.");
      return result.data;
    },
  };
}
