import { Hono } from "hono";
import { z } from "zod";
import type { ComplaintStatus, RoleCode } from "../../shared/constants";
import type { AppBindings } from "../types";
import { csrfToken } from "../auth";
import { audit, changeStatus, complaintByCaseId } from "../db";
import { notify } from "../notifications";
import { assertNotReadOnly, assertRole, canAccessCase, caseListScope } from "../permissions";
import { safeFilename, sha256, validateFileSignature, validateUpload } from "../security";
import { assertTransition, calculateRisk, triageTarget } from "../workflow";
import {
  activitySchema,
  approvalSchema,
  assessmentSchema,
  assignmentSchema,
  closureSchema,
  correctiveActionSchema,
  findingSchema,
  reopenSchema,
  userSchema,
} from "../validation";

export const internalApi = new Hono<AppBindings>();

function envelope<T>(context: any, data: T) {
  return { data, correlationId: context.get("correlationId") as string };
}

async function requireCase(context: any, caseId: string): Promise<any> {
  const complaint = await complaintByCaseId(context.env.DB, caseId);
  if (!complaint) throw new Error("NOT_FOUND");
  if (!(await canAccessCase(context.env.DB, context.get("actor"), complaint.id))) throw new Error("FORBIDDEN");
  return complaint;
}

internalApi.get("/me", async (context) => {
  const actor = context.get("actor");
  return context.json(envelope(context, { ...actor, csrfToken: await csrfToken(actor.email, context.env.CSRF_SECRET) }));
});

internalApi.get("/dashboard", async (context) => {
  const actor = context.get("actor");
  const scope = caseListScope(actor);
  const base = `FROM complaints c WHERE c.deleted_at IS NULL AND ${scope.clause}`;
  const [metrics, byStatus, byRisk, byCategory, monthlyTrend] = await Promise.all([
    context.env.DB.prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN c.status = 'New' OR date(c.created_at) = date('now') THEN 1 ELSE 0 END) AS new_count,
        SUM(CASE WHEN c.status NOT IN ('Closed', 'Referred') THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN c.status = 'Closed' THEN 1 ELSE 0 END) AS closed_count,
        SUM(CASE WHEN c.sla_due_at < CURRENT_TIMESTAMP AND c.status NOT IN ('Closed', 'Referred') THEN 1 ELSE 0 END) AS overdue_count,
        SUM(CASE WHEN c.risk_rating IN ('Critical', 'High') AND c.status <> 'Closed' THEN 1 ELSE 0 END) AS high_risk_count,
        SUM(CASE WHEN c.status = 'Preliminary Assessment' THEN 1 ELSE 0 END) AS awaiting_assessment,
        SUM(CASE WHEN c.status IN ('Pending Review', 'Pending Management Decision') THEN 1 ELSE 0 END) AS awaiting_approval,
        ROUND(AVG(CASE WHEN c.closed_at IS NOT NULL THEN julianday(c.closed_at) - julianday(c.created_at) END), 1) AS average_days_to_close,
        ROUND(100.0 * SUM(CASE WHEN c.closed_at IS NOT NULL AND (c.sla_due_at IS NULL OR c.closed_at <= c.sla_due_at) THEN 1 ELSE 0 END)
          / NULLIF(SUM(CASE WHEN c.closed_at IS NOT NULL THEN 1 ELSE 0 END), 0), 1) AS sla_compliance
       ${base}`,
    ).bind(...scope.values).first(),
    context.env.DB.prepare(`SELECT c.status AS label, COUNT(*) AS value ${base} GROUP BY c.status ORDER BY value DESC`).bind(...scope.values).all(),
    context.env.DB.prepare(`SELECT c.risk_rating AS label, COUNT(*) AS value ${base} GROUP BY c.risk_rating ORDER BY value DESC`).bind(...scope.values).all(),
    context.env.DB.prepare(
      `SELECT cc.name AS label, COUNT(*) AS value FROM complaints c JOIN complaint_categories cc ON cc.id = c.category_id
       WHERE c.deleted_at IS NULL AND ${scope.clause} GROUP BY cc.name ORDER BY value DESC LIMIT 10`,
    ).bind(...scope.values).all(),
    context.env.DB.prepare(
      `SELECT strftime('%Y-%m', c.created_at) AS label, COUNT(*) AS value ${base}
       AND c.created_at >= date('now', '-11 months') GROUP BY label ORDER BY label`,
    ).bind(...scope.values).all(),
  ]);
  const metricRow = (metrics ?? {}) as Record<string, number | null>;
  return context.json(envelope(context, {
    metrics: {
      totalComplaints: metricRow.total ?? 0,
      newComplaints: metricRow.new_count ?? 0,
      openCases: metricRow.open_count ?? 0,
      closedCases: metricRow.closed_count ?? 0,
      overdueCases: metricRow.overdue_count ?? 0,
      highRiskCases: metricRow.high_risk_count ?? 0,
      awaitingAssessment: metricRow.awaiting_assessment ?? 0,
      awaitingApproval: metricRow.awaiting_approval ?? 0,
      averageDaysToClose: metricRow.average_days_to_close ?? 0,
      slaCompliance: metricRow.sla_compliance ?? 0,
    },
    byStatus: byStatus.results,
    byRisk: byRisk.results,
    byCategory: byCategory.results,
    monthlyTrend: monthlyTrend.results,
  }));
});

internalApi.get("/cases", async (context) => {
  const actor = context.get("actor");
  const scope = caseListScope(actor);
  const query = context.req.query();
  const page = Math.max(1, Number(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Number(query.pageSize ?? 25)));
  const filters = [`c.deleted_at IS NULL`, scope.clause];
  const values: unknown[] = [...scope.values];
  for (const [parameter, column] of [["status", "c.status"], ["risk", "c.risk_rating"], ["category", "c.category_id"], ["department", "c.department"]] as const) {
    if (query[parameter]) { filters.push(`${column} = ?`); values.push(query[parameter]); }
  }
  if (query.search) {
    filters.push(`(c.case_id LIKE ? OR c.title LIKE ? OR c.summary LIKE ? OR c.department LIKE ? OR c.project LIKE ? OR c.location LIKE ? OR c.subject_details LIKE ?)`);
    const term = `%${query.search.slice(0, 100)}%`;
    values.push(...Array(7).fill(term));
  }
  const where = filters.join(" AND ");
  const [rows, count] = await Promise.all([
    context.env.DB.prepare(
      `SELECT c.id, c.case_id AS caseId, c.created_at AS dateReceived, c.title, cc.name AS category,
        c.department, c.risk_rating AS riskRating, c.status, c.sla_due_at AS slaDueAt,
        c.confidentiality, CASE WHEN c.sla_due_at < CURRENT_TIMESTAMP AND c.status NOT IN ('Closed','Referred') THEN 1 ELSE 0 END AS isOverdue,
        (SELECT u.display_name FROM complaint_assignments ca JOIN users u ON u.id = ca.user_id
         WHERE ca.complaint_id = c.id AND ca.assignment_type = 'PRIMARY' AND ca.ended_at IS NULL LIMIT 1) AS assignedOfficer
       FROM complaints c JOIN complaint_categories cc ON cc.id = c.category_id
       WHERE ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...values, pageSize, (page - 1) * pageSize).all(),
    context.env.DB.prepare(`SELECT COUNT(*) AS total FROM complaints c WHERE ${where}`).bind(...values).first<{ total: number }>(),
  ]);
  return context.json(envelope(context, { items: rows.results, total: count?.total ?? 0, page, pageSize }));
});

