import type { Env } from "./types";

export interface NotificationMessage {
  eventType: string;
  subject: string;
  body: string;
  recipientEmail?: string;
  userId?: string;
  complaintId?: string;
  actionUrl?: string;
  idempotencyKey?: string;
}

interface ExternalNotificationProvider {
  send(message: NotificationMessage): Promise<{ status: "SENT" | "SKIPPED" | "FAILED"; providerId?: string }>;
}

class InAppOnlyProvider implements ExternalNotificationProvider {
  async send(): Promise<{ status: "SKIPPED" }> {
    return { status: "SKIPPED" };
  }
}

class MicrosoftGraphProvider implements ExternalNotificationProvider {
  constructor(private readonly env: Env) {}

  async send(message: NotificationMessage): Promise<{ status: "SENT" | "SKIPPED" | "FAILED"; providerId?: string }> {
    if (!message.recipientEmail) return { status: "SKIPPED" };
    const { GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER_EMAIL } = this.env;
    if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET || !GRAPH_SENDER_EMAIL) return { status: "FAILED" };
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(GRAPH_TENANT_ID)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GRAPH_CLIENT_ID,
        client_secret: GRAPH_CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    });
    if (!tokenResponse.ok) return { status: "FAILED" };
    const token = await tokenResponse.json<{ access_token: string }>();
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(GRAPH_SENDER_EMAIL)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: message.subject,
          body: { contentType: "Text", content: message.body },
          toRecipients: [{ emailAddress: { address: message.recipientEmail } }],
        },
        saveToSentItems: false,
      }),
    });
    return response.ok ? { status: "SENT" } : { status: "FAILED" };
  }
}

function provider(env: Env): ExternalNotificationProvider {
  return env.NOTIFICATION_PROVIDER === "microsoft-graph" ? new MicrosoftGraphProvider(env) : new InAppOnlyProvider();
}

export async function notify(env: Env, message: NotificationMessage): Promise<void> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO notifications
      (id, user_id, complaint_id, event_type, subject, body, action_url, idempotency_key, delivery_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
  ).bind(
    id, message.userId ?? null, message.complaintId ?? null, message.eventType, message.subject,
    message.body, message.actionUrl ?? null, message.idempotencyKey ?? null,
  ).run();
  const outcome = await provider(env).send(message);
  await env.DB.prepare(
    `UPDATE notifications SET delivery_status = ?, provider_message_id = ?, attempts = attempts + 1,
      delivered_at = CASE WHEN ? = 'SENT' THEN CURRENT_TIMESTAMP ELSE delivered_at END,
      last_error = CASE WHEN ? = 'FAILED' THEN 'Provider delivery failed' ELSE NULL END
     WHERE id = ?`,
  ).bind(outcome.status, outcome.providerId ?? null, outcome.status, outcome.status, id).run();
}
