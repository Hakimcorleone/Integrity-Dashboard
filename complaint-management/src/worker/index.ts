import { Hono } from "hono";
import { ZodError } from "zod";
import { authenticate, verifyCsrf } from "./auth";
import { internalApi } from "./api/internal";
import { publicApi } from "./api/public";
import { processSlaReminders } from "./sla";
import { redactedError, SECURITY_HEADERS } from "./security";
import type { AppBindings, Env } from "./types";

export const app = new Hono<AppBindings>();

app.use("*", async (context, next) => {
  const supplied = context.req.header("X-Correlation-ID");
  const correlationId = supplied && /^[a-zA-Z0-9._-]{8,100}$/.test(supplied) ? supplied : crypto.randomUUID();
  context.set("correlationId", correlationId);
  await next();
  context.header("X-Correlation-ID", correlationId);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) context.header(name, value);
  if (context.req.path.startsWith("/api/")) context.header("Cache-Control", "no-store");
});

app.get("/api/health", (context) => context.json({
  status: "ok",
  service: "integrity-complaints",
  environment: context.env.ENVIRONMENT,
  timestamp: new Date().toISOString(),
  correlationId: context.get("correlationId"),
}));

app.route("/api/public", publicApi);
app.use("/api/internal/*", authenticate);
app.use("/api/internal/*", verifyCsrf);
app.route("/api/internal", internalApi);

app.notFound(async (context) => {
  if (context.req.path.startsWith("/api/")) {
    return context.json({ error: "Resource not found.", correlationId: context.get("correlationId") }, 404);
  }
  return context.env.ASSETS.fetch(context.req.raw);
});

app.onError((error, context) => {
  const correlationId = context.get("correlationId") || crypto.randomUUID();
  if (error instanceof ZodError || error.message === "VALIDATION") {
    const details = error instanceof ZodError ? error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) : undefined;
    return context.json({ error: "Request validation failed.", details, correlationId }, 400);
  }
  const statusMap = new Map<string, 400 | 403 | 404 | 409 | 422>([
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["INVALID_STATE", 409],
    ["CONCURRENT_CASE_UPDATE", 409],
    ["VERSION_NOT_FOUND", 409],
    ["CONFLICT_OF_INTEREST", 422],
    ["INVALID_ASSIGNEE", 422],
    ["INVALID_EMAIL_DOMAIN", 422],
    ["INVALID_ROLE", 422],
    ["SEGREGATION_OF_DUTIES", 422],
    ["CLOSURE_REQUIREMENTS", 422],
  ]);
  const status = statusMap.get(error.message);
  if (status) {
    const messages: Record<string, string> = {
      FORBIDDEN: "Access denied.", NOT_FOUND: "Resource not found.", INVALID_STATE: "This action is not valid at the current workflow stage.",
      CONCURRENT_CASE_UPDATE: "The case was changed by another user. Refresh and try again.", VERSION_NOT_FOUND: "The reviewed version no longer exists.",
      CONFLICT_OF_INTEREST: "The assessor must declare the conflict and another assessor must complete this action.", INVALID_ASSIGNEE: "The selected assignee is not eligible.",
      INVALID_EMAIL_DOMAIN: "The email domain is not authorised.", INVALID_ROLE: "One or more roles are invalid.",
      SEGREGATION_OF_DUTIES: "An action owner cannot verify or close their own corrective action.",
      CLOSURE_REQUIREMENTS: "The case cannot close until approval, findings, communication, and corrective-action requirements are satisfied.",
    };
    return context.json({ error: messages[error.message] ?? "Request could not be completed.", correlationId }, status);
  }
  console.error(JSON.stringify({ correlationId, errorType: redactedError(error), route: context.req.path, method: context.req.method }));
  return context.json({ error: "An unexpected error occurred.", correlationId }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, executionContext: ExecutionContext): Promise<void> {
    executionContext.waitUntil(processSlaReminders(env));
  },
} satisfies ExportedHandler<Env>;
