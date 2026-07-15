import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import type { RoleCode } from "../shared/constants";
import type { Actor } from "../shared/types";
import type { AppBindings, Env } from "./types";
import { csrfDate, hmac, constantTimeEqual } from "./security";

interface AccessClaims {
  email?: string;
  name?: string;
}

async function accessIdentity(request: Request, env: Env): Promise<{ email: string; name: string }> {
  const devEmail = request.headers.get("X-Dev-User");
  if (env.ENVIRONMENT !== "production" && env.DEV_AUTH_BYPASS === "1" && devEmail) {
    return { email: devEmail.toLowerCase(), name: request.headers.get("X-Dev-Name") ?? devEmail };
  }

  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!assertion || !env.TEAM_DOMAIN || !env.ACCESS_AUD) throw new Error("UNAUTHENTICATED");
  const issuer = env.TEAM_DOMAIN.replace(/\/$/, "");
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const { payload } = await jwtVerify(assertion, jwks, {
    issuer,
    audience: env.ACCESS_AUD,
    algorithms: ["RS256"],
  });
  const claims = payload as AccessClaims;
  if (!claims.email) throw new Error("UNAUTHENTICATED");
  return { email: claims.email.toLowerCase(), name: claims.name ?? claims.email };
}

async function loadActor(db: D1Database, identity: { email: string; name: string }, domain: string): Promise<Actor> {
  const expectedDomain = domain.toLowerCase().replace(/^@/, "");
  if (!identity.email.endsWith(`@${expectedDomain}`)) throw new Error("FORBIDDEN");
  const user = await db.prepare(
    "SELECT id, email, display_name, department FROM users WHERE lower(email) = ? AND active = 1 AND deleted_at IS NULL",
  ).bind(identity.email).first<{ id: string; email: string; display_name: string; department: string | null }>();
  if (!user) throw new Error("FORBIDDEN");
  const roleResult = await db.prepare(
    `SELECT r.code FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ?`,
  ).bind(user.id).all<{ code: RoleCode }>();
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name || identity.name,
    department: user.department,
    roles: roleResult.results.map((item) => item.code),
  };
}

export const authenticate: MiddlewareHandler<AppBindings> = async (context, next) => {
  try {
    const identity = await accessIdentity(context.req.raw, context.env);
    const actor = await loadActor(context.env.DB, identity, context.env.ALLOWED_EMAIL_DOMAIN);
    context.set("actor", actor);
    await next();
  } catch (error) {
    const status = error instanceof Error && error.message === "FORBIDDEN" ? 403 : 401;
    return context.json({ error: status === 403 ? "Access denied." : "Authentication required.", correlationId: context.get("correlationId") }, status);
  }
};

export async function csrfToken(email: string, secret: string, date = csrfDate()): Promise<string> {
  return hmac(`${email}:${date}`, secret);
}

export const verifyCsrf: MiddlewareHandler<AppBindings> = async (context, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(context.req.method)) return next();
  const actor = context.get("actor");
  const supplied = context.req.header("X-CSRF-Token") ?? "";
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const current = await csrfToken(actor.email, context.env.CSRF_SECRET, csrfDate(today));
  const previous = await csrfToken(actor.email, context.env.CSRF_SECRET, csrfDate(yesterday));
  if (!constantTimeEqual(supplied, current) && !constantTimeEqual(supplied, previous)) {
    return context.json({ error: "Invalid CSRF token.", correlationId: context.get("correlationId") }, 403);
  }
  return next();
};
