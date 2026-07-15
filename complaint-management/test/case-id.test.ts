import { describe, expect, it } from "vitest";
import { nextCaseId } from "../src/worker/db";

class SequenceDatabase {
  private value = 1;
  prepare(sql: string) {
    return {
      bind: () => ({
        run: async () => ({ success: true, meta: { changes: 1 } }),
        first: async () => {
          if (!sql.includes("RETURNING")) return null;
          const allocated_value = this.value;
          this.value += 1;
          return { allocated_value };
        },
      }),
    };
  }
}

describe("Case ID allocation", () => {
  it("formats the required CMP-YYYY-000001 identifier", async () => {
    const db = new SequenceDatabase() as unknown as D1Database;
    await expect(nextCaseId(db, new Date("2026-07-15T00:00:00Z"))).resolves.toBe("CMP-2026-000001");
  });

  it("does not duplicate values under concurrent allocation", async () => {
    const db = new SequenceDatabase() as unknown as D1Database;
    const ids = await Promise.all(Array.from({ length: 100 }, () => nextCaseId(db, new Date("2026-07-15T00:00:00Z"))));
    expect(new Set(ids).size).toBe(100);
    expect(ids).toContain("CMP-2026-000100");
  });
});
