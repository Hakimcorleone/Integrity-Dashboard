import type { Actor } from "../shared/types";

let csrfToken = "";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly details?: unknown) {
    super(message);
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (csrfToken && !["GET", "HEAD"].includes(options.method ?? "GET")) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() as any : null;
  if (!response.ok) throw new ApiError(payload?.error ?? `Request failed (${response.status})`, response.status, payload?.details);
  return payload?.data as T;
}

export async function loadMe(): Promise<Actor> {
  const actor = await request<Actor & { csrfToken: string }>("/api/internal/me");
  csrfToken = actor.csrfToken;
  return actor;
}

export function jsonBody(value: unknown): Pick<RequestInit, "body"> {
  return { body: JSON.stringify(value) };
}
