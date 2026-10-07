# CRM query rules

## Result scope and tool selection

Return the requested count, names, list, profile, or summary. Do not retrieve extra profiles, statistics, contact fields, or linked records to construct a smaller answer. `crm_stats` returns candidate, company, and assignment totals; `crm_beruf_report` also returns position and language breakdowns; `crm_kandidat_profile` returns a complete profile. Use these only when that scope is requested and their output complies with privacy policy. Otherwise use an explicit-column or aggregate `SELECT` fallback after the guide and necessary schema checks. One page of 50 rows is not a complete count.

## Archive and counting

`kandidat_status = 3` is archived; exclude it by default with `kandidat_status <> 3`. Including archived candidates requires an explicit request. This predicate also excludes NULL status; do not silently classify unknown status as active. Other requested status labels must be resolved against the actual schema.

Count unique candidates with `COUNT(DISTINCT k.kandidat_id)` when using one-to-many relations. Prefer `EXISTS` for filters on languages, experience, and education. Table row-count estimates are not exact candidate counts.

## Profession permission

Without mapping permission, use only the user's literal profession term in `position_text` / `kri_pozicija`. Do not add related jobs, automatic translations, or inferred groups. `crm_resolve_beruf` requires explicit permission. Discovery alone does not authorize a candidate query using the discovered variants: display variants and use only selected ones. Explicit permission to discover and include variants covers both actions.

Use `beruf_mapping` only after confirming table availability and mapping permission. The currently exposed `berufsgruppe_id` parameter is documented as a LIKE filter on position text, not a verified mapping ID. Do not infer an ID-based join from that parameter's name. If a mapping table is absent, use confirmed `kri_pozicija` values only.

## Language

Known levels are `A1`, `A2`, `B1`, `B2`, `C1`, and `C2`. `BEZ ZNANJA` explicitly means no knowledge. NULL, empty, not selected, and no matching language row mean unknown; keep them separate from explicit no knowledge and distinguish them if the requested breakdown needs it.

Minimum-level filtering uses listening (`kj_slusanje`). At least B1 means `IN ('B1', 'B2', 'C1', 'C2')`. Language and level must match in the same `EXISTS` / language row. If reading or writing is requested, use that verified dimension instead and name it in the result when material. Resolve language spelling without broadening the language filter.

`crm_beruf_report` returns the distinct candidate count, the matching term groups, and at most 50 top position texts. The default list length is 15. Archived candidates stay excluded unless requested. Group counts may exceed the distinct total because one candidate can match several terms. Include the listening breakdown only for a language the user named. Do not substitute `Njemački` or any other default language.

## Age, location, and education

Use completed years with `TIMESTAMPDIFF(YEAR, kandidat_datumrodjenja, CURDATE())` when an age filter is requested. Age comes only from that birth-date column. An empty birth date has no age and does not match an age filter; the server cannot invent the date. A birth date in the future does not produce an age. On 6 October 2026 the user accepted the current one-sided bounds: a missing lower bound stays 0 and a missing upper bound stays 150. That is not treated as an MCP defect. An explicit age from/to must use those exact completed-year bounds. Do not calculate age by subtracting calendar years. An age-only count does not return birth dates. Other dates, including work start and end or a possible license or passport expiry, are not age.

Country means residence or work location, never nationality or citizenship. Resolve location columns from the actual schema; do not substitute citizenship fields.

When both school and qualification direction are requested, both predicates must match the same education row.

## Limits and fallback

Candidate search exposes count_only, cursor, and page_size. A candidate list loads 50 rows per page and does not return 2000 candidates at once. Repeat the same filters with the returned cursor until no rows remain. A count returns the full number and does not stop at 50. Do not invent offset, and do not treat one page as the full set.

Company search, assignment search, and crm_query use the same rule. crm_query does not append LIMIT 200. A list loads 50 rows per page. A count returns the full number and does not stop at 50. Profession reports cap the position list at 50.

Candidate search accepts eu_buerger and includes kandidat_datumrodjenja in each search row, plus age when the handler calculates it. true means kandidat_drzavljanstvo_vrsta LIKE 'EU%'. false also includes an empty citizenship field. The user accepted that on 6 October 2026. Do not query the raw citizenship column, and do not return a birth date for an age-only count.

Use a single simplest sufficient `SELECT` over verified allowed relations and explicit permitted fields. Read-only syntax alone does not establish tenant authorization or field safety. The server must validate SQL, scope, functions, and output as described in [tool contracts](tool-contracts.md).
