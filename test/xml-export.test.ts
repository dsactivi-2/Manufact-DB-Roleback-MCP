import assert from "node:assert/strict";
import test from "node:test";
import { candidatesToXml, collectCandidateExport, xmlEscape } from "../src/xml-export.ts";

test("xml escape covers markup characters", () => {
  assert.equal(xmlEscape("a&b<c>'"), "a&amp;b&lt;c&gt;&apos;");
  assert.equal(xmlEscape(String.fromCharCode(34)), "&quot;");
});

test("xml export keeps the search allowlist", () => {
  const xml = candidatesToXml([
    { kandidat_id: 5, kandidat_ime: "Ana & Co", kandidat_prezime: "A", kandidat_status: 1, alter_jahre: null, telefon: "123" },
  ], { totalCount: 1, truncated: false, nextCursor: null });
  assert.match(xml, /Ana &amp; Co/);
  assert.match(xml, /returned_count="1"/);
  assert.doesNotMatch(xml, /telefon|123|alter_jahre/);
});

test("xml export includes the phone only when requested", () => {
  const row = { kandidat_id: 5, kandidat_ime: "Ana", kandidat_prezime: "A", kandidat_status: 1, alter_jahre: 30, telefon: "+38761111" };
  const xml = candidatesToXml([row], { totalCount: 1, truncated: false, nextCursor: null }, { includePhone: true });
  assert.equal(xml.includes("<telefon>+38761111</telefon>"), true);
});

test("xml export stops at max_rows and returns a continuation cursor", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const result = await collectCandidateExport(async (args) => {
    seen.push(args);
    const start = Number(args.cursor ?? 100);
    const size = Number(args.page_size);
    const rows = Array.from({ length: size }, (_, index) => ({
      kandidat_id: start - 1 - index,
      kandidat_ime: "A",
      kandidat_prezime: "B",
      kandidat_status: 1,
      alter_jahre: 30,
    }));
    const last = rows.at(-1)?.kandidat_id;
    return { total_count: 10, has_more: true, next_cursor: String(last), rows };
  }, { name: "A" }, { maxRows: 3 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.page_size, 3);
  assert.equal(seen[0]?.name, "A");
  assert.equal(result.returned_count, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.next_cursor, "97");
  assert.match(result.xml, /truncated="true"/);
  assert.match(result.xml, /next_cursor="97"/);
});
