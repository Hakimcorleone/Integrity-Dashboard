import { describe, expect, it } from "vitest";
import { enforcePublicRateLimit } from "../src/worker/security";

class RateLimitDatabase {
  count = 0;
  prepare() {
    return { bind: () => ({ first: async () => ({ request_count: ++this.count }) }) };
  }
}

describe("public endpoint abuse protection", () => {
  it("permits five attempts and rejects the sixth in a fixed window", async () => {
    const db = new RateLimitDatabase() as unknown as D1Database;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(enforcePublicRateLimit(db, "203.0.113.10", "test-salt", 0)).resolves.toBe(true);
    }
    await expect(enforcePublicRateLimit(db, "203.0.113.10", "test-salt", 0)).resolves.toBe(false);
  });
});
