import type { RoleCode } from "../shared/constants";
import type { Actor } from "../shared/types";

const READ_ALL_ROLES = new Set<RoleCode>([
  "SYSTEM_ADMINISTRATOR",
  "INTEGRITY_ADMINISTRATOR",
  "INTEGRITY_OFFICER",
  "REVIEWER",
  "MANAGEMENT_APPROVER",
  "AUDITOR",
]);

export function hasAnyRole(actor: Actor, roles: readonly RoleCode[]): boolean {
  return roles.some((role) => actor.roles.includes(role));
}

export function assertRole(actor: Actor, roles: readonly RoleCode[]): void {
  if (!hasAnyRole(actor, roles)) throw new Error("FORBIDDEN");
}

export function canReadAllCases(actor: Actor): boolean {
  return actor.roles.some((role) => READ_ALL_ROLES.has(role));
}

export async function canAccessCase(db: D1Database, actor: Actor, complaintId: string): Promise<boolean> {
  if (canReadAllCases(actor)) return true;
  if (actor.roles.includes("CASE_OFFICER")) {
    const assignment = await db.prepare(
      "SELECT 1 FROM complaint_assignments WHERE complaint_id = ? AND user_id = ? AND ended_at IS NULL LIMIT 1",
    ).bind(complaintId, actor.id).first();
    if (assignment) return true;
  }
  if (actor.roles.includes("DEPARTMENT_ACTION_OWNER")) {
    const action = await db.prepare(
      "SELECT 1 FROM corrective_actions WHERE complaint_id = ? AND action_owner_id = ? AND deleted_at IS NULL LIMIT 1",
    ).bind(complaintId, actor.id).first();
    if (action) return true;
  }
  return false;
}

export function assertNotReadOnly(actor: Actor): void {
  if (actor.roles.length === 1 && actor.roles.includes("AUDITOR")) throw new Error("FORBIDDEN");
}

export function caseListScope(actor: Actor): { clause: string; values: string[] } {
  if (canReadAllCases(actor)) return { clause: "1 = 1", values: [] };
  const clauses: string[] = [];
  const values: string[] = [];
  if (actor.roles.includes("CASE_OFFICER")) {
    clauses.push("EXISTS (SELECT 1 FROM complaint_assignments ca WHERE ca.complaint_id = c.id AND ca.user_id = ? AND ca.ended_at IS NULL)");
    values.push(actor.id);
  }
  if (actor.roles.includes("DEPARTMENT_ACTION_OWNER")) {
    clauses.push("EXISTS (SELECT 1 FROM corrective_actions coa WHERE coa.complaint_id = c.id AND coa.action_owner_id = ? AND coa.deleted_at IS NULL)");
    values.push(actor.id);
  }
  return { clause: clauses.length ? `(${clauses.join(" OR ")})` : "0 = 1", values };
}
