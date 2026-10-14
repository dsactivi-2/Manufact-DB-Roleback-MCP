const endpoint = process.env.MCP_URL ?? "";
const token = process.env.MCP_ACCESS_TOKEN ?? "";
if (!endpoint || !token) fail("MCP_URL_AND_MCP_ACCESS_TOKEN_REQUIRED");
const url = new URL(endpoint);
if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/mcp") fail("MCP_URL_INVALID");

const headers = new Headers({ authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "content-type": "application/json" });
async function rpc(id, method, params) {
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), redirect: "error", signal: AbortSignal.timeout(30_000) });
  const session = response.headers.get("mcp-session-id");
  if (session) headers.set("mcp-session-id", session);
  const text = await response.text();
  const data = text.startsWith("{") ? text : text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  if (!data) fail("MCP_RESPONSE_INVALID");
  const message = JSON.parse(data);
  if (response.status !== 200 || message.error) fail("MCP_CALL_FAILED");
  return message.result;
}

await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mutation-tools-smoke", version: "1" } });
const listed = await rpc(2, "tools/list", {});
const names = new Set((listed.tools ?? []).map((tool) => tool.name));
const required = ["crm_history_list", "crm_change_preview", "crm_change_apply", "crm_restore_preview", "crm_restore_apply"];
const missing = required.filter((name) => !names.has(name));
console.log(JSON.stringify({ ok: missing.length === 0, advertised: required.filter((name) => names.has(name)), missing }));
if (missing.length > 0) process.exitCode = 1;

function fail(code) {
  console.log(JSON.stringify({ ok: false, code }));
  process.exit(1);
}
