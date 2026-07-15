import { z } from "zod";
import { APPROVAL_DECISIONS, CLOSURE_OUTCOMES, RISK_LEVELS, TRIAGE_DECISIONS } from "../shared/constants";

const optionalText = z.string().trim().max(500).optional().nullable();
const requiredText = z.string().trim().min(2).max(5000);
const booleanish = z.union([z.boolean(), z.literal("true"), z.literal("false")]).transform((value) => value === true || value === "true");

export const publicComplaintSchema = z.object({
  complainantType: z.enum(["Internal", "External", "Anonymous"]),
  fullName: optionalText,
  email: z.union([z.email(), z.literal(""), z.null()]).optional(),
  telephone: optionalText,
  organisation: optionalText,
  preferredCommunication: z.enum(["Email", "Telephone", "Secure tracking", "None"]),
  categoryId: z.string().regex(/^[a-z0-9-]{3,64}$/),
  title: z.string().trim().min(5).max(200),
  description: z.string().trim().min(20).max(20_000),
  incidentDate: z.union([z.iso.date(), z.literal(""), z.null()]).optional(),
  location: optionalText,
  department: optionalText,
  project: optionalText,
  subjectDetails: optionalText,
  financialImpact: z.coerce.number().min(0).max(1_000_000_000).optional().default(0),
  confidentialityAcknowledged: booleanish.pipe(z.literal(true)),
  declarationAccurate: booleanish.pipe(z.literal(true)),
  privacyConsent: booleanish.pipe(z.literal(true)),
  turnstileToken: z.string().min(1).max(2048),
}).superRefine((data, context) => {
  if (data.complainantType !== "Anonymous" && !data.fullName) {
    context.addIssue({ code: "custom", path: ["fullName"], message: "Full name is required." });
  }
  if (data.preferredCommunication === "Email" && !data.email) {
    context.addIssue({ code: "custom", path: ["email"], message: "Email is required for email communication." });
  }
});

const assessmentFlags = {
  withinJurisdiction: z.boolean(),
  informationSufficient: z.boolean(),
  duplicateComplaint: z.boolean(),
  existingRelatedCase: z.boolean(),
  briberyCorruption: z.boolean(),
  fraud: z.boolean(),
  misconduct: z.boolean(),
  conflictOfInterest: z.boolean(),
  abuseOfPower: z.boolean(),
  procurementIrregularities: z.boolean(),
  seniorManagementInvolved: z.boolean(),
  evidenceDestructionRisk: z.boolean(),
  immediateRisk: z.boolean(),
  assessorConflict: z.boolean(),
};

export const assessmentSchema = z.object({
  ...assessmentFlags,
  recommendedRisk: z.enum(RISK_LEVELS),
  decision: z.enum(TRIAGE_DECISIONS),
  reason: requiredText,
  remarks: z.string().trim().max(5000).default(""),
  relatedCaseId: z.string().trim().max(30).optional(),
});

export const assignmentSchema = z.object({
  primaryOfficerId: z.string().uuid(),
  supportingOfficerIds: z.array(z.string().uuid()).max(10).default([]),
  dueDate: z.iso.datetime(),
  priority: z.enum(["Urgent", "High", "Normal", "Low"]),
  scope: requiredText,
  instructions: z.string().trim().max(5000).default(""),
  reason: requiredText,
});

export const activitySchema = z.object({
  activityType: z.enum([
    "Document requested", "Document received", "Interview scheduled", "Interview completed", "Site visit",
    "Evidence reviewed", "Internal consultation", "Legal consultation", "Management update", "External referral",
    "Follow-up action", "Investigation note",
  ]),
  occurredAt: z.iso.datetime(),
  description: requiredText,
  nextAction: z.string().trim().max(1000).optional(),
  nextActionDueAt: z.iso.datetime().optional(),
  visibility: z.enum(["Restricted", "Confidential", "Internal", "General"]),
  attachmentIds: z.array(z.string().uuid()).max(20).default([]),
});

export const findingSchema = z.object({
  allegations: requiredText,
  analysis: requiredText,
  findings: requiredText,
  recommendations: requiredText,
  outcome: z.enum(CLOSURE_OUTCOMES),
  submit: z.boolean().default(true),
});

export const approvalSchema = z.object({
  decision: z.enum(APPROVAL_DECISIONS),
  remarks: requiredText,
  version: z.number().int().positive(),
  returnedToUserId: z.string().uuid().optional(),
  subsequentAction: z.string().trim().max(2000).optional(),
});

export const closureSchema = z.object({
  outcome: z.enum(CLOSURE_OUTCOMES),
  reason: requiredText,
  communicationCompleted: z.boolean(),
  transferOpenActions: z.boolean().default(false),
});

export const reopenSchema = z.object({ reason: requiredText, authorisingOfficerId: z.string().uuid() });

export const correctiveActionSchema = z.object({
  recommendation: requiredText,
  actionOwnerId: z.string().uuid(),
  responsibleDepartment: z.string().trim().min(2).max(200),
  priority: z.enum(["Critical", "High", "Medium", "Low"]),
  targetDate: z.iso.date(),
});

export const userSchema = z.object({
  email: z.email(),
  displayName: z.string().trim().min(2).max(200),
  department: z.string().trim().max(200).optional(),
  roles: z.array(z.string()).min(1).max(8),
});
