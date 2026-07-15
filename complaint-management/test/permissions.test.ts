import { describe, expect, it } from "vitest";
import type { Actor } from "../src/shared/types";
import { assertNotReadOnly, assertRole, canAccessCase, canReadAllCases, caseListScope, hasAnyRole } from "../src/worker/permissions";

const actor = (roles: Actor["roles"]): Actor => ({ id: "user-1", email: "person@example.invalid", displayName: "Person", department: "Integrity", roles });

describe("RBAC and case-level permissions", () => {
  it("grants global reads only to oversight roles", () => {
    expect(canReadAllCases(actor(["INTEGRITY_ADMINISTRATOR"]))).toBe(true);
    expect(canReadAllCases(actor(["AUDITOR"]))).toBe(true);
    expect(canReadAllCases(actor(["CASE_OFFICER"]))).toBe(false);
    expect(hasAnyRole(actor(["REVIEWER"]), ["REVIEWER", "MANAGEMENT_APPROVER"])).toBe(true);
  });

  it("blocks a read-only auditor from mutations", () => {
    expect(() => assertNotReadOnly(actor(["AUDITOR"]))).toThrow("FORBIDDEN");
    expect(() => assertNotReadOnly(actor(["AUDITOR", "INTEGRITY_ADMINISTRATOR"]))).not.toThrow();
  });

  it("requires explicit roles", () => {
    expect(() => assertRole(actor(["CASE_OFFICER"]), ["REVIEWER"])).toThrow("FORBIDDEN");
  });

  it("scopes investigator lists to active assignments", () => {
    const scope = caseListScope(actor(["CASE_OFFICER"]));
    expect(scope.clause).toContain("complaint_assignments");
    expect(scope.values).toEqual(["user-1"]);
  });

  it("checks case assignments server-side", async () => {
    const db = { prepare: () => ({ bind: () => ({ first: async () => ({ found: 1 }) }) }) } as unknown as D1Database;
    await expect(canAccessCase(db, actor(["CASE_OFFICER"]), "case-1")).resolves.toBe(true);
  });
});
