import { describe, expect, it } from "vitest";
import { addBusinessDays, assertTransition, calculateRisk, canTransition, defaultSlaDays, slaStage, triageTarget } from "../src/worker/workflow";

describe("complaint workflow transitions", () => {
  it("allows the required sequential approval path", () => {
    expect(canTransition("Investigation Ongoing", "Pending Review")).toBe(true);
    expect(canTransition("Pending Review", "Pending Management Decision")).toBe(true);
    expect(canTransition("Pending Management Decision", "Outcome Communication Pending")).toBe(true);
    expect(canTransition("Outcome Communication Pending", "Closed")).toBe(true);
  });

  it("rejects bypassing mandatory workflow stages", () => {
    expect(canTransition("Investigation Ongoing", "Closed")).toBe(false);
    expect(() => assertTransition("Preliminary Assessment", "Closed")).toThrow("Invalid status transition");
  });

  it("maps all triage decisions to controlled states", () => {
    expect(triageTarget("Proceed with investigation")).toBe("Pending Assignment");
    expect(triageTarget("Request further information")).toBe("Pending Information");
    expect(triageTarget("Refer to an external authority")).toBe("Referred");
    expect(() => triageTarget("Directly close")).toThrow();
  });
});

describe("risk and SLA calculations", () => {
  it("raises serious allegations involving senior management to critical", () => {
    const result = calculateRisk({
      allegationTypes: ["Bribery / corruption", "Fraud"], seniorManagement: true, financialImpact: 2_000_000,
      legalExposure: true, reputationalImpact: true, evidenceTamperingRisk: true, systemic: true, publicInterest: true, urgent: true,
    });
    expect(result.rating).toBe("Critical");
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("uses risk-sensitive default targets", () => {
    expect(defaultSlaDays("Critical")).toBe(7);
    expect(defaultSlaDays("Low")).toBe(45);
  });

  it("adds business days without counting weekends", () => {
    expect(addBusinessDays(new Date("2026-07-17T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-07-20");
  });

  it("generates idempotent reminder stage keys", () => {
    const now = new Date("2026-07-15T00:00:00Z");
    expect(slaStage(new Date("2026-07-22T00:00:00Z"), now)).toBe("DUE_MINUS_7");
    expect(slaStage(new Date("2026-07-18T00:00:00Z"), now)).toBe("DUE_MINUS_3");
    expect(slaStage(new Date("2026-07-15T00:00:00Z"), now)).toBe("DUE_TODAY");
    expect(slaStage(new Date("2026-07-12T00:00:00Z"), now)).toBe("OVERDUE_3");
    expect(slaStage(new Date("2026-07-11T00:00:00Z"), now)).toBeNull();
  });
});