internalApi.get("/cases/:caseId", async (context) => {
  const complaint = await requireCase(context, context.req.param("caseId"));
  await audit(context.env.DB, {
    actor: context.get("actor"), action: "COMPLAINT_VIEWED", entityType: "complaint", entityId: complaint.id,
    correlationId: context.get("correlationId"), source: "INTERNAL",
  });
  const [complainant, subjects, assessments, assignments, activities, findings, attachments, approvals, actions, relationships, communications, history] = await Promise.all([
    context.env.DB.prepare("SELECT full_name, email, telephone, organisation, preferred_communication FROM complainants WHERE complaint_id = ?").bind(complaint.id).first(),
    context.env.DB.prepare("SELECT * FROM complaint_subjects WHERE complaint_id = ? ORDER BY created_at").bind(complaint.id).all(),
    context.env.DB.prepare("SELECT * FROM preliminary_assessments WHERE complaint_id = ? ORDER BY version DESC").bind(complaint.id).all(),
    context.env.DB.prepare("SELECT ca.*, u.display_name, u.email FROM complaint_assignments ca JOIN users u ON u.id = ca.user_id WHERE ca.complaint_id = ? ORDER BY ca.assigned_at DESC").bind(complaint.id).all(),
    context.env.DB.prepare("SELECT ia.*, u.display_name AS officer_name FROM investigation_activities ia JOIN users u ON u.id = ia.officer_id WHERE ia.complaint_id = ? AND ia.deleted_at IS NULL ORDER BY ia.occurred_at DESC").bind(complaint.id).all(),
    context.env.DB.prepare("SELECT * FROM investigation_findings WHERE complaint_id = ? ORDER BY version DESC").bind(complaint.id).all(),
    context.env.DB.prepare("SELECT id, original_filename, content_type, file_size, checksum_sha256, classification, source, verification_status, malware_scan_status, uploaded_at FROM attachments WHERE complaint_id = ? AND deleted_at IS NULL ORDER BY uploaded_at DESC").bind(complaint.id).all(),
    context.env.DB.prepare("SELECT a.*, u.display_name AS approver_name FROM approvals a JOIN users u ON u.id = a.approver_id WHERE a.complaint_id = ? ORDER BY a.decided_at DESC").bind(complaint.id).all(),
    context.env.DB.prepare("SELECT ca.*, u.display_name AS owner_name FROM corrective_actions ca JOIN users u ON u.id = ca.action_owner_id WHERE ca.complaint_id = ? AND ca.deleted_at IS NULL ORDER BY ca.created_at DESC").bind(complaint.id).all(),
    context.env.DB.prepare("SELECT * FROM case_relationships WHERE complaint_id = ? ORDER BY created_at DESC").bind(complaint.id).all(),
    context.env.DB.prepare("SELECT * FROM communications WHERE complaint_id = ? ORDER BY created_at DESC").bind(complaint.id).all(),
    context.env.DB.prepare("SELECT sh.*, u.display_name AS changed_by_name FROM status_history sh LEFT JOIN users u ON u.id = sh.changed_by WHERE sh.complaint_id = ? ORDER BY sh.changed_at DESC").bind(complaint.id).all(),
  ]);
  return context.json(envelope(context, {
    complaint, complainant, subjects: subjects.results, assessments: assessments.results, assignments: assignments.results,
    activities: activities.results, findings: findings.results, attachments: attachments.results, approvals: approvals.results,
    correctiveActions: actions.results, relationships: relationships.results, communications: communications.results, history: history.results,
  }));
});

