export const COMPLAINT_STATUSES = [
  "New",
  "Acknowledged",
  "Preliminary Assessment",
  "Pending Information",
  "Pending Assignment",
  "Investigation Ongoing",
  "Pending Review",
  "Returned for Amendment",
  "Pending Management Decision",
  "Referred",
  "Outcome Communication Pending",
  "Corrective Action Monitoring",
  "Closed",
  "Reopened",
] as const;

export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const RISK_LEVELS = ["Critical", "High", "Medium", "Low"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const ROLES = [
  "SYSTEM_ADMINISTRATOR",
  "INTEGRITY_ADMINISTRATOR",
  "INTEGRITY_OFFICER",
  "CASE_OFFICER",
  "REVIEWER",
  "MANAGEMENT_APPROVER",
  "DEPARTMENT_ACTION_OWNER",
  "AUDITOR",
] as const;

export type RoleCode = (typeof ROLES)[number];

export const CLOSURE_OUTCOMES = [
  "Substantiated",
  "Partially substantiated",
  "Unsubstantiated",
  "Insufficient information",
  "Outside jurisdiction",
  "Duplicate complaint",
  "Referred to relevant authority",
  "Withdrawn",
  "No further action",
] as const;

export const TRIAGE_DECISIONS = [
  "Proceed with investigation",
  "Request further information",
  "Refer to another department",
  "Refer to an external authority",
  "Outside jurisdiction",
  "Duplicate complaint",
  "Close with no further action",
  "Escalate immediately",
] as const;

export const APPROVAL_DECISIONS = [
  "Approve",
  "Return for amendment",
  "Request further investigation",
  "Escalate",
  "Refer",
  "Close with no further action",
] as const;

export const SAFE_PUBLIC_STATUS: Record<ComplaintStatus, "Received" | "Under assessment" | "In progress" | "Completed"> = {
  New: "Received",
  Acknowledged: "Received",
  "Preliminary Assessment": "Under assessment",
  "Pending Information": "Under assessment",
  "Pending Assignment": "Under assessment",
  "Investigation Ongoing": "In progress",
  "Pending Review": "In progress",
  "Returned for Amendment": "In progress",
  "Pending Management Decision": "In progress",
  Referred: "In progress",
  "Outcome Communication Pending": "In progress",
  "Corrective Action Monitoring": "In progress",
  Closed: "Completed",
  Reopened: "In progress",
};

export const ALLOWED_UPLOAD_TYPES = new Map([
  ["application/pdf", ["pdf"]],
  ["image/jpeg", ["jpg", "jpeg"]],
  ["image/png", ["png"]],
  ["text/plain", ["txt"]],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ["docx"]],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ["xlsx"]],
]);

export const PUBLIC_RATE_LIMIT = { requests: 5, windowSeconds: 600 } as const;
