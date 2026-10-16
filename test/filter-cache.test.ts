import assert from "node:assert/strict";
import test from "node:test";
import { rememberFilterCache, resetFilterCaches, resolveCandidateQuery } from "../src/filter-cache.ts";
import { buildCandidateSearch } from "../src/sql.ts";

test("filter cache narrows only inside the saved chain", () => {
  resetFilterCaches();
  const first = resolveCandidateQuery({ position_text: "Elektriker", naziv: "elektricari" });
  assert.equal(first.save, true);
  const saved = rememberFilterCache({ naziv: first.naziv, parent_id: first.parent_id, steps: first.steps, total_count: 80 });
  const second = resolveCandidateQuery({ cache_id: saved.id, sprache: "Deutsch" });
  assert.equal(second.parent_id, saved.id);
  assert.equal(second.steps.length, 2);
  const plan = buildCandidateSearch(second.query);
  assert.match(plan.countSql, /kri_pozicija/);
  assert.match(plan.countSql, /kj_naziv/);
  const same = resolveCandidateQuery({ cache_id: saved.id, cursor: "10" });
  assert.equal(same.save, false);
  assert.equal(same.steps.length, 1);
  assert.throws(() => resolveCandidateQuery({ cache_id: "fc_0000000000000000" }), /ne postoji/);
});
