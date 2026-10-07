# Privacy rules

## Minimal authorized access

- Retrieve and return only fields needed for the explicit request.
- Candidate search rows include the birth date. Do not include contact details, addresses, identity documents, attachments, or internal notes by default.
- Do not expand from a candidate to linked companies, assignments, or other people unless requested.
- Prefer counts and anonymous aggregates when names are unnecessary.
- Require an explicit request and server-side authorization for sensitive fields or bulk export.
- Never place credentials, full candidate records, or unnecessary personal data in logs, errors, examples, fixtures, or tool metadata.
- Apply tenant and role checks in every MCP handler. A prompt or skill cannot grant access.
- Keep retention and deletion behavior in the CRM system of record; this server must not create a shadow database.

## Prohibited candidate attributes

Gender/sex, religion, health data, and ethnic origin stay prohibited. Do not retrieve, filter, infer, rank by, return, or send those attributes to external services. The 6 October 2026 decision allows two exceptions: candidate search rows include `kandidat_datumrodjenja`, and candidate search accepts `eu_buerger`. Do not use the raw column `kandidat_drzavljanstvo_vrsta` as a free filter or default output. EU citizenship is not residence or work location. A request for people who live or work in a country uses the location fields, not `eu_buerger`.

New server schemas, prompts, logs, audit records, and fixtures must omit prohibited attributes. Legacy imported text must be sanitized server-side before it reaches the plugin or any external evaluator. If a tool unexpectedly returns prohibited data, do not repeat it or forward it; report the policy mismatch without candidate details. Removing it from the final answer does not establish compliant retrieval.

## Dates, locations, and optional private data

Birth dates use valid complete `YYYY-MM-DD` values and cannot be in the future. Candidate search rows include that date. An age-only count does not return it. Age is computed on the assessment date, not stored independently and not used for semantic match scoring. This read-only server cannot normalize or repair stored records.

Preserve source location text alongside structured city, country name, and ISO country code on the server. A country value describes residence or work, not citizenship.

Marital status and family information are not required, do not affect ranking, and are excluded from external evaluation. Existing access requires a confirmed purpose, lawful basis, and limited server authorization; do not request or retrieve them by default.

## Notes and future evaluators

Notes are professional, factual, business-relevant, neutral, and attributed to an author and date. Note review and rewriting are planned server features; this server never saves notes. Do not send raw notes or full profiles to TypeSafe or another evaluator. Any future adapter must first remove prohibited and unnecessary private data and enforce the approved policy server-side.

Photo review, biometric comparison, and ranking are included in phase 5 of this server, decision DEC-2026-10-06-phased-scope. They are not built, and this server must not call them. No legal review is evidenced, so they are not authorized on real photos or biometric data. Photos and appearance do not contribute to the current professional search. Do not infer gender, religion, health, or ethnic origin from photos, and do not merge candidate records automatically.
