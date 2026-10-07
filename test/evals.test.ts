import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const evals = JSON.parse(readFileSync(new URL("./evals.json", import.meta.url), "utf8")) as {
  role: string;
  server: string;
  cases: Array<{ id: string; expected: string[] }>;
};

test("angepasste Pruefliste gehoert zum neuen Server und nicht zum alten", () => {
  const text = JSON.stringify(evals);
  assert.equal(evals.server, "cloud-crm-mcp");
  assert.equal(evals.role, "test_specification_not_a_runtime_skill");
  assert.equal(text.includes("workers.dev"), false);
  assert.equal(text.includes("no-pagination-schema"), false);
  const page = evals.cases.find((item) => item.id === "cursor-page");
  assert.ok(page);
  assert.match(page.expected.join(" "), /cursor/);
  assert.match(page.expected.join(" "), /OFFSET/);
  const cap = evals.cases.find((item) => item.id === "timeout-and-cap");
  assert.ok(cap);
  assert.match(cap.expected.join(" "), /200-row cap/);
  assert.match(cap.expected.join(" "), /OFFSET is rejected on its own/);
});
