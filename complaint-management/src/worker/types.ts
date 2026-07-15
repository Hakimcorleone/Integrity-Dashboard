import type { Actor } from "../shared/types";

export interface Env {
  DB: D1Database;
  EVIDENCE: R2Bucket;
  ASSETS: Fetcher;
  ENVIRONMENT: "preview" | "production" | "development";
  APP_NAME: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  MAX_UPLOAD_BYTES: string;
  ALLOWED_EMAIL_DOMAIN: string;
  CSRF_SECRET: string;
  RATE_LIMIT_SALT: string;
  TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_AUTH_BYPASS?: string;
  NOTIFICATION_PROVIDER: "in-app" | "microsoft-graph";
  GRAPH_TENANT_ID?: string;
  GRAPH_CLIENT_ID?: string;
  GRAPH_CLIENT_SECRET?: string;
  GRAPH_SENDER_EMAIL?: string;
}

export interface AppVariables {
  actor: Actor;
  correlationId: string;
}

export type AppBindings = {
  Bindings: Env;
  Variables: AppVariables;
};

export interface ComplaintRow {
  id: string;
  case_id: string;
  complaint_reference: string;
  title: string;
  status: string;
  public_status: string;
  risk_rating: string;
  confidentiality: string;
  department: string | null;
  sla_due_at: string | null;
  created_at: string;
  updated_at: string;
}
