import { describe, expect, it } from "vitest";
import { constantTimeEqual, hmac, publicReference, safeFilename, sha256, trackingToken, validateFileSignature, validateUpload } from "../src/worker/security";

describe("security helpers", () => {
  it("hashes and compares secrets without exposing the original", async () => {
    const digest = await sha256("secret-value");
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain("secret-value");
    expect(constantTimeEqual(digest, digest)).toBe(true);
    expect(constantTimeEqual(digest, `${digest.slice(0, -1)}0`)).toBe(false);
  });

  it("creates unguessable public references and tracking tokens", () => {
    expect(publicReference(new Date("2026-01-01T00:00:00Z"))).toMatch(/^CR-2026-[A-F0-9]{12}$/);
    const first = trackingToken();
    const second = trackingToken();
    expect(first).toHaveLength(43);
    expect(first).not.toBe(second);
  });

  it("normalises traversal and malicious filename characters", () => {
    expect(safeFilename("../../evidence<script>.pdf")).toBe("evidence_script_.pdf");
    expect(safeFilename("folder\\clean.docx")).toBe("clean.docx");
  });

  it("accepts permitted matching MIME and extension pairs", () => {
    const file = new File(["document"], "evidence.pdf", { type: "application/pdf" });
    expect(validateUpload(file, 1024)).toEqual({ ok: true, filename: "evidence.pdf" });
  });

  it("rejects oversized, executable, and spoofed files", () => {
    expect(validateUpload(new File([new Uint8Array(20)], "large.pdf", { type: "application/pdf" }), 10).ok).toBe(false);
    expect(validateUpload(new File(["x"], "payload.exe", { type: "application/octet-stream" }), 1024).ok).toBe(false);
    expect(validateUpload(new File(["x"], "picture.exe", { type: "image/png" }), 1024).ok).toBe(false);
  });

  it("checks file magic bytes instead of trusting MIME metadata", () => {
    expect(validateFileSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer, "application/pdf")).toBe(true);
    expect(validateFileSignature(new TextEncoder().encode("not a pdf").buffer, "application/pdf")).toBe(false);
    expect(validateFileSignature(new TextEncoder().encode("valid utf8 text").buffer, "text/plain")).toBe(true);
    expect(validateFileSignature(new Uint8Array([0, 1, 2]).buffer, "text/plain")).toBe(false);
  });

  it("creates stable keyed hashes for rate-limit identifiers", async () => {
    expect(await hmac("203.0.113.1", "salt")).toBe(await hmac("203.0.113.1", "salt"));
    expect(await hmac("203.0.113.2", "salt")).not.toBe(await hmac("203.0.113.1", "salt"));
  });
});
