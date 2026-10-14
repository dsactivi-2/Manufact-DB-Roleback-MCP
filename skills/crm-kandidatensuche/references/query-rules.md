# CRM query rules

## Tool choice

Return the requested count, names, list, profile, or summary. Do not open a profile, a profession report, or `crm_stats` to build a smaller answer.

- `crm_search_kandidaten` is the candidate search. `count_only: true` returns the full distinct count and no rows.
- `crm_kandidat_profile` is one already identified `kandidat_id`. It adds the group, status label, listening/reading/writing levels, experience position and dates, and education. It does not return the employer or the spoken-language columns.
- `crm_beruf_report` is an aggregate for named profession terms: distinct candidates, per-term hits, and top stored position texts. The position list defaults to 15 and stops at 50. A language breakdown is included only when `sprache` is set. Do not substitute Njemački.
- `crm_resolve_beruf` lists variants and sets `suchlauf: false`. It is not a search.
- `crm_stats` is the global candidate total, plus company and order totals when the role can see them. It is not a filtered search.
- Company and order search accept a numeric status only when that exact CRM value is already known. Do not guess it.

## Name, profession, language, and age

Pass a full personal name as one `name` value. The server folds case and diacritics, splits on spaces, keeps at most six tokens, and requires every token to occur in the first name or the last name. A token containing `dj` also matches the form with `d`. Searching only the surname returns other people with that surname. Do not add profession, language, age, or EU filters the user did not name. Several filters the user did name apply together.

`position_text` matches stored experience text. The server already equates a short list of the same occupation across B/H/S, German, and English, including vozač/Fahrer/driver, električar/Elektriker, and konobar/Kellner. Do not add further related jobs. The exposed tool has no `berufsgruppe_id` argument.

Language names may be the stored CRM spelling or an everyday alias such as Njemački, Deutsch, German, Engleski, or English. `ili` / `oder` / `or` between known languages is OR; otherwise every named language must match. A minimum level uses listening unless `fertigkeit` is `lesen` or `schreiben`. A1 through C2 are cumulative upward. `BEZ ZNANJA` matches the stored forms Bez znanja, Bezznanja, and Bez poznavanja. NULL, empty, and a missing language row stay unknown and do not satisfy a known minimum. Language and level must match the same language row.

Age is completed years from `kandidat_datumrodjenja` to the current date. A missing bound is 0 or 150. A missing, invalid, or future birth date has no age and does not match an age filter. The search returns `alter_jahre`, which may be null. It does not return the birth date. Work dates and document dates are not age.

`eu_buerger: true` means the stored citizenship type starts with `EU`. `false` also includes NULL and blank. That is not residence or workplace, and the raw citizenship column is not a search argument.

## Archive and pages

Status 3 is archived and is excluded unless `archived` is true. `kandidat_status <> 3` also excludes NULL. Do not invent labels for other status numbers; use `status_label` from a requested profile.

A list page contains at most 50 rows, ordered by id descending. `has_more` and `next_cursor` mean another page with the same filters. The cursor is the last id, and the next page uses a smaller id. There is no offset. `total_count` is the full count, not the page length. A smaller requested `page_size` is kept. One page is not the whole set when `has_more` is true.

Company search, order search, and profession reports follow the same page or list cap. Free SQL is not available, so do not plan a `SELECT` fallback.
