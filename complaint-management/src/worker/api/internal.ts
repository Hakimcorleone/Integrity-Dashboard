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
    ...data.supportingOfficerIds.map(Î};∂âûÀk∫wµÁE•–ÅçΩπ—ï·–π…ïƒπ©ÕΩ∏†§§Ï(ÄÅ•òÄ°lâΩµ¡±ï—ïêà∞Äâ±ΩÕïêâtπ•πç±’ëïÃ°ëÖ—ÑπÕ—Ö—’Ã§ÄòòÄÖ¡…•Ÿ•±ïùïê§Å—°…Ω‹Åπï‹Å……Ω»†â=I	%8à§Ï(ÄÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππâÖ—ç†°l(ÄÄÄÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†âUAQÅçΩ……ïç—•Ÿï}Öç—•ΩπÃÅMPÅÕ—Ö—’ÃÄÙÄ¸∞Å¡…Ωù…ïÕÕ}’¡ëÖ—îÄÙÄ¸∞Å’¡ëÖ—ïë}Ö–ÄÙÅUII9Q}Q%5MQ5@Å]!IÅ•êÄÙÄ¸à§πâ•πê°ëÖ—ÑπÕ—Ö—’Ã∞ÅëÖ—Ñπ¡…Ωù…ïÕÕU¡ëÖ—î∞ÅÖç—•Ω∏π•ê§∞(ÄÄÄÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†â%9MIPÅ%9Q<ÅçΩ……ïç—•Ÿï}Öç—•Ωπ}’¡ëÖ—ïÃÄ°•ê∞ÅçΩ……ïç—•Ÿï}Öç—•Ωπ}•ê∞ÅÕ—Ö—’Ã∞Å¡…Ωù…ïÕÕ}’¡ëÖ—î∞Å’¡ëÖ—ïë}â‰§ÅY1ULÄ†¸∞Ä¸∞Ä¸∞Ä¸∞Ä¸§à§πâ•πê°ç…Â¡—ºπ…ÖπëΩµUU%†§∞ÅÖç—•Ω∏π•ê∞ÅëÖ—ÑπÕ—Ö—’Ã∞ÅëÖ—Ñπ¡…Ωù…ïÕÕU¡ëÖ—î∞ÅÖç—Ω»π•ê§∞(ÄÅt§Ï(ÄÅÖ›Ö•–ÅÖ’ë•–°çΩπ—ï·–πïπÿπ∞ÅÏÅÖç—Ω»∞ÅÖç—•Ω∏ËÄâ=IIQ%Y}Q%=9}UAQà∞Åïπ—•—ÂQÂ¡îËÄâçΩ……ïç—•Ÿï}Öç—•Ω∏à∞Åïπ—•—Â%êËÅÖç—•Ω∏π•ê∞Å¡…ïŸ•Ω’ÕYÖ±’îËÅÏÅÕ—Ö—’ÃËÅÖç—•Ω∏πÕ—Ö—’ÃÅÙ∞Åπï›YÖ±’îËÅÏÅÕ—Ö—’ÃËÅëÖ—ÑπÕ—Ö—’ÃÅÙ∞ÅçΩ……ï±Ö—•Ωπ%êËÅçΩπ—ï·–πùï–†âçΩ……ï±Ö—•Ωπ%êà§∞Å…ïÖÕΩ∏ËÅëÖ—Ñπ¡…Ωù…ïÕÕU¡ëÖ—î∞ÅÕΩ’…çîËÄâ%9QI90àÅÙ§Ï(ÄÅ…ï—’…∏ÅçΩπ—ï·–π©ÕΩ∏°ïπŸï±Ω¡î°çΩπ—ï·–∞ÅÏÅÖç—•Ωπ%êËÅÖç—•Ω∏πÖç—•Ωπ}•ê∞ÅÕ—Ö—’ÃËÅëÖ—ÑπÕ—Ö—’ÃÅÙ§§Ï)Ù§Ï()•π—ï…πÖ±¡§π¡ΩÕ–†àΩçΩ……ïç—•ŸîµÖç—•ΩπÃºÈÖç—•Ωπ%êΩŸï…•ô‰à∞ÅÖÕÂπåÄ°çΩπ—ï·–§ÄÙ¯ÅÏ(ÄÅçΩπÕ–ÅÖç—Ω»ÄÙÅçΩπ—ï·–πùï–†âÖç—Ω»à§Ï(ÄÅÖÕÕï…—9Ω—IïÖë=π±‰°Öç—Ω»§Ï(ÄÅÖÕÕï…—IΩ±î°Öç—Ω»∞ÅlâMeMQ5}5%9%MQIQ=Hà∞Äâ%9QI%Qe}5%9%MQIQ=Hà∞ÄâIY%]Hà∞Äâ5959Q}AAI=YHât§Ï(ÄÅçΩπÕ–ÅÖç—•Ω∏ÄÙÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†âM1PÄ®ÅI=4ÅçΩ……ïç—•Ÿï}Öç—•ΩπÃÅ]!IÅÖç—•Ωπ}•êÄÙÄ¸Å9Åëï±ï—ïë}Ö–Å%LÅ9U10à§πâ•πê°çΩπ—ï·–π…ïƒπ¡Ö…Ö¥†âÖç—•Ωπ%êà§§πô•…Õ–ÒÖπ‰¯†§Ï(ÄÅ•òÄ†ÖÖç—•Ω∏§Å—°…Ω‹Åπï‹Å……Ω»†â9=Q}=U9à§Ï(ÄÅ•òÄ°Öç—•Ω∏πÖç—•Ωπ}Ω›πï…}•êÄÙÙÙÅÖç—Ω»π•ê§Å—°…Ω‹Åπï‹Å……Ω»†âMIQ%=9}=}UQ%Là§Ï(ÄÅçΩπÕ–ÅëÖ—ÑÄÙÅËπΩâ©ïç–°ÏÅëïç•Õ•Ω∏ËÅËπïπ’¥°lâ¡¡…ΩŸîà∞ÄâIï©ïç–ât§∞Å…ïµÖ…≠ÃËÅËπÕ—…•πú†§π—…•¥†§πµ•∏†»§πµÖ‡†‘¿¿¿§ÅÙ§π¡Ö…Õî°Ö›Ö•–ÅçΩπ—ï·–π…ïƒπ©ÕΩ∏†§§Ï(ÄÅçΩπÕ–ÅÕ—Ö—’ÃÄÙÅëÖ—Ñπëïç•Õ•Ω∏ÄÙÙÙÄâ¡¡…ΩŸîàÄ¸Äâ±ΩÕïêàÄËÄâIï©ïç—ïêàÏ(ÄÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†(ÄÄÄÅÅUAQÅçΩ……ïç—•Ÿï}Öç—•ΩπÃÅMPÅÕ—Ö—’ÃÄÙÄ¸∞Å•π—ïù…•—Â}Ÿï…•ô•ï…}•êÄÙÄ¸∞ÅŸï…•ô•çÖ—•Ωπ}…ïµÖ…≠ÃÄÙÄ¸∞ÅŸï…•ô•ïë}Ö–ÄÙÅUII9Q}Q%5MQ5@∞(ÄÄÄÄÄÅçΩµ¡±ï—•Ωπ}ëÖ—îÄÙÅMÅ]!8Ä¸ÄÙÄù±ΩÕïêúÅQ!8ÅUII9Q}Q%5MQ5@Å1MÅçΩµ¡±ï—•Ωπ}ëÖ—îÅ9∞(ÄÄÄÄÄÅç±ΩÕ’…ï}Ö¡¡…ΩŸïë}â‰ÄÙÅMÅ]!8Ä¸ÄÙÄù±ΩÕïêúÅQ!8Ä¸Å1MÅç±ΩÕ’…ï}Ö¡¡…ΩŸïë}â‰Å9∞Å’¡ëÖ—ïë}Ö–ÄÙÅUII9Q}Q%5MQ5@Å]!IÅ•êÄÙÄ˝Ä∞(ÄÄ§πâ•πê°Õ—Ö—’Ã∞ÅÖç—Ω»π•ê∞ÅëÖ—Ñπ…ïµÖ…≠Ã∞ÅÕ—Ö—’Ã∞ÅÕ—Ö—’Ã∞ÅÖç—Ω»π•ê∞ÅÖç—•Ω∏π•ê§π…’∏†§Ï(ÄÅÖ›Ö•–ÅÖ’ë•–°çΩπ—ï·–πïπÿπ∞ÅÏÅÖç—Ω»∞ÅÖç—•Ω∏ËÄâ=IIQ%Y}Q%=9}YI%%à∞Åïπ—•—ÂQÂ¡îËÄâçΩ……ïç—•Ÿï}Öç—•Ω∏à∞Åïπ—•—Â%êËÅÖç—•Ω∏π•ê∞Å¡…ïŸ•Ω’ÕYÖ±’îËÅÏÅÕ—Ö—’ÃËÅÖç—•Ω∏πÕ—Ö—’ÃÅÙ∞Åπï›YÖ±’îËÅÏÅÕ—Ö—’Ã∞Åëïç•Õ•Ω∏ËÅëÖ—Ñπëïç•Õ•Ω∏ÅÙ∞ÅçΩ……ï±Ö—•Ωπ%êËÅçΩπ—ï·–πùï–†âçΩ……ï±Ö—•Ωπ%êà§∞Å…ïÖÕΩ∏ËÅëÖ—Ñπ…ïµÖ…≠Ã∞ÅÕΩ’…çîËÄâ%9QI90àÅÙ§Ï(ÄÅ…ï—’…∏ÅçΩπ—ï·–π©ÕΩ∏°ïπŸï±Ω¡î°çΩπ—ï·–∞ÅÏÅÖç—•Ωπ%êËÅÖç—•Ω∏πÖç—•Ωπ}•ê∞ÅÕ—Ö—’ÃÅÙ§§Ï)Ù§Ï()•π—ï…πÖ±¡§π¡ΩÕ–†àΩçÖÕïÃºÈçÖÕï%êΩç±ΩÕîà∞ÅÖÕÂπåÄ°çΩπ—ï·–§ÄÙ¯ÅÏ(ÄÅçΩπÕ–ÅÖç—Ω»ÄÙÅçΩπ—ï·–πùï–†âÖç—Ω»à§Ï(ÄÅÖÕÕï…—9Ω—IïÖë=π±‰°Öç—Ω»§Ï(ÄÅÖÕÕï…—IΩ±î°Öç—Ω»∞ÅlâMeMQ5}5%9%MQIQ=Hà∞Äâ%9QI%Qe}5%9%MQIQ=Hà∞Äâ5959Q}AAI=YHât§Ï(ÄÅçΩπÕ–ÅçΩµ¡±Ö•π–ÄÙÅÖ›Ö•–Å…ï≈’•…ïÖÕî°çΩπ—ï·–∞ÅçΩπ—ï·–π…ïƒπ¡Ö…Ö¥†âçÖÕï%êà§§Ï(ÄÅ•òÄ†Ñ°lâ=’—çΩµîÅΩµµ’π•çÖ—•Ω∏ÅAïπë•πúà∞ÄâΩ……ïç—•ŸîÅç—•Ω∏Å5Ωπ•—Ω…•πúà∞ÄâIïôï……ïêâtÅÖÃÅÕ—…•πùmt§π•πç±’ëïÃ°çΩµ¡±Ö•π–πÕ—Ö—’Ã§§Å—°…Ω‹Åπï‹Å……Ω»†â%9Y1%}MQQà§Ï(ÄÅçΩπÕ–ÅëÖ—ÑÄÙÅç±ΩÕ’…ïMç°ïµÑπ¡Ö…Õî°Ö›Ö•–ÅçΩπ—ï·–π…ïƒπ©ÕΩ∏†§§Ï(ÄÅ•òÄ†ÖëÖ—ÑπçΩµµ’π•çÖ—•ΩπΩµ¡±ï—ïê§Å—°…Ω‹Åπï‹Å……Ω»†â1=MUI}IEU%I59QLà§Ï(ÄÅçΩπÕ–Åç°ïç≠ÃÄÙÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†(ÄÄÄÅÅM1P(ÄÄÄÄÄÅa%MQL°M1PÄƒÅI=4ÅÖ¡¡…ΩŸÖ±ÃÅÑÅ]!IÅÑπçΩµ¡±Ö•π—}•êÄÙÄ¸Å9ÅÑπÕ—ÖùîÄÙÄù5959PúÅ9ÅÑπëïç•Õ•Ω∏ÄÙÄù¡¡…ΩŸîú§ÅLÅÖ¡¡…ΩŸïê∞(ÄÄÄÄÄÅa%MQL°M1PÄƒÅI=4Å•πŸïÕ—•ùÖ—•Ωπ}ô•πë•πùÃÅòÅ]!IÅòπçΩµ¡±Ö•π—}•êÄÙÄ¸Å9ÅòπÕ—Ö—’ÃÄÙÄùAAI=Yú§ÅLÅô•πë•πùÃ∞(ÄÄÄÄÄÅa%MQL°M1PÄƒÅI=4ÅçΩµµ’π•çÖ—•ΩπÃÅç¥Å]!IÅç¥πçΩµ¡±Ö•π—}•êÄÙÄ¸Å9Åç¥πçΩµµ’π•çÖ—•Ωπ}—Â¡îÄÙÄù=UQ=5úÅ9Åç¥πÕ—Ö—’ÃÄÙÄù=5A1Qú§ÅLÅçΩµµ’π•çÖ—ïê∞(ÄÄÄÄÄÄ°M1PÅ=U9P†®§ÅI=4ÅçΩ……ïç—•Ÿï}Öç—•ΩπÃÅçÑÅ]!IÅçÑπçΩµ¡±Ö•π—}•êÄÙÄ¸Å9ÅçÑπëï±ï—ïë}Ö–Å%LÅ9U10Å9ÅçÑπÕ—Ö—’ÃÅ9=PÅ%8Ä†ù±ΩÕïêú∞ùIï©ïç—ïêú§Å9ÅçÑπµΩπ•—Ω…•πù}—…ÖπÕôï……ïêÄÙÄ¿§ÅLÅΩ¡ïπ}Öç—•ΩπÕÄ∞(ÄÄ§πâ•πê°çΩµ¡±Ö•π–π•ê∞ÅçΩµ¡±Ö•π–π•ê∞ÅçΩµ¡±Ö•π–π•ê∞ÅçΩµ¡±Ö•π–π•ê§πô•…Õ–ÒÏÅÖ¡¡…ΩŸïêËÅπ’µâï»ÏÅô•πë•πùÃËÅπ’µâï»ÏÅçΩµµ’π•çÖ—ïêËÅπ’µâï»ÏÅΩ¡ïπ}Öç—•ΩπÃËÅπ’µâï»ÅÙ¯†§Ï(ÄÅ•òÄ°çΩµ¡±Ö•π–πÕ—Ö—’ÃÄÑÙÙÄâIïôï……ïêàÄòòÄ†Öç°ïç≠Ã¸πÖ¡¡…ΩŸïêÅÒÄÖç°ïç≠Ãπô•πë•πùÃÅÒÄÖç°ïç≠ÃπçΩµµ’π•çÖ—ïê§§Å—°…Ω‹Åπï‹Å……Ω»†â1=MUI}IEU%I59QLà§Ï(ÄÅ•òÄ†°ç°ïç≠Ã¸πΩ¡ïπ}Öç—•ΩπÃÄ¸¸Ä¿§Ä¯Ä¿ÄòòÄÖëÖ—Ñπ—…ÖπÕôï…=¡ïπç—•ΩπÃ§Å—°…Ω‹Åπï‹Å……Ω»†â1=MUI}IEU%I59QLà§Ï(ÄÅ•òÄ°ëÖ—Ñπ—…ÖπÕôï…=¡ïπç—•ΩπÃ§ÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†âUAQÅçΩ……ïç—•Ÿï}Öç—•ΩπÃÅMPÅµΩπ•—Ω…•πù}—…ÖπÕôï……ïêÄÙÄƒÅ]!IÅçΩµ¡±Ö•π—}•êÄÙÄ¸Å9ÅÕ—Ö—’ÃÅ9=PÅ%8Ä†ù±ΩÕïêú∞ùIï©ïç—ïêú§à§πâ•πê°çΩµ¡±Ö•π–π•ê§π…’∏†§Ï(ÄÅÖÕÕï…—Q…ÖπÕ•—•Ω∏°çΩµ¡±Ö•π–πÕ—Ö—’ÃÅÖÃÅΩµ¡±Ö•π—M—Ö—’Ã∞Äâ±ΩÕïêà§Ï(ÄÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†(ÄÄÄÄâUAQÅçΩµ¡±Ö•π—ÃÅMPÅ•πŸïÕ—•ùÖ—•Ωπ}Ω’—çΩµîÄÙÄ¸∞Åç±ΩÕ’…ï}…ïÖÕΩ∏ÄÙÄ¸∞Åç±ΩÕïë}Ö–ÄÙÅUII9Q}Q%5MQ5@∞Å’¡ëÖ—ïë}â‰ÄÙÄ¸Å]!IÅ•êÄÙÄ¸à∞(ÄÄ§πâ•πê°ëÖ—ÑπΩ’—çΩµî∞ÅëÖ—Ñπ…ïÖÕΩ∏∞ÅÖç—Ω»π•ê∞ÅçΩµ¡±Ö•π–π•ê§π…’∏†§Ï(ÄÅÖ›Ö•–Åç°ÖπùïM—Ö—’Ã°çΩπ—ï·–πïπÿπ∞ÅÏÅçΩµ¡±Ö•π—%êËÅçΩµ¡±Ö•π–π•ê∞Åô…Ω¥ËÅçΩµ¡±Ö•π–πÕ—Ö—’Ã∞Å—ºËÄâ±ΩÕïêà∞ÅÖç—Ω»∞Å…ïÖÕΩ∏ËÅëÖ—Ñπ…ïÖÕΩ∏∞ÅçΩ……ï±Ö—•Ωπ%êËÅçΩπ—ï·–πùï–†âçΩ……ï±Ö—•Ωπ%êà§ÅÙ§Ï(ÄÅÖ›Ö•–ÅÖ’ë•–°çΩπ—ï·–πïπÿπ∞ÅÏÅÖç—Ω»∞ÅÖç—•Ω∏ËÄâM}1=Mà∞Åïπ—•—ÂQÂ¡îËÄâçΩµ¡±Ö•π–à∞Åïπ—•—Â%êËÅçΩµ¡±Ö•π–π•ê∞Åπï›YÖ±’îËÅÏÅΩ’—çΩµîËÅëÖ—ÑπΩ’—çΩµî∞Å—…ÖπÕôï…=¡ïπç—•ΩπÃËÅëÖ—Ñπ—…ÖπÕôï…=¡ïπç—•ΩπÃÅÙ∞ÅçΩ……ï±Ö—•Ωπ%êËÅçΩπ—ï·–πùï–†âçΩ……ï±Ö—•Ωπ%êà§∞Å…ïÖÕΩ∏ËÅëÖ—Ñπ…ïÖÕΩ∏∞ÅÕΩ’…çîËÄâ%9QI90àÅÙ§Ï(ÄÅ…ï—’…∏ÅçΩπ—ï·–π©ÕΩ∏°ïπŸï±Ω¡î°çΩπ—ï·–∞ÅÏÅÕ—Ö—’ÃËÄâ±ΩÕïêàÅÙ§§Ï)Ù§Ï()•π—ï…πÖ±¡§π¡ΩÕ–†àΩçÖÕïÃºÈçÖÕï%êΩ…ïΩ¡ï∏à∞ÅÖÕÂπåÄ°çΩπ—ï·–§ÄÙ¯ÅÏ(ÄÅçΩπÕ–ÅÖç—Ω»ÄÙÅçΩπ—ï·–πùï–†âÖç—Ω»à§Ï(ÄÅÖÕÕï…—9Ω—IïÖë=π±‰°Öç—Ω»§Ï(ÄÅÖÕÕï…—IΩ±î°Öç—Ω»∞ÅlâMeMQ5}5%9%MQIQ=Hà∞Äâ%9QI%Qe}5%9%MQIQ=Hà∞Äâ5959Q}AAI=YHât§Ï(ÄÅçΩπÕ–ÅçΩµ¡±Ö•π–ÄÙÅÖ›Ö•–Å…ï≈’•…ïÖÕî°çΩπ—ï·–∞ÅçΩπ—ï·–π…ïƒπ¡Ö…Ö¥†âçÖÕï%êà§§Ï(ÄÅ•òÄ°çΩµ¡±Ö•π–πÕ—Ö—’ÃÄÑÙÙÄâ±ΩÕïêà§Å—°…Ω‹Åπï‹Å……Ω»†â%9Y1%}MQQà§Ï(ÄÅçΩπÕ–ÅëÖ—ÑÄÙÅ…ïΩ¡ïπMç°ïµÑπ¡Ö…Õî°Ö›Ö•–ÅçΩπ—ï·–π…ïƒπ©ÕΩ∏†§§Ï(ÄÅ•òÄ°ëÖ—ÑπÖ’—°Ω…•Õ•πù=ôô•çï…%êÄÙÙÙÅÖç—Ω»π•êÄòòÄÖÖç—Ω»π…Ω±ïÃπ•πç±’ëïÃ†â5959Q}AAI=YHà§ÄòòÄÖÖç—Ω»π…Ω±ïÃπ•πç±’ëïÃ†âMeMQ5}5%9%MQIQ=Hà§§Å—°…Ω‹Åπï‹Å……Ω»†â=I	%8à§Ï(ÄÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†âUAQÅçΩµ¡±Ö•π—ÃÅMPÅ…ïΩ¡ïπïë}Ö–ÄÙÅUII9Q}Q%5MQ5@∞Åç±ΩÕïë}Ö–ÄÙÅç±ΩÕïë}Ö–∞Å’¡ëÖ—ïë}â‰ÄÙÄ¸Å]!IÅ•êÄÙÄ¸à§πâ•πê°Öç—Ω»π•ê∞ÅçΩµ¡±Ö•π–π•ê§π…’∏†§Ï(ÄÅÖ›Ö•–Åç°ÖπùïM—Ö—’Ã°çΩπ—ï·–πïπÿπ∞ÅÏÅçΩµ¡±Ö•π—%êËÅçΩµ¡±Ö•π–π•ê∞Åô…Ω¥ËÄâ±ΩÕïêà∞Å—ºËÄâIïΩ¡ïπïêà∞ÅÖç—Ω»∞Å…ïÖÕΩ∏ËÅëÖ—Ñπ…ïÖÕΩ∏∞ÅçΩ……ï±Ö—•Ωπ%êËÅçΩπ—ï·–πùï–†âçΩ……ï±Ö—•Ωπ%êà§ÅÙ§Ï(ÄÅÖ›Ö•–ÅÖ’ë•–°çΩπ—ï·–πïπÿπ∞ÅÏÅÖç—Ω»∞ÅÖç—•Ω∏ËÄâM}I=A9à∞Åïπ—•—ÂQÂ¡îËÄâçΩµ¡±Ö•π–à∞Åïπ—•—Â%êËÅçΩµ¡±Ö•π–π•ê∞Åπï›YÖ±’îËÅÏÅ¡…ïŸ•Ω’Õ±ΩÕ’…ïÖ—îËÅçΩµ¡±Ö•π–πç±ΩÕïë}Ö–∞ÅÖ’—°Ω…•Õ•πù=ôô•çï…%êËÅëÖ—ÑπÖ’—°Ω…•Õ•πù=ôô•çï…%êÅÙ∞ÅçΩ……ï±Ö—•Ωπ%êËÅçΩπ—ï·–πùï–†âçΩ……ï±Ö—•Ωπ%êà§∞Å…ïÖÕΩ∏ËÅëÖ—Ñπ…ïÖÕΩ∏∞ÅÕΩ’…çîËÄâ%9QI90àÅÙ§Ï(ÄÅ…ï—’…∏ÅçΩπ—ï·–π©ÕΩ∏°ïπŸï±Ω¡î°çΩπ—ï·–∞ÅÏÅÕ—Ö—’ÃËÄâIïΩ¡ïπïêàÅÙ§§Ï)Ù§Ï()•π—ï…πÖ±¡§πùï–†àΩÖ¡¡…ΩŸÖ±Ãà∞ÅÖÕÂπåÄ°çΩπ—ï·–§ÄÙ¯ÅÏ(ÄÅçΩπÕ–ÅÖç—Ω»ÄÙÅçΩπ—ï·–πùï–†âÖç—Ω»à§Ï(ÄÅÖÕÕï…—IΩ±î°Öç—Ω»∞ÅlâMeMQ5}5%9%MQIQ=Hà∞ÄâIY%]Hà∞Äâ5959Q}AAI=YHà∞Äâ%9QI%Qe}5%9%MQIQ=Hà∞ÄâU%Q=Hât§Ï(ÄÅçΩπÕ–Å…Ω›ÃÄÙÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†(ÄÄÄÅÅM1PÅåπçÖÕï}•ê∞Ååπ—•—±î∞Ååπ…•Õ≠}…Ö—•πú∞ÅåπÕ—Ö—’Ã∞Ååπ’¡ëÖ—ïë}Ö–∞(ÄÄÄÄÄÄ°M1PÅ5`°Ÿï…Õ•Ω∏§ÅI=4ÅÖ¡¡…ΩŸÖ±}Ÿï…Õ•ΩπÃÅÖÿÅ]!IÅÖÿπçΩµ¡±Ö•π—}•êÄÙÅåπ•ê§ÅLÅŸï…Õ•Ω∏(ÄÄÄÄÅI=4ÅçΩµ¡±Ö•π—ÃÅåÅ]!IÅåπëï±ï—ïë}Ö–Å%LÅ9U10Å9ÅåπÕ—Ö—’ÃÅ%8Ä†ùAïπë•πúÅIïŸ•ï‹ú∞ùAïπë•πúÅ5ÖπÖùïµïπ–Åïç•Õ•Ω∏ú§Å=IHÅ	dÅåπ…•Õ≠}…Ö—•πú∞Ååπ’¡ëÖ—ïë}Ö—Ä∞(ÄÄ§πÖ±∞†§Ï(ÄÅ…ï—’…∏ÅçΩπ—ï·–π©ÕΩ∏°ïπŸï±Ω¡î°çΩπ—ï·–∞Å…Ω›Ãπ…ïÕ’±—Ã§§Ï)Ù§Ï()•π—ï…πÖ±¡§πùï–†àΩçΩ……ïç—•ŸîµÖç—•ΩπÃà∞ÅÖÕÂπåÄ°çΩπ—ï·–§ÄÙ¯ÅÏ(ÄÅçΩπÕ–ÅÖç—Ω»ÄÙÅçΩπ—ï·–πùï–†âÖç—Ω»à§Ï(ÄÅçΩπÕ–ÅÕçΩ¡îÄÙÅÖç—Ω»π…Ω±ïÃπÕΩµî†°…Ω±î§ÄÙ¯ÅlâMeMQ5}5%9%MQIQ=Hà∞Äâ%9QI%Qe}5%9%MQIQ=Hà∞ÄâIY%]Hà∞Äâ5959Q}AAI=YHà∞ÄâU%Q=Hâtπ•πç±’ëïÃ°…Ω±î§§Ä¸ÄàƒÙƒàÄËÄâçÑπÖç—•Ωπ}Ω›πï…}•êÄÙÄ¸àÏ(ÄÅçΩπÕ–Å…Ω›ÃÄÙÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†(ÄÄÄÅÅM1PÅçÑ∏®∞ÅåπçÖÕï}•ê∞Ååπ—•—±îÅLÅçÖÕï}—•—±î∞Å‘πë•Õ¡±ÖÂ}πÖµîÅLÅΩ›πï…}πÖµî∞(ÄÄÄÄÄÅMÅ]!8ÅçÑπ—Ö…ùï—}ëÖ—îÄÅëÖ—î†ùπΩ‹ú§Å9ÅçÑπÕ—Ö—’ÃÅ9=PÅ%8Ä†ù±ΩÕïêú∞ùIï©ïç—ïêú§ÅQ!8ÄƒÅ1MÄ¿Å9ÅLÅ•Õ}ΩŸï…ë’î(ÄÄÄÄÅI=4ÅçΩ……ïç—•Ÿï}Öç—•ΩπÃÅçÑÅ)=%8ÅçΩµ¡±Ö•π—ÃÅåÅ=8Ååπ•êÄÙÅçÑπçΩµ¡±Ö•π—}•êÅ)=%8Å’Õï…ÃÅ‘Å=8Å‘π•êÄÙÅçÑπÖç—•Ωπ}Ω›πï…}•ê(ÄÄÄÄÅ]!IÅçÑπëï±ï—ïë}Ö–Å%LÅ9U10Å9ÄëÌÕçΩ¡ïÙÅ=IHÅ	dÅ•Õ}ΩŸï…ë’îÅM∞ÅçÑπ—Ö…ùï—}ëÖ—ïÄ∞(ÄÄ§πâ•πê†∏∏∏°ÕçΩ¡îÄÙÙÙÄàƒÙƒàÄ¸ÅmtÄËÅmÖç—Ω»π•ët§§πÖ±∞†§Ï(ÄÅ…ï—’…∏ÅçΩπ—ï·–π©ÕΩ∏°ïπŸï±Ω¡î°çΩπ—ï·–∞Å…Ω›Ãπ…ïÕ’±—Ã§§Ï)Ù§Ï()•π—ï…πÖ±¡§πùï–†àΩπΩ—•ô•çÖ—•ΩπÃà∞ÅÖÕÂπåÄ°çΩπ—ï·–§ÄÙ¯ÅÏ(ÄÅçΩπÕ–ÅÖç—Ω»ÄÙÅçΩπ—ï·–πùï–†âÖç—Ω»à§Ï(ÄÅçΩπÕ–Å…Ω›ÃÄÙÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†(ÄÄÄÅÅM1PÅ•ê∞ÅïŸïπ—}—Â¡î∞ÅÕ’â©ïç–∞ÅâΩë‰∞ÅÖç—•Ωπ}’…∞∞Åëï±•Ÿï…Â}Õ—Ö—’Ã∞Å…ïÖë}Ö–∞Åç…ïÖ—ïë}Ö–(ÄÄÄÄÅI=4ÅπΩ—•ô•çÖ—•ΩπÃÅ]!IÅ’Õï…}•êÄÙÄ¸Å=HÅ’Õï…}•êÅ%LÅ9U10Å=IHÅ	dÅç…ïÖ—ïë}Ö–ÅMÅ1%5%PÄƒ¿¡Ä∞(ÄÄ§πâ•πê°Öç—Ω»π•ê§πÖ±∞†§Ï(ÄÅ…ï—’…∏ÅçΩπ—ï·–π©ÕΩ∏°ïπŸï±Ω¡î°çΩπ—ï·–∞Å…Ω›Ãπ…ïÕ’±—Ã§§Ï)Ù§Ï()•π—ï…πÖ±¡§π¡ΩÕ–†àΩπΩ—•ô•çÖ—•ΩπÃºÈ•êΩ…ïÖêà∞ÅÖÕÂπåÄ°çΩπ—ï·–§ÄÙ¯ÅÏ(ÄÅçΩπÕ–ÅÖç—Ω»ÄÙÅçΩπ—ï·–πùï–†âÖç—Ω»à§Ï(ÄÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†âUAQÅπΩ—•ô•çÖ—•ΩπÃÅMPÅ…ïÖë}Ö–ÄÙÅUII9Q}Q%5MQ5@Å]!IÅ•êÄÙÄ¸Å9Ä°’Õï…}•êÄÙÄ¸Å=HÅ’Õï…}•êÅ%LÅ9U10§à§πâ•πê°çΩπ—ï·–π…ïƒπ¡Ö…Ö¥†â•êà§∞ÅÖç—Ω»π•ê§π…’∏†§Ï(ÄÅ…ï—’…∏ÅçΩπ—ï·–π©ÕΩ∏°ïπŸï±Ω¡î°çΩπ—ï·–∞ÅÏÅ…ïÖêËÅ—…’îÅÙ§§Ï)Ù§Ï()•π—ï…πÖ±¡§πùï–†àΩ’Õï…Ãà∞ÅÖÕÂπåÄ°çΩπ—ï·–§ÄÙ¯ÅÏ(ÄÅÖÕÕï…—IΩ±î°çΩπ—ï·–πùï–†âÖç—Ω»à§∞ÅlâMeMQ5}5%9%MQIQ=Hà∞Äâ%9QI%Qe}5%9%MQIQ=Hât§Ï(ÄÅçΩπÕ–Å…Ω›ÃÄÙÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†(ÄÄÄÅÅM1PÅ‘π•ê∞Å‘πïµÖ•∞∞Å‘πë•Õ¡±ÖÂ}πÖµî∞Å‘πëï¡Ö…—µïπ–∞Å‘πÖç—•Ÿî∞(ÄÄÄÄÄÅI=UA}=9P°»πçΩëî§ÅLÅ…Ω±ïÃÅI=4Å’Õï…ÃÅ‘(ÄÄÄÄÅ1PÅ)=%8Å’Õï…}…Ω±ïÃÅ’»Å=8Å’»π’Õï…}•êÄÙÅ‘π•êÅ1PÅ)=%8Å…Ω±ïÃÅ»Å=8Å»π•êÄÙÅ’»π…Ω±ï}•ê(ÄÄÄÄÅ]!IÅ‘πëï±ï—ïë}Ö–Å%LÅ9U10ÅI=U@Å	dÅ‘π•êÅ=IHÅ	dÅ‘πë•Õ¡±ÖÂ}πÖµïÄ∞(ÄÄ§πÖ±∞†§Ï(ÄÅ…ï—’…∏ÅçΩπ—ï·–π©ÕΩ∏°ïπŸï±Ω¡î°çΩπ—ï·–∞Å…Ω›Ãπ…ïÕ’±—Ã§§Ï)Ù§Ï()•π—ï…πÖ±¡§π¡ΩÕ–†àΩ’Õï…Ãà∞ÅÖÕÂπåÄ°çΩπ—ï·–§ÄÙ¯ÅÏ(ÄÅçΩπÕ–ÅÖç—Ω»ÄÙÅçΩπ—ï·–πùï–†âÖç—Ω»à§Ï(ÄÅÖÕÕï…—IΩ±î°Öç—Ω»∞ÅlâMeMQ5}5%9%MQIQ=Hât§Ï(ÄÅçΩπÕ–ÅëÖ—ÑÄÙÅ’Õï…Mç°ïµÑπ¡Ö…Õî°Ö›Ö•–ÅçΩπ—ï·–π…ïƒπ©ÕΩ∏†§§Ï(ÄÅ•òÄ†ÖëÖ—ÑπïµÖ•∞π—Ω1Ω›ï…ÖÕî†§πïπëÕ]•—†°Å ëÌçΩπ—ï·–πïπÿπ11=]}5%1}=5%8π—Ω1Ω›ï…ÖÕî†•ıÄ§§Å—°…Ω‹Åπï‹Å……Ω»†â%9Y1%}5%1}=5%8à§Ï(ÄÅçΩπÕ–Å…Ω±ïÃÄÙÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î°ÅM1PÅ•ê∞ÅçΩëîÅI=4Å…Ω±ïÃÅ]!IÅçΩëîÅ%8Ä†ëÌëÖ—Ñπ…Ω±ïÃπµÖ¿††§ÄÙ¯Äà¸à§π©Ω•∏†à∞à•Ù•Ä§πâ•πê†∏∏πëÖ—Ñπ…Ω±ïÃ§πÖ±∞ÒÏÅ•êËÅÕ—…•πúÏÅçΩëîËÅIΩ±ïΩëîÅÙ¯†§Ï(ÄÅ•òÄ°…Ω±ïÃπ…ïÕ’±—Ãπ±ïπù—†ÄÑÙÙÅπï‹ÅMï–°ëÖ—Ñπ…Ω±ïÃ§πÕ•Èî§Å—°…Ω‹Åπï‹Å……Ω»†â%9Y1%}I=1à§Ï(ÄÅçΩπÕ–Å•êÄÙÅç…Â¡—ºπ…ÖπëΩµUU%†§Ï(ÄÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππâÖ—ç†°l(ÄÄÄÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†â%9MIPÅ%9Q<Å’Õï…ÃÄ°•ê∞ÅïµÖ•∞∞Åë•Õ¡±ÖÂ}πÖµî∞Åëï¡Ö…—µïπ–§ÅY1ULÄ†¸∞Ä¸∞Ä¸∞Ä¸§à§πâ•πê°•ê∞ÅëÖ—ÑπïµÖ•∞π—Ω1Ω›ï…ÖÕî†§∞ÅëÖ—Ñπë•Õ¡±ÖÂ9Öµî∞ÅëÖ—Ñπëï¡Ö…—µïπ–Ä¸¸Åπ’±∞§∞(ÄÄÄÄ∏∏π…Ω±ïÃπ…ïÕ’±—ÃπµÖ¿†°…Ω±î§ÄÙ¯ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†â%9MIPÅ%9Q<Å’Õï…}…Ω±ïÃÄ°’Õï…}•ê∞Å…Ω±ï}•ê∞Åù…Öπ—ïë}â‰§ÅY1ULÄ†¸∞Ä¸∞Ä¸§à§πâ•πê°•ê∞Å…Ω±îπ•ê∞ÅÖç—Ω»π•ê§§∞(ÄÅt§Ï(ÄÅÖ›Ö•–ÅÖ’ë•–°çΩπ—ï·–πïπÿπ∞ÅÏÅÖç—Ω»∞ÅÖç—•Ω∏ËÄâUMI}IQà∞Åïπ—•—ÂQÂ¡îËÄâ’Õï»à∞Åïπ—•—Â%êËÅ•ê∞Åπï›YÖ±’îËÅÏÅïµÖ•∞ËÅëÖ—ÑπïµÖ•∞π—Ω1Ω›ï…ÖÕî†§∞Å…Ω±ïÃËÅëÖ—Ñπ…Ω±ïÃÅÙ∞ÅçΩ……ï±Ö—•Ωπ%êËÅçΩπ—ï·–πùï–†âçΩ……ï±Ö—•Ωπ%êà§∞ÅÕΩ’…çîËÄâ%9QI90àÅÙ§Ï(ÄÅ…ï—’…∏ÅçΩπ—ï·–π©ÕΩ∏°ïπŸï±Ω¡î°çΩπ—ï·–∞ÅÏÅ•êÅÙ§∞Ä»¿ƒ§Ï)Ù§Ï()•π—ï…πÖ±¡§πùï–†àΩÕï——•πùÃà∞ÅÖÕÂπåÄ°çΩπ—ï·–§ÄÙ¯ÅÏ(ÄÅÖÕÕï…—IΩ±î°çΩπ—ï·–πùï–†âÖç—Ω»à§∞ÅlâMeMQ5}5%9%MQIQ=Hà∞Äâ%9QI%Qe}5%9%MQIQ=Hât§Ï(ÄÅçΩπÕ–ÅmÕï——•πùÃ∞ÅÕ±ÖtÄÙÅÖ›Ö•–ÅA…Ωµ•ÕîπÖ±∞°l(ÄÄÄÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†âM1PÅÕï——•πù}≠ï‰∞ÅÕï——•πù}ŸÖ±’î∞Å’¡ëÖ—ïë}Ö–ÅI=4ÅÖ¡¡±•çÖ—•Ωπ}Õï——•πùÃÅ]!IÅ•Õ}Õïç…ï–ÄÙÄ¿Å=IHÅ	dÅÕï——•πù}≠ï‰à§πÖ±∞†§∞(ÄÄÄÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†âM1PÅÕ»∏®∞ÅçåππÖµîÅLÅçÖ—ïùΩ…Â}πÖµîÅI=4ÅÕ±Ö}…’±ïÃÅÕ»Å1PÅ)=%8ÅçΩµ¡±Ö•π—}çÖ—ïùΩ…•ïÃÅçåÅ=8Åçåπ•êÄÙÅÕ»πçÖ—ïùΩ…Â}•êÅ=IHÅ	dÅÕ»π…•Õ≠}±ïŸï∞∞ÅçåππÖµîà§πÖ±∞†§∞(ÄÅt§Ï(ÄÅ…ï—’…∏ÅçΩπ—ï·–π©ÕΩ∏°ïπŸï±Ω¡î°çΩπ—ï·–∞ÅÏÅÕï——•πùÃËÅÕï——•πùÃπ…ïÕ’±—Ã∞ÅÕ±ÖI’±ïÃËÅÕ±Ñπ…ïÕ’±—ÃÅÙ§§Ï)Ù§Ï()•π—ï…πÖ±¡§π¡’–†àΩÕï——•πùÃΩÕ±Ñà∞ÅÖÕÂπåÄ°çΩπ—ï·–§ÄÙ¯ÅÏ(ÄÅçΩπÕ–ÅÖç—Ω»ÄÙÅçΩπ—ï·–πùï–†âÖç—Ω»à§Ï(ÄÅÖÕÕï…—IΩ±î°Öç—Ω»∞ÅlâMeMQ5}5%9%MQIQ=Hà∞Äâ%9QI%Qe}5%9%MQIQ=Hât§Ï(ÄÅçΩπÕ–ÅëÖ—ÑÄÙÅËπΩâ©ïç–°ÏÅ…•Õ≠1ïŸï∞ËÅËπïπ’¥°lâ…•—•çÖ∞à∞Äâ!•ù†à∞Äâ5ïë•’¥à∞Äâ1Ω‹ât§∞ÅçÖ—ïùΩ…Â%êËÅËπÕ—…•πú†§πΩ¡—•ΩπÖ∞†§ππ’±±Öâ±î†§∞Å—Ö…ùï—	’Õ•πïÕÕÖÂÃËÅËππ’µâï»†§π•π–†§πµ•∏†ƒ§πµÖ‡†Ãÿ‘§ÅÙ§π¡Ö…Õî°Ö›Ö•–ÅçΩπ—ï·–π…ïƒπ©ÕΩ∏†§§Ï(ÄÅçΩπÕ–Åï·•Õ—•πúÄÙÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†âM1PÅ•êÅI=4ÅÕ±Ö}…’±ïÃÅ]!IÅ…•Õ≠}±ïŸï∞ÄÙÄ¸Å9ÅçÖ—ïùΩ…Â}•êÅ%LÄ¸à§πâ•πê°ëÖ—Ñπ…•Õ≠1ïŸï∞∞ÅëÖ—ÑπçÖ—ïùΩ…Â%êÄ¸¸Åπ’±∞§πô•…Õ–ÒÏÅ•êËÅÕ—…•πúÅÙ¯†§Ï(ÄÅçΩπÕ–Å•êÄÙÅï·•Õ—•πú¸π•êÄ¸¸Åç…Â¡—ºπ…ÖπëΩµUU%†§Ï(ÄÅ•òÄ°ï·•Õ—•πú§ÅÏ(ÄÄÄÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†âUAQÅÕ±Ö}…’±ïÃÅMPÅ—Ö…ùï—}â’Õ•πïÕÕ}ëÖÂÃÄÙÄ¸∞Å’¡ëÖ—ïë}Ö–ÄÙÅUII9Q}Q%5MQ5@Å]!IÅ•êÄÙÄ¸à§(ÄÄÄÄÄÄπâ•πê°ëÖ—Ñπ—Ö…ùï—	’Õ•πïÕÕÖÂÃ∞Å•ê§π…’∏†§Ï(ÄÅÙÅï±ÕîÅÏ(ÄÄÄÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†â%9MIPÅ%9Q<ÅÕ±Ö}…’±ïÃÄ°•ê∞ÅçÖ—ïùΩ…Â}•ê∞Å…•Õ≠}±ïŸï∞∞Å—Ö…ùï—}â’Õ•πïÕÕ}ëÖÂÃ§ÅY1ULÄ†¸∞Ä¸∞Ä¸∞Ä¸§à§(ÄÄÄÄÄÄπâ•πê°•ê∞ÅëÖ—ÑπçÖ—ïùΩ…Â%êÄ¸¸Åπ’±∞∞ÅëÖ—Ñπ…•Õ≠1ïŸï∞∞ÅëÖ—Ñπ—Ö…ùï—	’Õ•πïÕÕÖÂÃ§π…’∏†§Ï(ÄÅÙ(ÄÅÖ›Ö•–ÅÖ’ë•–°çΩπ—ï·–πïπÿπ∞ÅÏÅÖç—Ω»∞ÅÖç—•Ω∏ËÄâM1}IU1}UAQà∞Åïπ—•—ÂQÂ¡îËÄâÕ±Ö}…’±îà∞Åïπ—•—Â%êËÅ•ê∞Åπï›YÖ±’îËÅëÖ—Ñ∞ÅçΩ……ï±Ö—•Ωπ%êËÅçΩπ—ï·–πùï–†âçΩ……ï±Ö—•Ωπ%êà§∞ÅÕΩ’…çîËÄâ%9QI90àÅÙ§Ï(ÄÅ…ï—’…∏ÅçΩπ—ï·–π©ÕΩ∏°ïπŸï±Ω¡î°çΩπ—ï·–∞ÅÏÅ•êÅÙ§§Ï)Ù§Ï()•π—ï…πÖ±¡§πùï–†àΩÖ’ë•–à∞ÅÖÕÂπåÄ°çΩπ—ï·–§ÄÙ¯ÅÏ(ÄÅÖÕÕï…—IΩ±î°çΩπ—ï·–πùï–†âÖç—Ω»à§∞ÅlâMeMQ5}5%9%MQIQ=Hà∞Äâ%9QI%Qe}5%9%MQIQ=Hà∞ÄâU%Q=Hât§Ï(ÄÅçΩπÕ–Å≈’ï…‰ÄÙÅçΩπ—ï·–π…ïƒπ≈’ï…‰†§Ï(ÄÅçΩπÕ–ÅŸÖ±’ïÃËÅ’π≠πΩ›πmtÄÙÅmtÏ(ÄÅçΩπÕ–Åô•±—ï…ÃÄÙÅlàƒÙƒâtÏ(ÄÅ•òÄ°≈’ï…‰πïπ—•—ÂQÂ¡î§ÅÏÅô•±—ï…Ãπ¡’Õ††âÑπïπ—•—Â}—Â¡îÄÙÄ¸à§ÏÅŸÖ±’ïÃπ¡’Õ†°≈’ï…‰πïπ—•—ÂQÂ¡î§ÏÅÙ(ÄÅ•òÄ°≈’ï…‰πÖç—•Ω∏§ÅÏÅô•±—ï…Ãπ¡’Õ††âÑπÖç—•Ω∏ÄÙÄ¸à§ÏÅŸÖ±’ïÃπ¡’Õ†°≈’ï…‰πÖç—•Ω∏§ÏÅÙ(ÄÅ•òÄ°≈’ï…‰πÕïÖ…ç†§ÅÏÅô•±—ï…Ãπ¡’Õ††à°Ñπïπ—•—Â}•êÅ1%-Ä¸Å=HÅÑπçΩ……ï±Ö—•Ωπ}•êÅ1%-Ä¸§à§ÏÅŸÖ±’ïÃπ¡’Õ†°ÄîëÌ≈’ï…‰πÕïÖ…ç°ÙïÄ∞ÅÄîëÌ≈’ï…‰πÕïÖ…ç°ÙïÄ§ÏÅÙ(ÄÅçΩπÕ–Å…Ω›ÃÄÙÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†(ÄÄÄÅÅM1PÅÑπ•ê∞ÅÑπÖç—•Ω∏∞ÅÑπïπ—•—Â}—Â¡î∞ÅÑπïπ—•—Â}•ê∞ÅÑπ—•µïÕ—Öµ¿∞ÅÑπçΩ……ï±Ö—•Ωπ}•ê∞ÅÑπ…ïÖÕΩ∏∞ÅÑπÕΩ’…çî∞Å‘πë•Õ¡±ÖÂ}πÖµîÅLÅ’Õï…}πÖµî(ÄÄÄÄÅI=4ÅÖ’ë•—}±ΩùÃÅÑÅ1PÅ)=%8Å’Õï…ÃÅ‘Å=8Å‘π•êÄÙÅÑπ’Õï…}•êÅ]!IÄëÌô•±—ï…Ãπ©Ω•∏†àÅ9Äà•ÙÅ=IHÅ	dÅÑπ—•µïÕ—Öµ¿ÅMÅ1%5%PÄ»‘¡Ä∞(ÄÄ§πâ•πê†∏∏πŸÖ±’ïÃ§πÖ±∞†§Ï(ÄÅ…ï—’…∏ÅçΩπ—ï·–π©ÕΩ∏°ïπŸï±Ω¡î°çΩπ—ï·–∞Å…Ω›Ãπ…ïÕ’±—Ã§§Ï)Ù§Ï()•π—ï…πÖ±¡§πùï–†àΩ…ï¡Ω…—ÃΩï·¡Ω…–πçÕÿà∞ÅÖÕÂπåÄ°çΩπ—ï·–§ÄÙ¯ÅÏ(ÄÅçΩπÕ–ÅÖç—Ω»ÄÙÅçΩπ—ï·–πùï–†âÖç—Ω»à§Ï(ÄÅÖÕÕï…—IΩ±î°Öç—Ω»∞ÅlâMeMQ5}5%9%MQIQ=Hà∞Äâ%9QI%Qe}5%9%MQIQ=Hà∞Äâ%9QI%Qe}=%Hà∞ÄâIY%]Hà∞Äâ5959Q}AAI=YHà∞ÄâU%Q=Hât§Ï(ÄÅçΩπÕ–ÅÕçΩ¡îÄÙÅçÖÕï1•Õ—MçΩ¡î°Öç—Ω»§Ï(ÄÅçΩπÕ–Å…Ω›ÃÄÙÅÖ›Ö•–ÅçΩπ—ï·–πïπÿππ¡…ï¡Ö…î†(ÄÄÄÅÅM1PÅåπçÖÕï}•ê∞Ååπç…ïÖ—ïë}Ö–∞ÅçåππÖµîÅLÅçÖ—ïùΩ…‰∞Ååπëï¡Ö…—µïπ–∞Ååπ…•Õ≠}…Ö—•πú∞ÅåπÕ—Ö—’Ã∞ÅåπÕ±Ö}ë’ï}Ö–∞(ÄÄÄÄÄÅåπ•πŸïÕ—•ùÖ—•Ωπ}Ω’—çΩµî∞Ååπç±ΩÕïë}Ö–(ÄÄÄÄÅI=4ÅçΩµ¡±Ö•π—ÃÅåÅ)=%8ÅçΩµ¡±Ö•π—}çÖ—ïùΩ…•ïÃÅçåÅ=8Åçåπ•êÄÙÅåπçÖ—ïùΩ…Â}•ê(ÄÄÄÄÅ]!IÅåπëï±ï—ïë}Ö–Å%LÅ9U10Å9ÄëÌÕçΩ¡îπç±Ö’ÕïÙÅ=IHÅ	dÅåπç…ïÖ—ïë}Ö–ÅMÄ∞(ÄÄ§πâ•πê†∏∏πÕçΩ¡îπŸÖ±’ïÃ§πÖ±∞ÒIïçΩ…êÒÕ—…•πú∞Å’π≠πΩ›∏¯¯†§Ï(ÄÅçΩπÕ–Å°ïÖëï…ÃÄÙÅlâçÖÕï}•êà∞Äâç…ïÖ—ïë}Ö–à∞ÄâçÖ—ïùΩ…‰à∞Äâëï¡Ö…—µïπ–à∞Äâ…•Õ≠}…Ö—•πúà∞ÄâÕ—Ö—’Ãà∞ÄâÕ±Ö}ë’ï}Ö–à∞Äâ•πŸïÕ—•ùÖ—•Ωπ}Ω’—çΩµîà∞Äâç±ΩÕïë}Ö–âtÏ(ÄÅçΩπÕ–Åçï±∞ÄÙÄ°ŸÖ±’îËÅ’π≠πΩ›∏§ÄÙ¯ÅÄàëÌM—…•πú°ŸÖ±’îÄ¸¸Äàà§π…ï¡±Öçï±∞†úàú∞Äúààú•ÙâÄÏ(ÄÅçΩπÕ–ÅçÕÿÄÙÅm°ïÖëï…Ãπ©Ω•∏†à∞à§∞Ä∏∏π…Ω›Ãπ…ïÕ’±—ÃπµÖ¿†°…Ω‹§ÄÙ¯Å°ïÖëï…ÃπµÖ¿†°°ïÖëï»§ÄÙ¯Åçï±∞°…Ω›m°ïÖëï…t§§π©Ω•∏†à∞à§•tπ©Ω•∏†âq…q∏à§Ï(ÄÅ…ï—’…∏Åπï‹ÅIïÕ¡ΩπÕî°çÕÿ∞ÅÏÅ°ïÖëï…ÃËÅÏÄâΩπ—ïπ–µQÂ¡îàËÄâ—ï·–ΩçÕÿÏÅç°Ö…Õï–ı’—ò¥‡à∞ÄâΩπ—ïπ–µ•Õ¡ΩÕ•—•Ω∏àËÅÅÖ——Öç°µïπ–ÏÅô•±ïπÖµîÙâçΩµ¡±Ö•π–µ…ï¡Ω…–¥ëÌπï‹ÅÖ—î†§π—Ω%M=M—…•πú†§πÕ±•çî†¿∞Äƒ¿•ÙπçÕÿâÄ∞ÄâÖç°îµΩπ—…Ω∞àËÄâ¡…•ŸÖ—î∞ÅπºµÕ—Ω…îàÅÙÅÙ§Ï)Ù§Ï(