import type { ComplaintStatus, RiskLevel } from "../shared/constants";

export const STATUS_TRANSITIONS: Record<ComplaintStatus, readonly ComplaintStatus[]> = {
  New: ["Acknowledged"],
  Acknowledged: ["Preliminary Assessment"],
  "Preliminary Assessment": ["Pending Information", "Pending Assignment", "Referred"],
  "Pending Information": ["Preliminary Assessment"],
  "Pending Assignment": ["Investigation Ongoing"],
  "Investigation Ongoing": ["Pending Review"],
  "Pending Review": ["Returned for Amendment", "Pending Management Decision"],
  "Returned for Amendment": ["Investigation Ongoing", "Pending Review"],
  "Pending Management Decision": ["Returned for Amendment", "Outcome Communication Pending", "Referred"],
  Referred: ["Outcome Communication Pending", "Closed"],
  "Outcome Communication Pending": ["Corrective Action Monitoring", "Closed"],
  "Corrective Action Monitoring": ["Closed"],
  Closed: ["Reopened"],
  Reopened: ["Preliminary Assessment", "Investigation Ongoing"],
};

export function canTransition(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ComplaintStatus, to: ComplaintStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid status transition from ${from} to ${to}.`);
  }
}

export function triageTarget(decision: string): ComplaintStatus {
  switch (decision) {
    case "Proceed with investigation":
    case "Escalate immediately":
      return "Pending Assignment";
    case "Request further information":
      return "Pending Information";
    case "Refer to another department":
    case "Refer to an external authority":
    case "Outside jurisdiction":
    case "Duplicate complaint":
    case "Close with no further action":
      return "Referred";
    default:
      throw new Error("Unsupported triage decision.");
  }
}

export function addBusinessDays(start: Date, days: number): Date {
  const result = new Date(start);
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

export function defaultSlaDays(risk: RiskLevel): number {
  return { Critical: 7, High: 15, Medium: 30, Low: 45 }[risk];
}

export function calculateRisk(input: {
  allegationTypes: string[];
  seniorManagement: boolean;
  financialImpact: number;
  legalExposure: boolean;
  reputationalImpact: boolean;
  evidenceTamperingRisk: boolean;
  systemic: boolean;
  publicInterest: boolean;
  urgent: boolean;
}): { score: number; rating: RiskLevel } {
  let score = 0;
  if (input.allegationTypes.some((type) => ["Bribery / corruption", "Fraud", "Procurement irregularity"].includes(type))) score += 20;
  if (input.seniorManagement) score += 15;
  if (input.financialImpact >= 1_000_000) score += 20;
  else if (input.financialImpact >= 100_000) score += 10;
  if (input.legalExposure) score += 10;
  if (input.reputationalImpact) score += 10;
  if (input.evidenceTamperingRisk) score += 10;
  if (input.systemic) score += 8;
  if (input.publicInterest) score += 4;
  if (input.urgent) score += 3;
  const rating: RiskLevel = score >= 70 ? "Critical" : score >= 45 ? "High" : score >= 20 ? "Medium" : "Low";
  return { score, rating };
}

export function slaStage(dueAt: Date, now: Date): string | null {
  const dayMs = 86_400_000;
  const days = Math.ceil((dueAt.getTime() - now.getTime()) / dayMs);
  if (days === 7) return "DUE_MINUS_7";
  if (days === 3) return "DUE_MINUS_3";
  if (days === 0) return "DUE_TODAY";
  if (days < 0 && Math.abs(days) % 3 === 0) return `OVERDUE_${Math.abs(days)}`;
  return null;
}
