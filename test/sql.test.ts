import assert from "node:assert/strict";
import test from "node:test";
import { assertSeparateInfrastructure } from "../src/guard.ts";
import { buildCandidateSearch, buildCompanySearch, buildCrmQuery, buildResolveBeruf } from "../src/sql.ts";

test("Kandidatensuche liefert Geburtsdatum und zaehlt leere Staatsangehoerigkeit mit", () => {
  const plan = buildCandidateSearch({ eu_buerger: false, sprache: "Deutsch", niveau: "B1" });
  assert.match(plan.rowSql, /kandidat_datumrodjenja/);
  assert.match(plan.countSql, /TRIM\(k\.kandidat_drzavljanstvo_vrsta\) = ''/);
  assert.match(plan.countSql, /kj_slusanje IN/);
  assert.deepEqual(plan.countParams.slice(1, 5), ["Deutsch", "B1", "B2", "C1"]);
});

test("Firmen haben eine naechste Seite ohne Limit 200", () => {
  const plan = buildCompanySearch({ cursor: "40" });
  assert.match(plan.rowSql, /company_id < \?/);
  assert.equal(plan.rowSql.includes("LIMIT 200"), false);
  assert.deepEqual(plan.rowParams, ["40"]);
});

test("freies SQL lehnt SELECT * und ein zu grosses Limit ab", () => {
  assert.throws(() => buildCrmQuery("SELECT * FROM idk_kandidati"), /SELECT \*/);
  assert.throws(() => buildCrmQuery("SELECT kandidat_id FROM idk_kandidati LIMIT 200"), /50/);
  const count = buildCrmQuery("SELECT COUNT(*) FROM idk_kandidati");
  assert.equal(count.mode, "count");
  assert.equal(count.sql.includes("LIMIT"), false);
});

test("OFFSET und die alte 200-Zeilen-Grenze sind zwei verschiedene Verbote", () => {
  assert.throws(() => buildCrmQuery("SELECT kandidat_id FROM idk_kandidati LIMIT 50 OFFSET 50"), /OFFSET/);
  assert.throws(() => buildCrmQuery("SELECT kandidat_id FROM idk_kandidati OFFSET 10"), /OFFSET/);
  assert.throws(() => buildCrmQuery("SELECT kandidat_id FROM idk_kandidati LIMIT 200"), (error: Error) => {
    assert.match(error.message, /50/);
    assert.doesNotMatch(error.message, /OFFSET/);
    return true;
  });
});

test("Berufsvarianten starten keine Kandidatensuche", () => {
  const plan = buildResolveBeruf({ begriff: "Fahrer" });
  assert.match(plan.sql, /kri_pozicija/);
  assert.equal(plan.sql.includes("kandidat_ime"), false);
});

test("alter Hyperdrive und alter Worker sind verboten", () => {
  assert.throws(() => assertSeparateInfrastructure({ CRM_HYPERDRIVE_ID: "00184318f6854e1788f6061e24eaf24f" }), /verboten/);
  assert.throws(() => assertSeparateInfrastructure({ CRM_DATABASE_URL: "mysql://crm-pipedrive-worker.example/db" }), /verboten/);
  assert.doesNotThrow(() => assertSeparateInfrastructure({}));
});
