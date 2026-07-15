# Cloudflare deployment

## Environments

| Resource | Preview | Production |
|---|---|---|
| Worker | `integrity-complaints-preview` | `integrity-complaints-production` |
| D1 | `integrity-complaints-preview` | `integrity-complaints-production` |
| R2 | `integrity-evidence-preview` | `integrity-evidence-production` |
| Turnstile | Preview widget/test key | Production widget |
| Access | Preview application/audience | Production application/audience |
| Secrets | GitHub `preview` environment | GitHub `production` environment |

The resources must never be cross-bound. Preview seed data is prohibited in production.

## Required GitHub environment configuration

Secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` scoped to the target account and required Worker/D1/R2/Turnstile operations
- `PREVIEW_TURNSTILE_SECRET_KEY` or `PRODUCTION_TURNSTILE_SECRET_KEY`
- `PREVIEW_CSRF_SECRET` or `PRODUCTION_CSRF_SECRET`
- `PREVIEW_RATE_LIMIT_SALT` or `PRODUCTION_RATE_LIMIT_SALT`
- `PREVIEW_ACCESS_AUD` or `PRODUCTION_ACCESS_AUD`
- optional Microsoft Graph secrets in production

Variables:

- `PREVIEW_D1_DATABASE_ID` or `PRODUCTION_D1_DATABASE_ID`
- `PREVIEW_TURNSTILE_SITE_KEY` or `PRODUCTION_TURNSTILE_SITE_KEY`
- `ALLOWED_EMAIL_DOMAIN`
- `TEAM_DOMAIN`

## Access policies

Configure a self-hosted Cloudflare Access application for the deployed hostname with protected paths:

- `/portal*`
- `/api/internal/*`

Allow only the authorised organisation domain/groups. The public `/`, `/track`, `/api/public/*`, static assets and `/api/health` remain reachable. Configure separate audience values per environment and supply them to the Worker.

## Workflow order

1. CI installs locked dependencies, type-checks, lints and tests.
2. A fresh local D1 applies every migration.
3. The client and Worker dry-run bundle build.
4. The environment-specific D1 ID/domain/Turnstile key are injected into an ephemeral CI copy of `wrangler.jsonc`.
5. Remote D1 migrations run.
6. Vite builds static assets.
7. The official Wrangler action publishes the Worker and supplies secrets.
8. The workflow calls `/api/health` with retries.
9. Human/automated acceptance verifies Turnstile, D1, R2, Access and the critical workflow before promotion.

## Migration safety

- Migrations are forward-only and committed before deployment.
- Back up/bookmark D1 before destructive schema changes.
- Prefer additive migrations and staged backfills.
- Never delete audit, approval or status-history records.
- A failed migration prevents deployment.

## Verification checklist

- Public page and form load without console errors.
- Production Turnstile token passes Siteverify.
- A synthetic complaint creates D1 complaint, complainant, status and audit rows.
- A permitted file creates a private R2 object and D1 attachment row.
- Direct R2 access is unavailable; authorized Worker download succeeds and audits.
- Internal paths redirect through Access; forged/absent JWTs fail.
- Dashboard/register load according to role scope.
- Triage → assignment → activity → findings → reviewer → management → communication → action → closure works.
- Closure and self-verification bypasses are rejected.
- Scheduled handler and Cron Trigger exist.
- Preview and production bindings refer to different IDs and buckets.
- Repository and browser bundles contain no secret values.
