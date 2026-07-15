import type { ComplaintStatus } from "../shared/constants";
import type { Actor } from "../shared/types";
import { addBusinessDays, defaultSlaDays } from "./workflow";

export async function nextCaseId(db: D1Database, now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  await db.prepare(
    "INSERT OR IGNORE INTO sequence_counters (sequence_name, sequence_year, next_value) VALUES ('complaint_case', ?, 1)",
  ).bind(year).run();
  const row = await db.prepare(
    `UPDATE sequence_counters
     SET next_value = next_value + 1, updated_at = CURRENT_TIMESTAMP
     WHERE sequence_name = 'complaint_case' AND sequence_year = ?
     RETURNING next_value - 1 AS allocated_value`,
  ).bind(year).first<{ allocated_value: number }>();
  if (!row) throw new Error("CASE_ID_ALLOCATION_FAILED");
  return `CMP-${year}-${String(row.allocated_value).padStart(6, "0")}`;
}

export async function calculateSlaDueAt(
  db: D1Database,
  risk: "Critical" | "High" | "Medium" | "Low",
  categoryId: string | null,
  start = new Date(),
): Promise<string> {
  const rule = await db.prepare(
    `SELECT target_business_days FROM sla_rules
     WHERE active = 1 AND risk_level = ? AND (category_id = ? OR category_id IS NULL)
     ORDER BY category_id IS NOT NULL DESC LIMIT 1`,
  ).bind(risk, categoryId).first<{ target_business_days: number }>();
  return addBusinessDays(start, rule?.target_business_days ?? defaultSlaDays(risk)).toISOString();
}

export async function audit(
  db: D1Database,
  input: {
    actor: Actor | null;
    action: string;
    entityType: string;
    entityId: string;
    previousValue?: unknown;
    newValue?: unknown;
    correlationId: string;
    reason?: string;
    source: "PUBLIC" | "INTERNAL" | "SCHEDULED" | "SYSTEM";
    ipHash?: string;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO audit_logs
      (id, user_id, action, entity_type, entity_id, previous_value, new_value, correlation_id, reason, source, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.actor?.id ?? null,
    input.action,
    input.entityType,
    input.entityId,
    input.previousValue === undefined ? null : JSON.stringify(input.previousValue),
    input.newValue === undefined ? null : JSON.stringify(input.newValue),
    input.correlationId,
    input.reason ?? null,
    input.source,
    input.ipHash ?? null,
  ).run();
}

export async function changeStatus(
  db: D1Database,
  input: {
    complaintId: string;
    from: ComplaintStatus;
    to: ComplaintStatus;
    actor: Actor;
    reason: string;
    correlationId: string;
  },
): Promise<void> {
  const result = await db.prepare(
    `UPDATE complaints SET status = ?, public_status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP, last_action_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = ?`,
  ).bind(input.to, publicStatus(input.to), input.actor.id, input.complaintId, input.from).run();
  if ((result.meta.changes ?? 0) !== 1) throw new Error("CONCURRENT_CASE_UPDATE");
  await db.batch([
    db.prepare(
      "INSERT INTO status_history (id, complaint_id, from_status, to_status, changed_by, reason) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), input.complaintId, input.from, input.to, input.actor.id, input.reason),
    db.prepare(
      `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, previous_value, new_value, correlation_id, reason, source)
       VALUES (?, ?, 'STATUS_CHANGED', 'complaint', ?, ?, ?, ?, ?, 'INTERNAL')`,
    ).bind(
      crypto.randomUUID(), input.actor.id, input.complaintId,
      JSON.stringify({ status: input.from }), JSON.stringify({ status: input.to }), input.correlationId, input.reason,
    ),
  ]);
}

function publicStatus(status: ComplaintStatus): string {
  if (["New", "Acknowledged"].includes(status)) return "Received";
  if (["Preliminary Assessment", "Pending Information", "Pending Assignment"].includes(status)) return "Under assessment";
  if (status === "Closed") return "Completed";
  return "In progress";
}

export async function complaintByCaseId(db: D1Database, caseId: string): Promise<any | null> {
  return db.prepare(
    `SELECT c.*, cc.name AS category_name,
      (SELECT u.display_name FROM complaint_assignments ca JOIN users u ON u.id = ca.user_id
       WHERE ca.complaint_id = c.id AND ca.assignment_type = 'PRIMARY' AND ca.ended_at IS NULL LIMIT 1) AS assigned_officer
     FROM complaints c LEFT JOIN complaint_categories cc ON cc.id = c.category_id
     WHERE c.case_id = ? AND c.deleted_at IS NULL`,
  ).bind(caseId).first();
}
