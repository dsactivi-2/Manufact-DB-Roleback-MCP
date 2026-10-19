# Changes, history, and approvals

Use this only after the user explicitly asks to change CRM data, restore fields, inspect history, or review approvals. A search phrase, including `Mujo udri`, is not that request. If the mutation tools are not in the connected tool list, stop and say they are not enabled.

## Which record

Call `crm_entity_policy_list` before the first write in a task. Patch API field names from that list, never table column names. One patch has 1 to 20 fields. `candidate_status` is read-only. Delete and drop do not exist.

Candidate changes can be the person (`candidate`) or a child row (`candidate_education`, `candidate_language`, `candidate_experience`). `candidate_group` is the group catalog. Company and order are separate entities. A question about pending candidate changes means the person plus the three child types, not companies or orders.

Child education, language, and experience rows can be inserted. An insert uses `operation: "insert"`, `entity_id: "new"`, and `expected_revision: "0"`. An update uses the existing id and the revision from preview or history.

## Change sequence

1. Preview with `crm_change_preview`. Required inputs are `entity_type`, `entity_id`, `expected_revision`, `patch`, `reason` (3 to 500 characters), and `idempotency_key` (8 to 128 characters from `A-Za-z0-9._:-`). Preview does not save the business row. Show the user the before and after values.
2. Do not apply until the user confirms that preview. Submit the preview object unchanged to `crm_write_request_approval`. The server stores it as pending and gives it 24 hours. The returned `approval_id` belongs to the requesting principal.
3. `crm_change_apply` repeats the same change payload plus that `approval_id`. The approval is single-use, must match the preview hash, and must still belong to the same principal. After a decision it is usable for 15 minutes.
4. Reuse the same idempotency key only to recover the same result. A new key is a new change. Do not mint a new key to bypass a conflict.

Current business entities use `approve_write`, so a preview still needs approval before apply while `REQUIRE_APPROVAL` is on. `WRITES_ENABLED` must be true for the approval request, the decision, and apply. When it is false those calls return `WRITES_DISABLED`. Preview can still be shown. Do not look for another write path.

## Approvals

`crm_write_approval_list` takes one `entity_type` and returns at most 50 pending rows for that type. It requires `crm:<entity>:approve_write`. `crm_write_decide` takes `approval_id` and `approved` or `rejected`. The requester cannot decide their own approval. `FORBIDDEN` means this actor cannot see or decide the queue. It does not mean the queue is empty, and it is not a reason to try SQL or other entity types beyond the ones the user asked about.

## History and restore

`crm_history_list` returns up to 50 events for one entity type and id. A reader, a requester, or an approver for that entity may call it.

Restore only the fields the user names. `crm_restore_preview` needs the history `source_event_id`, those field names, a reason, and a new idempotency key. Then use the same approval and apply path through `crm_restore_apply`. `RESTORES_ENABLED` also requires writes to be enabled. An insert event cannot be restored, because delete is not available. A restore writes a new history event; it does not erase the later one.