internalApi.post("/cases/:caseId/assessment", async (context) => {
  const actor = context.get("actor");
  assertNotReadOnly(actor);
  assertRole(actor, ["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR", "INTEGRITY_OFFICER"]);
  const complaint = await requireCase(context, context.req.param("caseId"));
  if (complaint.status !== "Preliminary Assessment") throw new Error("INVALID_STATE");
  const data = assessmentSchema.parse(await context.req.json());
  if (data.assessorConflict) throw new Error("CONFLICT_OF_INTEREST");
  const allegationTypes = [
    data.briberyCorruption && "Bribery / corruption", data.fraud && "Fraud", data.misconduct && "Misconduct",
    data.procurementIrregularities && "Procurement irregularity",
  ].filter(Boolean) as string[];
  const risk = calculateRisk({
    allegationTypes, seniorManagement: data.seniorManagementInvolved,
    financialImpact: Number(complaint.estimated_financial_impact ?? 0), legalExposure: data.immediateRisk,
    reputationalImpact: data.immediateRisk, evidenceTamperingRisk: data.evidenceDestructionRisk,
    systemic: data.existingRelatedCase, publicInterest: data.seniorManagementInvolved, urgent: data.immediateRisk,
  });
  const target = triageTarget(data.decision);
  assertTransition(complaint.status as ComplaintStatus, target);
  const version = (await context.env.DB.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM preliminary_assessments WHERE complaint_id = ?").bind(complaint.id).first<{ version: number }>())?.version ?? 1;
  await context.env.DB.prepare(
    `INSERT INTO preliminary_assessments
      (id, complaint_id, version, within_jurisdiction, information_sufficient, duplicate_complaint, existing_related_case,
       bribery_corruption, fraud, misconduct, conflict_of_interest, abuse_of_power, procurement_irregularities,
       senior_management_involved, evidence_destruction_risk, immediate_risk, assessor_conflict,
       recommended_risk, decision, decision_reason, remarks, related_case_id, assessed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), complaint.id, version, Number(data.withinJurisdiction), Number(data.informationSufficient),
    Number(data.duplicateComplaint), Number(data.existingRelatedCase), Number(data.briberyCorruption), Number(data.fraud),
    Number(data.misconduct), Number(data.conflictOfInterest), Number(data.abuseOfPower), Number(data.procurementIrregularities),
    Number(data.seniorManagementInvolved), Number(data.evidenceDestructionRisk), Number(data.immediateRisk), 0,
    data.recommendedRisk, data.decision, data.reason, data.remarks, data.relatedCaseId ?? null, actor.id,
  ).run();
  await context.env.DB.prepare("UPDATE complaints SET risk_rating = ?, risk_score = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(data.recommendedRisk || risk.rating, risk.score, actor.id, complaint.id).run();
  await changeStatus(context.env.DB, { complaintId: complaint.id, from: complaint.status, to: target, actor, reason: data.reason, correlationId: context.get("correlationId") });
  return context.json(envelope(context, { status: target, riskRating: data.recommendedRisk, calculatedRiskScore: risk.score }), 201);
});

internalApi.post("/cases/:caseId/assignments", async (context) => {
  const actor = context.get("actor");
  assertNotReadOnly(actor);
  assertRole(actor, ["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR", "REVIEWER"]);
  const complaint = await requireCase(context, context.req.param("caseId"));
  if (!(["Pending Assignment", "Investigation Ongoing", "Reopened"] as string[]).includes(complaint.status)) throw new Error("INVALID_STATE");
  const data = assignmentSchema.parse(await context.req.json());
  const primary = await context.env.DB.prepare(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE u.id = ? AND u.active = 1 AND r.code IN ('CASE_OFFICER','INTEGRITY_OFFICER')`,
  ).bind(data.primaryOfficerId).first();
  if (!primary) throw new Error("INVALID_ASSIGNEE");
  const reviewer = await context.env.DB.prepare(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE u.active = 1 AND r.code = 'REVIEWER' ORDER BY u.display_name LIMIT 1`,
  ).first<{ id: string }>();
  await context.env.DB.prepare(
    "UPDATE complaint_assignments SET ended_at = CURRENT_TIMESTAMP, end_reason = ? WHERE complaint_id = ? AND ended_at IS NULL",
  ).bind(data.reason, complaint.id).run();
  const statements = [
    context.env.DB.prepare(
      `INSERT INTO complaint_assignments
        (id, complaint_id, user_id, reviewer_id, assignment_type, scope, instructions, assigned_by)
       VALUES (?, ?, ?, ?, 'PRIMARY', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), complaint.id, data.primaryOfficerId, reviewer?.id ?? null, data.scope, data.instructions, actor.id),
    ...data.supportingOfficerIds.map((supportingOfficerId) =>
      context.env.DB.prepare(
        "INSERT INTO complaint_assignments (id, complaint_id, user_id, reviewer_id, assignment_type, scope, instructions, assigned_by) VALUES (?, ?, ?, ?, 'SUPPORTING', ?, ?, ?)",
      ).bind(crypto.randomUUID(), complaint.id, supportingOfficerId, reviewer?.id ?? null, data.scope, data.instructions, actor.id),
    ),
  ];
  await context.env.DB.batch(statements);
  await context.env.DB.prepare(
    "UPDATE complaints SET investigation_due_at = ?, priority = ?, next_action = 'Commence investigation', next_action_due_at = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(data.dueDate, data.priority, data.dueDate, actor.id, complaint.id).run();
  if (complaint.status === "Pending Assignment" || complaint.status === "Reopened") {
    assertTransition(complaint.status as ComplaintStatus, "Investigation Ongoing");
    await changeStatus(context.env.DB, {
      complaintId: complaint.id, from: complaint.status, to: "Investigation Ongoing", actor,
      reason: data.reason, correlationId: context.get("correlationId"),
    });
  }
  await audit(context.env.DB, {
    actor, action: complaint.assigned_officer ? "CASE_REASSIGNED" : "CASE_ASSIGNED",
    entityType: "complaint", entityId: complaint.id, newValue: data,
    correlationId: context.get("correlationId"), reason: data.reason, source: "INTERNAL",
  });
  await notify(context.env, {
    eventType: "CASE_ASSIGNED", subject: "Case assigned: " + complaint.case_id,
    body: "You have been assigned as primary case officer.", userId: data.primaryOfficerId,
    complaintId: complaint.id, actionUrl: "/portal/cases/" + complaint.case_id,
    idempotencyKey: "assignment:" + complaint.id + ":" + data.primaryOfficerId + ":" + Date.now(),
  });
  return context.json(envelope(context, { status: "Investigation Ongoing" }), 201);
});

internalApi.post("/cases/:caseId/activities", async (context) => {
  const actor = context.get("actor");
  assertNotReadOnly(actor);
  assertRole(actor, ["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR", "INTEGRITY_OFFICER", "CASE_OFFICER"]);
  const complaint = await requireCase(context, context.req.param("caseId"));
  if (!(["Investigation Ongoing", "Returned for Amendment", "Reopened"] as string[]).includes(complaint.status)) throw new Error("INVALID_STATE");
  const data = activitySchema.parse(await context.req.json());
  const id = crypto.randomUUID();
  await context.env.DB.prepare(
    "INSERT INTO investigation_activities (id, complaint_id, activity_type, occurred_at, officer_id, description, next_action, next_action_due_at, attachment_references, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, complaint.id, data.activityType, data.occurredAt, actor.id, data.description, data.nextAction ?? null, data.nextActionDueAt ?? null, JSON.stringify(data.attachmentIds), data.visibility).run();
  await context.env.DB.prepare(
    "UPDATE complaints SET last_action_at = CURRENT_TIMESTAMP, next_action = ?, next_action_due_at = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(data.nextAction ?? null, data.nextActionDueAt ?? null, actor.id, complaint.id).run();
  await audit(context.env.DB, {
    actor, action: "INVESTIGATION_ACTIVITY_ADDED", entityType: "investigation_activity", entityId: id,
    newValue: data, correlationId: context.get("correlationId"), source: "INTERNAL",
  });
  return context.json(envelope(context, { id }), 201);
});

internalApi.post("/cases/:caseId/evidence", async (context) => {
  const actor = context.get("actor");
  assertNotReadOnly(actor);
  assertRole(actor, ["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR", "INTEGRITY_OFFICER", "CASE_OFFICER"]);
  const complaint = await requireCase(context, context.req.param("caseId"));
  const form = await context.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("FILE_REQUIRED");
  const classification = String(form.get("classification") ?? "Confidential");
  if (!(["Restricted", "Confidential", "Internal", "General"] as string[]).includes(classification)) throw new Error("INVALID_CLASSIFICATION");
  const validation = validateUpload(file, Number(context.env.MAX_UPLOAD_BYTES));
  if (!validation.ok) throw new Error(validation.reason);
  const buffer = await file.arrayBuffer();
  if (!validateFileSignature(buffer, file.type)) throw new Error("FILE_SIGNATURE_MISMATCH");
  const checksum = await sha256(buffer);
  const id = crypto.randomUUID();
  const objectKey = "internal/" + complaint.id + "/" + crypto.randomUUID();
  await context.env.EVIDENCE.put(objectKey, buffer, {
    httpMetadata: { contentType: file.type },
    customMetadata: { attachmentId: id, caseId: complaint.case_id, originalFilename: validation.filename },
  });
  await context.env.DB.prepare(
    "INSERT INTO attachments (id, complaint_id, object_key, original_filename, content_type, file_size, checksum_sha256, classification, source, uploader_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INTERNAL_EVIDENCE', ?)",
  ).bind(id, complaint.id, objectKey, validation.filename, file.type, file.size, checksum, classification, actor.id).run();
  await audit(context.env.DB, {
    actor, action: "EVIDENCE_UPLOADED", entityType: "attachment", entityId: id,
    newValue: { filename: validation.filename, size: file.size, checksum, classification },
    correlationId: context.get("correlationId"), source: "INTERNAL",
  });
  return context.json(envelope(context, { id, checksum }), 201);
});

internalApi.get("/evidence/:attachmentId/download", async (context) => {
  const actor = context.get("actor");
  const attachment = await context.env.DB.prepare(
    "SELECT a.*, c.case_id FROM attachments a JOIN complaints c ON c.id = a.complaint_id WHERE a.id = ? AND a.deleted_at IS NULL",
  ).bind(context.req.param("attachmentId")).first<any>();
  if (!attachment) throw new Error("NOT_FOUND");
  if (!(await canAccessCase(context.env.DB, actor, attachment.complaint_id))) throw new Error("FORBIDDEN");
  const object = await context.env.EVIDENCE.get(attachment.object_key);
  if (!object) throw new Error("NOT_FOUND");
  await audit(context.env.DB, {
    actor, action: "EVIDENCE_DOWNLOADED", entityType: "attachment", entityId: attachment.id,
    correlationId: context.get("correlationId"), source: "INTERNAL",
  });
  const filename = safeFilename(attachment.original_filename);
  return new Response(object.body, {
    headers: {
      "Content-Type": attachment.content_type,
      "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

internalApi.delete("/evidence/:attachmentId", async (context) => {
  const actor = context.get("actor");
  assertRole(actor, ["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR"]);
  const data = z.object({ reason: z.string().trim().min(2).max(1000) }).parse(await context.req.json());
  const attachment = await context.env.DB.prepare(
    "SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL",
  ).bind(context.req.param("attachmentId")).first<any>();
  if (!attachment) throw new Error("NOT_FOUND");
  if (!(await canAccessCase(context.env.DB, actor, attachment.complaint_id))) throw new Error("FORBIDDEN");
  await context.env.DB.prepare(
    "UPDATE attachments SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, deletion_reason = ? WHERE id = ? AND deleted_at IS NULL",
  ).bind(actor.id, data.reason, attachment.id).run();
  await context.env.EVIDENCE.delete(attachment.object_key);
  await audit(context.env.DB, {
    actor, action: "EVIDENCE_DELETED", entityType: "attachment", entityId: attachment.id,
    correlationId: context.get("correlationId"), reason: data.reason, source: "INTERNAL",
  });
  return context.json(envelope(context, { deleted: true }));
});

internalApi.post("/cases/:caseId/findings", async (context) => {
  const actor = context.get("actor");
  assertNotReadOnly(actor);
  assertRole(actor, ["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR", "INTEGRITY_OFFICER", "CASE_OFFICER"]);
  const complaint = await requireCase(context, context.req.param("caseId"));
  if (!(["Investigation Ongoing", "Returned for Amendment"] as string[]).includes(complaint.status)) throw new Error("INVALID_STATE");
  const data = findingSchema.parse(await context.req.json());
  const version = (await context.env.DB.prepare(
    "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM investigation_findings WHERE complaint_id = ?",
  ).bind(complaint.id).first<{ version: number }>())?.version ?? 1;
  const findingId = crypto.randomUUID();
  const approvalVersionId = crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare(
      "INSERT INTO investigation_findings (id, complaint_id, version, allegations, analysis, findings, recommendations, outcome, status, created_by, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, CURRENT_TIMESTAMP)",
    ).bind(findingId, complaint.id, version, data.allegations, data.analysis, data.findings, data.recommendations, data.outcome, actor.id),
    context.env.DB.prepare(
      "INSERT INTO approval_versions (id, complaint_id, finding_id, version, snapshot, created_by) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(approvalVersionId, complaint.id, findingId, version, JSON.stringify(data), actor.id),
  ]);
  assertTransition(complaint.status as ComplaintStatus, "Pending Review");
  await changeStatus(context.env.DB, {
    complaintId: complaint.id, from: complaint.status, to: "Pending Review", actor,
    reason: "Investigation findings version " + version + " submitted for review.",
    correlationId: context.get("correlationId"),
  });
  await audit(context.env.DB, {
    actor, action: "FINDINGS_SUBMITTED", entityType: "investigation_finding", entityId: findingId,
    newValue: { version, outcome: data.outcome }, correlationId: context.get("correlationId"), source: "INTERNAL",
  });
  const reviewer = await context.env.DB.prepare(
    "SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE u.active = 1 AND r.code = 'REVIEWER' ORDER BY u.display_name LIMIT 1",
  ).first<{ id: string }>();
  if (reviewer) await notify(context.env, {
    eventType: "APPROVAL_REQUESTED", subject: "Review requested: " + complaint.case_id,
    body: "Investigation findings version " + version + " require review.", userId: reviewer.id,
    complaintId: complaint.id, actionUrl: "/portal/cases/" + complaint.case_id,
    idempotencyKey: "review:" + complaint.id + ":" + version,
  });
  return context.json(envelope(context, { findingId, version }), 201);
});

internalApi.post("/cases/:caseId/approvals", async (context) => {
  const actor = context.get("actor");
  assertNotReadOnly(actor);
  const complaint = await requireCase(context, context.req.param("caseId"));
  const data = approvalSchema.parse(await context.req.json());
  const reviewerStage = complaint.status === "Pending Review";
  const managementStage = complaint.status === "Pending Management Decision";
  if (!reviewerStage && !managementStage) throw new Error("INVALID_STATE");
  if (reviewerStage) assertRole(actor, ["SYSTEM_ADMINISTRATOR", "REVIEWER"]);
  if (managementStage) assertRole(actor, ["SYSTEM_ADMINISTRATOR", "MANAGEMENT_APPROVER"]);
  const approvalVersion = await context.env.DB.prepare(
    "SELECT av.id, av.finding_id FROM approval_versions av WHERE av.complaint_id = ? AND av.version = ?",
  ).bind(complaint.id, data.version).first<{ id: string; finding_id: string }>();
  if (!approvalVersion) throw new Error("FINDING_VERSION_NOT_FOUND");
  const stage = reviewerStage ? "REVIEWER" : "MANAGEMENT";
  const id = crypto.randomUUID();
  await context.env.DB.prepare(
    "INSERT INTO approvals (id, complaint_id, approval_version_id, stage, sequence_number, approver_id, approver_role, decision, remarks, returned_to_user_id, subsequent_action) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)",
  ).bind(id, complaint.id, approvalVersion.id, stage, actor.id, stage, data.decision, data.remarks, data.returnedToUserId ?? null, data.subsequentAction ?? null).run();
  let target: ComplaintStatus;
  if (data.decision === "Return for amendment" || data.decision === "Request further investigation") {
    target = "Returned for Amendment";
    await context.env.DB.prepare("UPDATE investigation_findings SET status = 'RETURNED' WHERE id = ?").bind(approvalVersion.finding_id).run();
  } else if (reviewerStage) {
    target = "Pending Management Decision";
  } else if (data.decision === "Refer") {
    target = "Referred";
    await context.env.DB.prepare("UPDATE investigation_findings SET status = 'APPROVED' WHERE id = ?").bind(approvalVersion.finding_id).run();
  } else {
    target = "Outcome Communication Pending";
    await context.env.DB.prepare("UPDATE investigation_findings SET status = 'APPROVED' WHERE id = ?").bind(approvalVersion.finding_id).run();
  }
  assertTransition(complaint.status as ComplaintStatus, target);
  await changeStatus(context.env.DB, {
    complaintId: complaint.id, from: complaint.status, to: target, actor,
    reason: stage + " decision: " + data.decision + ". " + data.remarks,
    correlationId: context.get("correlationId"),
  });
  await audit(context.env.DB, {
    actor, action: "APPROVAL_DECISION_RECORDED", entityType: "approval", entityId: id,
    newValue: { stage, decision: data.decision, version: data.version },
    correlationId: context.get("correlationId"), reason: data.remarks, source: "INTERNAL",
  });
  return context.json(envelope(context, { id, status: target }), 201);
});

internalApi.post("/cases/:caseId/corrective-actions", async (context) => {
  const actor = context.get("actor");
  assertNotReadOnly(actor);
  assertRole(actor, ["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR", "INTEGRITY_OFFICER", "REVIEWER", "MANAGEMENT_APPROVER"]);
  const complaint = await requireCase(context, context.req.param("caseId"));
  const data = correctiveActionSchema.parse(await context.req.json());
  const owner = await context.env.DB.prepare("SELECT id FROM users WHERE id = ? AND active = 1").bind(data.actionOwnerId).first();
  if (!owner) throw new Error("INVALID_ACTION_OWNER");
  const id = crypto.randomUUID();
  const actionId = "ACT-" + complaint.case_id.slice(4) + "-" + crypto.randomUUID().slice(0, 6).toUpperCase();
  await context.env.DB.prepare(
    "INSERT INTO corrective_actions (id, action_id, complaint_id, recommendation, action_owner_id, responsible_department, priority, target_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, actionId, complaint.id, data.recommendation, data.actionOwnerId, data.responsibleDepartment, data.priority, data.targetDate, actor.id).run();
  await audit(context.env.DB, {
    actor, action: "CORRECTIVE_ACTION_CREATED", entityType: "corrective_action", entityId: id,
    newValue: data, correlationId: context.get("correlationId"), source: "INTERNAL",
  });
  await notify(context.env, {
    eventType: "CORRECTIVE_ACTION_ASSIGNED", subject: "Corrective action assigned: " + actionId,
    body: data.recommendation, userId: data.actionOwnerId, complaintId: complaint.id,
    actionUrl: "/portal/actions", idempotencyKey: "action:" + id,
  });
  return context.json(envelope(context, { id, actionId }), 201);
});

internalApi.get("/corrective-actions", async (context) => {
  const actor = context.get("actor");
  const scope = caseListScope(actor);
  const rows = await context.env.DB.prepare(
    "SELECT ca.*, c.case_id, c.title AS case_title, u.display_name AS owner_name, CASE WHEN ca.target_date < date('now') AND ca.status NOT IN ('Completed','Closed','Rejected') THEN 1 ELSE 0 END AS is_overdue FROM corrective_actions ca JOIN complaints c ON c.id = ca.complaint_id JOIN users u ON u.id = ca.action_owner_id WHERE ca.deleted_at IS NULL AND " + scope.clause + " ORDER BY is_overdue DESC, ca.target_date",
  ).bind(...scope.values).all();
  return context.json(envelope(context, rows.results));
});

internalApi.patch("/corrective-actions/:actionId", async (context) => {
  const actor = context.get("actor");
  assertNotReadOnly(actor);
  const data = z.object({
    status: z.enum(["Open", "In Progress", "Pending Evidence", "Pending Verification", "Overdue", "Completed", "Closed", "Rejected"]),
    progressUpdate: z.string().trim().min(2).max(5000),
  }).parse(await context.req.json());
  const action = await context.env.DB.prepare(
    "SELECT ca.*, c.case_id FROM corrective_actions ca JOIN complaints c ON c.id = ca.complaint_id WHERE ca.action_id = ? AND ca.deleted_at IS NULL",
  ).bind(context.req.param("actionId")).first<any>();
  if (!action) throw new Error("NOT_FOUND");
  const privileged = actor.roles.some((role) => (["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR", "INTEGRITY_OFFICER"] as RoleCode[]).includes(role));
  if (action.action_owner_id !== actor.id && !privileged) throw new Error("FORBIDDEN");
  if (!(await canAccessCase(context.env.DB, actor, action.complaint_id))) throw new Error("FORBIDDEN");
  await context.env.DB.batch([
    context.env.DB.prepare(
      "UPDATE corrective_actions SET status = ?, progress_update = ?, completion_date = CASE WHEN ? = 'Completed' THEN CURRENT_TIMESTAMP ELSE completion_date END, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(data.status, data.progressUpdate, data.status, action.id),
    context.env.DB.prepare(
      "INSERT INTO corrective_action_updates (id, corrective_action_id, status, progress_update, updated_by) VALUES (?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), action.id, data.status, data.progressUpdate, actor.id),
  ]);
  await audit(context.env.DB, {
    actor, action: "CORRECTIVE_ACTION_UPDATED", entityType: "corrective_action", entityId: action.id,
    previousValue: { status: action.status }, newValue: data,
    correlationId: context.get("correlationId"), reason: data.progressUpdate, source: "INTERNAL",
  });
  return context.json(envelope(context, { status: data.status }));
});

internalApi.post("/corrective-actions/:actionId/verify", async (context) => {
  const actor = context.get("actor");
  assertRole(actor, ["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR", "INTEGRITY_OFFICER", "REVIEWER"]);
  const data = z.object({
    decision: z.enum(["Approve", "Reject"]),
    remarks: z.string().trim().min(2).max(5000),
  }).parse(await context.req.json());
  const action = await context.env.DB.prepare(
    "SELECT * FROM corrective_actions WHERE action_id = ? AND deleted_at IS NULL",
  ).bind(context.req.param("actionId")).first<any>();
  if (!action) throw new Error("NOT_FOUND");
  if (action.action_owner_id === actor.id) throw new Error("SELF_VERIFICATION_NOT_ALLOWED");
  if (action.status !== "Pending Verification") throw new Error("INVALID_STATE");
  if (!(await canAccessCase(context.env.DB, actor, action.complaint_id))) throw new Error("FORBIDDEN");
  const status = data.decision === "Approve" ? "Completed" : "Rejected";
  await context.env.DB.prepare(
    "UPDATE corrective_actions SET status = ?, integrity_verifier_id = ?, verification_remarks = ?, verified_at = CURRENT_TIMESTAMP, completion_date = CASE WHEN ? = 'Completed' THEN CURRENT_TIMESTAMP ELSE completion_date END, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(status, actor.id, data.remarks, status, action.id).run();
  await audit(context.env.DB, {
    actor, action: "CORRECTIVE_ACTION_VERIFIED", entityType: "corrective_action", entityId: action.id,
    newValue: { status, decision: data.decision }, correlationId: context.get("correlationId"),
    reason: data.remarks, source: "INTERNAL",
  });
  return context.json(envelope(context, { status }));
});

internalApi.post("/cases/:caseId/communications", async (context) => {
  const actor = context.get("actor");
  assertNotReadOnly(actor);
  const complaint = await requireCase(context, context.req.param("caseId"));
  const data = z.object({
    type: z.string().trim().min(2).max(100),
    channel: z.string().trim().min(2).max(100),
    recipient: z.string().trim().max(500).optional(),
    summary: z.string().trim().min(2).max(5000),
    completed: z.boolean().default(false),
  }).parse(await context.req.json());
  const id = crypto.randomUUID();
  await context.env.DB.prepare(
    "INSERT INTO communications (id, complaint_id, communication_type, direction, channel, recipient, summary, status, created_by, completed_at) VALUES (?, ?, ?, 'OUTBOUND', ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END)",
  ).bind(id, complaint.id, data.type, data.channel, data.recipient ?? null, data.summary, data.completed ? "COMPLETED" : "DRAFT", actor.id, Number(data.completed)).run();
  await audit(context.env.DB, {
    actor, action: "COMMUNICATION_RECORDED", entityType: "communication", entityId: id,
    newValue: data, correlationId: context.get("correlationId"), source: "INTERNAL",
  });
  return context.json(envelope(context, { id }), 201);
});

internalApi.post("/cases/:caseId/close", async (context) => {
  const actor = context.get("actor");
  assertRole(actor, ["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR", "REVIEWER", "MANAGEMENT_APPROVER"]);
  const complaint = await requireCase(context, context.req.param("caseId"));
  if (!(["Outcome Communication Pending", "Corrective Action Monitoring", "Referred"] as string[]).includes(complaint.status)) throw new Error("INVALID_STATE");
  const data = closureSchema.parse(await context.req.json());
  if (!data.communicationCompleted) throw new Error("COMMUNICATION_REQUIRED");
  const finding = await context.env.DB.prepare("SELECT id FROM investigation_findings WHERE complaint_id = ? AND status = 'APPROVED' LIMIT 1").bind(complaint.id).first();
  const approval = await context.env.DB.prepare("SELECT id FROM approvals WHERE complaint_id = ? AND stage = 'MANAGEMENT' AND decision IN ('Approve','Close with no further action') LIMIT 1").bind(complaint.id).first();
  if (complaint.status !== "Referred" && (!finding || !approval)) throw new Error("FINAL_APPROVAL_REQUIRED");
  const openActions = await context.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM corrective_actions WHERE complaint_id = ? AND deleted_at IS NULL AND status NOT IN ('Completed','Closed','Rejected')",
  ).bind(complaint.id).first<{ total: number }>();
  if ((openActions?.total ?? 0) > 0 && !data.transferOpenActions) throw new Error("OUTSTANDING_CORRECTIVE_ACTIONS");
  if (data.transferOpenActions) await context.env.DB.prepare(
    "UPDATE corrective_actions SET monitoring_transferred = 1, updated_at = CURRENT_TIMESTAMP WHERE complaint_id = ? AND status NOT IN ('Completed','Closed','Rejected')",
  ).bind(complaint.id).run();
  await context.env.DB.prepare(
    "UPDATE complaints SET investigation_outcome = ?, closure_reason = ?, closed_at = CURRENT_TIMESTAMP, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(data.outcome, data.reason, actor.id, complaint.id).run();
  assertTransition(complaint.status as ComplaintStatus, "Closed");
  await changeStatus(context.env.DB, {
    complaintId: complaint.id, from: complaint.status, to: "Closed", actor,
    reason: data.reason, correlationId: context.get("correlationId"),
  });
  await audit(context.env.DB, {
    actor, action: "CASE_CLOSED", entityType: "complaint", entityId: complaint.id,
    newValue: { outcome: data.outcome }, correlationId: context.get("correlationId"),
    reason: data.reason, source: "INTERNAL",
  });
  return context.json(envelope(context, { status: "Closed" }));
});

internalApi.post("/cases/:caseId/reopen", async (context) => {
  const actor = context.get("actor");
  assertRole(actor, ["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR", "REVIEWER", "MANAGEMENT_APPROVER"]);
  const complaint = await requireCase(context, context.req.param("caseId"));
  if (complaint.status !== "Closed") throw new Error("INVALID_STATE");
  const data = reopenSchema.parse(await context.req.json());
  const authoriser = await context.env.DB.prepare(
    "SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE u.id = ? AND u.active = 1 AND r.code IN ('REVIEWER','MANAGEMENT_APPROVER','SYSTEM_ADMINISTRATOR')",
  ).bind(data.authorisingOfficerId).first();
  if (!authoriser) throw new Error("INVALID_AUTHORISING_OFFICER");
  await context.env.DB.prepare(
    "UPDATE complaints SET reopened_at = CURRENT_TIMESTAMP, closed_at = NULL, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(actor.id, complaint.id).run();
  assertTransition("Closed", "Reopened");
  await changeStatus(context.env.DB, {
    complaintId: complaint.id, from: "Closed", to: "Reopened", actor,
    reason: data.reason + " Authorised by " + data.authorisingOfficerId,
    correlationId: context.get("correlationId"),
  });
  await audit(context.env.DB, {
    actor, action: "CASE_REOPENED", entityType: "complaint", entityId: complaint.id,
    previousValue: { closedAt: complaint.closed_at }, newValue: { authorisingOfficerId: data.authorisingOfficerId },
    correlationId: context.get("correlationId"), reason: data.reason, source: "INTERNAL",
  });
  return context.json(envelope(context, { status: "Reopened" }));
});

internalApi.get("/approvals", async (context) => {
  const actor = context.get("actor");
  assertRole(actor, ["SYSTEM_ADMINISTRATOR", "REVIEWER", "MANAGEMENT_APPROVER", "INTEGRITY_ADMINISTRATOR", "AUDITOR"]);
  const scope = caseListScope(actor);
  const rows = await context.env.DB.prepare(
    "SELECT c.case_id, c.title, c.risk_rating, c.status, c.updated_at, MAX(f.version) AS version FROM complaints c JOIN investigation_findings f ON f.complaint_id = c.id WHERE c.status IN ('Pending Review','Pending Management Decision') AND " + scope.clause + " GROUP BY c.id ORDER BY c.updated_at",
  ).bind(...scope.values).all();
  return context.json(envelope(context, rows.results));
});

function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

internalApi.get("/reports/export.csv", async (context) => {
  const actor = context.get("actor");
  assertRole(actor, ["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR", "INTEGRITY_OFFICER", "REVIEWER", "MANAGEMENT_APPROVER", "AUDITOR"]);
  const scope = caseListScope(actor);
  const rows = await context.env.DB.prepare(
    "SELECT c.case_id, c.created_at, cc.name AS category, c.department, c.risk_rating, c.status, c.sla_due_at, c.investigation_outcome, c.closed_at FROM complaints c JOIN complaint_categories cc ON cc.id = c.category_id WHERE c.deleted_at IS NULL AND " + scope.clause + " ORDER BY c.created_at DESC",
  ).bind(...scope.values).all<any>();
  const headers = ["Case ID", "Date received", "Category", "Department", "Risk", "Status", "SLA due", "Outcome", "Closed"];
  const keys = ["case_id", "created_at", "category", "department", "risk_rating", "status", "sla_due_at", "investigation_outcome", "closed_at"];
  const csv = [headers.map(csvCell).join(","), ...rows.results.map((row) => keys.map((key) => csvCell(row[key])).join(","))].join("\r\n");
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="complaint-report.csv"', "Cache-Control": "private, no-store" },
  });
});

internalApi.get("/notifications", async (context) => {
  const actor = context.get("actor");
  const rows = await context.env.DB.prepare(
    "SELECT * FROM notifications WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC LIMIT 200",
  ).bind(actor.id).all();
  return context.json(envelope(context, rows.results));
});

internalApi.post("/notifications/:id/read", async (context) => {
  const actor = context.get("actor");
  await context.env.DB.prepare(
    "UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
  ).bind(context.req.param("id"), actor.id).run();
  return context.json(envelope(context, { read: true }));
});

internalApi.get("/users", async (context) => {
  const rows = await context.env.DB.prepare(
    "SELECT u.id, u.email, u.display_name, u.department, u.active, GROUP_CONCAT(r.code) AS roles FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id WHERE u.deleted_at IS NULL GROUP BY u.id ORDER BY u.display_name",
  ).all();
  return context.json(envelope(context, rows.results));
});

internalApi.post("/users", async (context) => {
  const actor = context.get("actor");
  assertRole(actor, ["SYSTEM_ADMINISTRATOR"]);
  const data = userSchema.parse(await context.req.json());
  const allowedRoles: RoleCode[] = ["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR", "INTEGRITY_OFFICER", "CASE_OFFICER", "REVIEWER", "MANAGEMENT_APPROVER", "DEPARTMENT_ACTION_OWNER", "AUDITOR"];
  if (data.roles.some((role) => !allowedRoles.includes(role as RoleCode))) throw new Error("INVALID_ROLE");
  if (!data.email.toLowerCase().endsWith("@" + context.env.ALLOWED_EMAIL_DOMAIN.toLowerCase())) throw new Error("EMAIL_DOMAIN_NOT_ALLOWED");
  const id = crypto.randomUUID();
  const roleRows = await context.env.DB.prepare(
    "SELECT id, code FROM roles WHERE code IN (" + data.roles.map(() => "?").join(",") + ")",
  ).bind(...data.roles).all<{ id: string; code: string }>();
  if (roleRows.results.length !== data.roles.length) throw new Error("INVALID_ROLE");
  await context.env.DB.batch([
    context.env.DB.prepare("INSERT INTO users (id, email, display_name, department) VALUES (?, ?, ?, ?)").bind(id, data.email.toLowerCase(), data.displayName, data.department ?? null),
    ...roleRows.results.map((role) => context.env.DB.prepare(
      "INSERT INTO user_roles (user_id, role_id, granted_by) VALUES (?, ?, ?)",
    ).bind(id, role.id, actor.id)),
  ]);
  await audit(context.env.DB, {
    actor, action: "USER_CREATED", entityType: "user", entityId: id,
    newValue: { email: data.email, roles: data.roles }, correlationId: context.get("correlationId"), source: "INTERNAL",
  });
  return context.json(envelope(context, { id }), 201);
});

internalApi.get("/settings", async (context) => {
  assertRole(context.get("actor"), ["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR"]);
  const [slaRules, settings] = await Promise.all([
    context.env.DB.prepare(
      "SELECT sr.*, cc.name AS category_name FROM sla_rules sr LEFT JOIN complaint_categories cc ON cc.id = sr.category_id ORDER BY sr.risk_level, cc.name",
    ).all(),
    context.env.DB.prepare("SELECT setting_key, setting_value, updated_at FROM application_settings WHERE is_secret = 0 ORDER BY setting_key").all(),
  ]);
  return context.json(envelope(context, { slaRules: slaRules.results, settings: settings.results }));
});

internalApi.put("/settings/sla", async (context) => {
  const actor = context.get("actor");
  assertRole(actor, ["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR"]);
  const data = z.object({
    riskLevel: z.enum(["Critical", "High", "Medium", "Low"]),
    categoryId: z.string().nullable(),
    targetBusinessDays: z.number().int().min(1).max(365),
  }).parse(await context.req.json());
  const existing = data.categoryId
    ? await context.env.DB.prepare("SELECT id FROM sla_rules WHERE risk_level = ? AND category_id = ?").bind(data.riskLevel, data.categoryId).first<{ id: string }>()
    : await context.env.DB.prepare("SELECT id FROM sla_rules WHERE risk_level = ? AND category_id IS NULL").bind(data.riskLevel).first<{ id: string }>();
  if (existing) {
    await context.env.DB.prepare(
      "UPDATE sla_rules SET target_business_days = ?, active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(data.targetBusinessDays, existing.id).run();
  } else {
    await context.env.DB.prepare(
      "INSERT INTO sla_rules (id, category_id, risk_level, target_business_days) VALUES (?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), data.categoryId, data.riskLevel, data.targetBusinessDays).run();
  }
  await audit(context.env.DB, {
    actor, action: "SLA_RULE_UPDATED", entityType: "sla_rule", entityId: existing?.id ?? data.riskLevel,
    newValue: data, correlationId: context.get("correlationId"), source: "INTERNAL",
  });
  return context.json(envelope(context, { updated: true }));
});

internalApi.get("/audit", async (context) => {
  assertRole(context.get("actor"), ["SYSTEM_ADMINISTRATOR", "INTEGRITY_ADMINISTRATOR", "AUDITOR"]);
  const rows = await context.env.DB.prepare(
    "SELECT al.*, u.display_name AS user_name FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id ORDER BY al.timestamp DESC LIMIT 500",
  ).all();
  return context.json(envelope(context, rows.results));
});
