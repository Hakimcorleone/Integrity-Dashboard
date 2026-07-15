import { describe, expect, it } from "vitest";
import { app } from "../src/worker/index";

const env = {
  ENVIRONMENT: "preview",
  APP_NAME: "Test",
  ASSETS: { fetch: async () => new Response("asset") },
} as any;

describe("Worker API integration", () => {
  it("returns a non-sensitive health response with security headers", async () => {
    const response = await app.request("http://test/api/health", {}, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const body = await response.json() as any;
    expect(body.status).toBe("ok");
    expect(body.correlationId).toBeTruthy();
  });

  it("rejects unauthenticated internal access without querying a database", async () => {
    const response = await app.request("http://test/api/internal/me", {}, env);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Authentication required." });
  });

  it("does not expose route details for missing API resources", async () => {
    const response = await app.request("http://test/api/internal/unknown", {}, env);
    expect(response.status).toBe(401);
  });
});
