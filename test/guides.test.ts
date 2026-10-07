import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readGuide } from "../src/guides.ts";

const skillRoot = fileURLToPath(new URL("../skills/crm-kandidatensuche/", import.meta.url));

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

test("embedded guide uses the new server page rules", () => {
  const guide = JSON.parse(readGuide("json")) as {
    version: string;
    server: string;
    limits: { list_page_size: number; count_is_complete: boolean; no_default_limit_200: boolean };
    privacy: { allowed_exceptions: { eu_buerger_filter: boolean; birthdate_in_candidate_search_rows: boolean } };
  };
  const markdown = readGuide("markdown");
  assert.equal(guide.version, "1.2.0");
  assert.equal(guide.server, "cloud-crm-mcp");
  assert.equal(guide.limits.list_page_size, 50);
  assert.equal(guide.limits.count_is_complete, true);
  assert.equal(guide.limits.no_default_limit_200, true);
  assert.equal(guide.privacy.allowed_exceptions.eu_buerger_filter, true);
  assert.equal(guide.privacy.allowed_exceptions.birthdate_in_candidate_search_rows, true);
  assert.match(markdown, /50 Zeilen pro Seite/);
  assert.doesNotMatch(markdown, /Cap von 200/);
});

test("embedded skill does not point at the old worker", () => {
  const banned = ["workers.dev", "00184318f6854e1788f6061e24eaf24f", "pipedrive-crm", "search_and_query_rows"];
  for (const path of filesUnder(skillRoot)) {
    const text = readFileSync(path, "utf8");
    for (const word of banned) assert.equal(text.includes(word), false, path + " contains " + word);
  }
});
