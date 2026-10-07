import { handleWorker, type WorkerEnv } from "./http.js";

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleWorker(request, env);
  },
};
