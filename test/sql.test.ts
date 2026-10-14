import assert from "node:assert/strict";
import test from "node:test";
import { assertSeparateInfrastructure } from "../src/guard.ts";
import { buildCandidateSearch, buildCompanySearch, buildCrmQuery, buildResolveBeruf } from "../src/sql.ts";

test("Kandidatensuche leitet das Alter ab und zaehlt leere Staatsangehoerigkeit mit", () => {
  const plan = buildCandidateSearch({ eu_buerger: false, sprache: "Deutsch", niveau: "B1" });
  assert.match(plan.rowSql, /TIMESTAMPDIFF\(YEAR, k\.kandidat_datumrodjenja, CURRENT_DATE\) AS alter_jahre/);
  assert.equal(plan.rowSql.includes("k.kandidat_datumrodjenja AS"), false);
  assert.match(plan.countSql, /TRIM\(k\.kandidat_drzavljanstvo_vrsta\) = ''/);
  assert.equal(plan.countSql.includes("UPPER(TRIM(j.kj_slusanje)) IN"), true);
  assert.deepEqual(plan.countParams, ["EU%", "Njemački", "B1", "B2", "C1", "C2"]);
});

test("Vor- und Nachname muessen beide Felder treffen", () => {
  const full = buildCandidateSearch({ name: "Elvis Hurtić" });
  assert.equal((full.countSql.match(/k.kandidat_ime /g) ?? []).length, 2);
  assert.equal((full.countSql.match(/k.kandidat_prezime /g) ?? []).length, 2);
  assert.match(full.countSql, /AND/);
  assert.deepEqual(full.countParams, ["%elvis%", "%elvis%", "%hurtic%", "%hurtic%"]);
  const first = buildCandidateSearch({ name: "  Elvis  " });
  assert.equal((first.countSql.match(/LIKE ?/g) ?? []).length, 2);
  assert.deepEqual(first.countParams, ["%elvis%", "%elvis%"]);
});

test("gesprochene Sprache, Beruf und Alter bleiben zusammen und treffen gespeicherte Formen", () => {
  const spoken = buildCandidateSearch({ sprache: "German", niveau: "BEZ ZNANJA", position_text: "Elektriker", alter_von: 25, alter_bis: 35 });
  assert.ok(spoken.countParams.includes("Njemački"));
  assert.ok(spoken.countParams.includes("Bez znanja"));
  assert.ok(spoken.countParams.includes("Bezznanja"));
  assert.ok(spoken.countParams.includes("Bez poznavanja"));
  assert.ok(spoken.countParams.includes("%elektricar%"));
  assert.ok(spoken.countParams.includes("%elektriker%"));
  assert.ok(spoken.countParams.includes(25));
  assert.ok(spoken.countParams.includes(35));
  assert.match(spoken.countSql, /kandidat_datumrodjenja IS NOT NULL/);
  assert.equal(spoken.countSql.includes("BETWEEN ? AND ?"), true);
  assert.equal(spoken.countParams.includes("%vozac%"), false);
  const driver = buildCandidateSearch({ position_text: "Fahrer" });
  assert.ok(driver.countParams.includes("%vozac%"));
  assert.ok(driver.countParams.includes("%fahrer%"));
  const both = buildCandidateSearch({ sprache: "njemacki i engleski", niveau: "A2" });
  assert.equal(both.countSql.match(/EXISTS/g)?.length, 2);
  assert.ok(both.countParams.includes("Njemački"));
  assert.ok(both.countParams.includes("Engleski"));
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
