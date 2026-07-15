import { ALLOWED_UPLOAD_TYPES, PUBLIC_RATE_LIMIT } from "../shared/constants";

const encoder = new TextEncoder();

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "script-src 'self' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "upgrade-insecure-requests",
  ].join("; "),
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
};

export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const data = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

export function publicReference(now = new Date()): string {
  const random = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  return `CR-${now.getUTCFullYear()}-${random}`;
}

export function trackingToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function safeFilename(original: string): string {
  const filename = original.split(/[\\/]/).pop() ?? "attachment";
  return filename
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-zA-Z0-9._() -]/g, "_")
    .replace(/\.{2,}/g, ".")
    .slice(0, 180) || "attachment";
}

export function validateUpload(file: File, maxBytes: number): { ok: true; filename: string } | { ok: false; reason: string } {
  if (file.size <= 0 || file.size > maxBytes) {
    return { ok: false, reason: `File size must be between 1 byte and ${maxBytes} bytes.` };
  }
  const extensions = ALLOWED_UPLOAD_TYPES.get(file.type);
  const filename = safeFilename(file.name);
  const extension = filename.includes(".") ? filename.split(".").pop()?.toLowerCase() : "";
  if (!extensions || !extension || !extensions.includes(extension)) {
    return { ok: false, reason: "File type is not permitted." };
  }
  return { ok: true, filename };
}

export function validateFileSignature(buffer: ArrayBuffer, contentType: string): boolean {
  const bytes = new Uint8Array(buffer);
  const startsWith = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  switch (contentType) {
    case "application/pdf":
      return startsWith(0x25, 0x50, 0x44, 0x46, 0x2d);
    case "image/png":
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return startsWith(0xff, 0xd8, 0xff);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0x50, 0x4b, 0x05, 0x06) || startsWith(0x50, 0x4b, 0x07, 0x08);
    case "text/plain": {
      if (bytes.includes(0)) return false;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, 4096));
        return true;
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

export async function enforcePublicRateLimit(db: D1Database, ip: string, salt: string, now = Date.now()): Promise<boolean> {
  const windowStart = Math.floor(now / (PUBLIC_RATE_LIMIT.windowSeconds * 1000)) * PUBLIC_RATE_LIMIT.windowSeconds;
  const ipHash = await hmac(ip || "unknown", salt);
  const bucket = `${ipHash}:${windowStart}`;
  const result = await db.prepare(
    `INSERT INTO rate_limits (bucket_key, request_count, window_started_at, expires_at)
     VALUES (?, 1, datetime(?, 'unixepoch'), datetime(? + ?, 'unixepoch'))
     ON CONFLICT(bucket_key) DO UPDATE SET request_count = request_count + 1
     RETURNING request_count`,
  ).bind(bucket, windowStart, windowStart, PUBLIC_RATE_LIMIT.windowSeconds).first<{ request_count: number }>();
  return (result?.request_count ?? PUBLIC_RATE_LIMIT.requests + 1) <= PUBLIC_RATE_LIMIT.requests;
}

export async function verifyTurnstile(token: string, secret: string, remoteIp: string): Promise<boolean> {
  if (!token || !secret) return false;
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      response: token,
      remoteip: remoteIp,
      idempotency_key: crypto.randomUUID(),
    }),
  });
  if (!response.ok) return false;
  const result = await response.json<{ success?: boolean }>();
  return result.success === true;
}

export function csrfDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function redactedError(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
