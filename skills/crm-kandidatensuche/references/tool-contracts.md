# MCP tool contracts

The registered read tools are `crm_search_kandidaten`, `crm_search_companies`, `crm_search_nalozi`, `crm_beruf_report`, `crm_resolve_beruf`, `crm_kandidat_profile`, `crm_stats`, `crm_list_tables`, `crm_describe_table`, `crm_entity_policy_list`, and `crm_search_guide`.

`crm_query` exists only as an internal function. The worker route `/v1/read/query` answers `SQL_GATEWAY_DISABLED`. Do not expose or call it.

History and change tools are registered only when `CRM_MUTATION_TOOLS_ENABLED=true`: `crm_history_list`, `crm_change_preview`, `crm_change_apply`, `crm_restore_preview`, `crm_restore_apply`, `crm_write_request_approval`, `crm_write_approval_list`, and `crm_write_decide`. Their behavior is in [writes](writes.md).

## Server behavior that the skill cannot relax

Handlers reject unknown fields, use parameterized SQL, and take tenant and role from the verified actor. A shared token is not a named writer. Read tools are marked read-only. Apply, approval request, and approval decision are mutating and idempotent. Errors must not include SQL, credentials, or candidate values.

Search output is allowlisted. Gender, religion, health data, and ethnic origin stay prohibited. The birth date is absent from search rows and present on the profile query. `eu_buerger` is the only citizenship filter.

A list page is at most 50 rows. The count is the handler aggregate, not the page length and not `TABLE_ROWS`. Offset is rejected. The old 200-row cap is not used.

Company and order records are admin-only entities. Every current read handler also requires the admin scope before it runs. A denied call is not an empty result.

The guide resources serve `skills/crm-kandidatensuche/guides`. The short `crm_search_guide` tool remains the live summary. If a live tool field and the bundled guide disagree, the live tool wins.

## Not a tool

Scoring, duplicate detection, profession classification, note review, photo review, biometrics, import, export, and deletion are not registered. `DELETE` and `DROP` are not worker operations. Do not invent those calls.
