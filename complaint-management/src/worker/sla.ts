import { notify } from "./notifications";
import { slaStage } from "./workflow";
import type { Env } from "./types";

interface DueCase {
  id: string;
  case_id: string;
  sla_due_at: string;
  officer_id: string | null;
  officer_email: string | null;
  reviewer_id: string | null;
  reviewer_email: string | null;
}

export async function processSlaReminders(env: Env, now = new Date()): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.case_id, c.sla_due_at,
      officer.id AS officer_id, officer.email AS officer_email,
      reviewer.id AS reviewer_id, reviewer.email AS reviewer_email
     FROM complaints c
     LEFT JOIN complaint_assignments primary_assignment ON primary_assignment.complaint_id = c.id
       AND primary_assignment.assignment_type = 'PRIMARY' AND primary_assignment.ended_at IS NULL
     LEFT JOIN users officer ON officer.id = primary_assignment.user_id
     LEFT JOIN users reviewer ON reviewer.id = primary_assignment.reviewer_id
     WHERE c.sla_due_at IS NOT NULL AND c.status NOT IN ('Closed', 'Referred') AND c.deleted_at IS NULL`,
  ).all<DueCase>();
  let created = 0;
  for (const complaint of rows.results) {
    const stage = slaStage(new Date(complaint.sla_due_at), now);
    if (!stage) continue;
    const eventType = stage.startsWith("OVERDUE") ? "OVERDUE_CASE" : "UPCOMING_SLA_DEADLINE";
    const recipientId = stage.startsWith("OVERDUE") && complaint.reviewer_id ? complaint.reviewer_id : complaint.officer_id;
    const recipientEmail = stage.startsWith("OVERDUE") && complaint.reviewer_email ? complaint.reviewer_email : complaint.officer_email;
    const eventId = crypto.randomUUID();
    const insert = await env.DB.prepare(
      `INSERT OR IGNORE INTO sla_events (id, complaint_id, event_type, stage_key, due_at, recipient_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(eventId, complaint.id, eventType, stage, complaint.sla_due_at, recipientId).run();
    if ((insert.meta.changes ?? 0) !== 1) continue;
    created += 1;
    await notify(env, {
      eventType,
      complaintId: complaint.id,
      userId: recipientId ?? undefined,
      recipientEmail: recipientEmail ?? undefined,
      subject: `${complaint.case_id}: ${stage.startsWith("OVERDUE") ? "overdue" : "SLA deadline"}`,
      body: `Case ${complaint.case_id} requires attention. Review it in the protected Integrity portal.`,
      actionUrl: `/portal/cases/${encodeURIComponent(complaint.case_id)}`,
      idempotencyKey: `sla:${complaint.id}:${stage}`,
    });
  }
  await env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < datetime('now', '-1 day')").run();
  return created;
}
