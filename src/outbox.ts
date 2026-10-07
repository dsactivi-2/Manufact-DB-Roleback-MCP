import { canonicalJson, newId, sqlUtc } from "./canonical.js";
import { CrmError } from "./crm-error.js";
import type { SqlSession } from "./sql-session.js";

export interface ArchivePut {
  put(key: string, body: string): Promise<void>;
}

export async function archiveDue(session: SqlSession, archive: ArchivePut, now = new Date(), limit = 10): Promise<{ claimed: number; archived: number }> {
  const bounded = Math.min(Math.max(limit, 1), 50);
  const stamp = sqlUtc(now);
  await session.query("START TRANSACTION");
  const due = await session.query(
    "SELECT event_id FROM rb_outbox WHERE status='pending' AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY event_id LIMIT " + String(bounded) + " FOR UPDATE",
    [stamp, stamp],
  );
  const token = newId();
  const until = sqlUtc(new Date(now.getTime() + 30_000));
  for (const row of due.rows) {
    await session.query("UPDATE rb_outbox SET lease_token=?, lease_until=?, attempts=attempts+1 WHERE event_id=?", [token, until, row.event_id]);
  }
  await session.query("COMMIT");
  let archived = 0;
  for (const row of due.rows) {
    const eventId = String(row.event_id);
    const loaded = await session.query("SELECT event_id, entity_type, entity_id, revision_before, revision_after, operation, source_event_id, created_at, typed_changes, event_sha256 FROM rb_events WHERE event_id=?", [eventId]);
    const event = loaded.rows[0];
    if (!event) continue;
    const body = canonicalJson(event);
    try {
      await archive.put("events/" + eventId + ".json", body);
    } catch {
      await session.query(
        "UPDATE rb_outbox SET lease_token=NULL, lease_until=NULL, next_attempt_at=? WHERE event_id=? AND lease_token=? AND status='pending'",
        [stamp, eventId, token],
      );
      continue;
    }
    await session.query("START TRANSACTION");
    const confirmed = await session.query("UPDATE rb_outbox SET status='archived', archived_at=?, lease_token=NULL, lease_until=NULL WHERE event_id=? AND lease_token=? AND status='pending'", [sqlUtc(new Date()), eventId, token]);
    await session.query("COMMIT");
    if (confirmed.affectedRows === 1) archived += 1;
  }
  return { claimed: due.rows.length, archived };
}

export function assertNoPhysicalDelete(operation: string): void {
  if (operation.toLowerCase() === "delete" || operation.toLowerCase() === "drop") {
    throw new CrmError("INVALID_INPUT", "Physisches Loeschen ist gesperrt.");
  }
}
