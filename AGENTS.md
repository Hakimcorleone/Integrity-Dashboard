# Instructions for coding agents

## Scope and architecture

- Preserve the original Python/Streamlit Integrity Risk Modelling Lab unless a task explicitly changes it.
- The Complaint Management System lives in `complaint-management/` and deploys as a Cloudflare Worker with React static assets, D1, private R2, Turnstile, Access and Cron Triggers.
- Do not introduce another hosting provider, public database, public object bucket, or client-side authentication store.

## Coding conventions

- Use TypeScript strict mode and keep server/domain logic in `src/worker/`.
- Use Zod at API boundaries. Accept only allowlisted fields; do not mass-assign request bodies.
- Use parameterised D1 statements. Do not concatenate untrusted values into SQL.
- Keep API responses in `{ data, correlationId }` envelopes and safe errors in `{ error, correlationId }`.
- Do not log request bodies, complainant details, evidence names, access tokens or findings.
- Do not place authentication tokens or complaint information in local/session storage or URLs.

## Database rules

- Add forward-only, versioned migrations in `complaint-management/migrations/`.
- Preserve foreign keys, constraints and indexes for workflow-critical fields.
- Audit logs, status history and approval decisions are immutable.
- Use soft deletion when retention may apply. Evidence deletion requires explicit authorization, reason and audit entry.
- Do not store relational operational data as unvalidated JSON. JSON snapshots are allowed only for immutable approval/audit representations.
- Case IDs must be allocated through the atomic `sequence_counters` update; never derive them from row IDs or counts.

## Security requirements

- Every internal API must authenticate Cloudflare Access and enforce server-side roles and case scope.
- Mutations require CSRF validation and input validation.
- All evidence operations require case permission and audit logging. Never expose raw R2 URLs.
- Public submission requires Turnstile, rate limiting and strict upload validation.
- Keep CSP and security headers restrictive. Any relaxation needs a documented security reason and test.
- Production must fail closed when Access, Turnstile or secret configuration is missing.
- Never commit secrets. Use Cloudflare secrets and protected GitHub environment secrets.

## Testing requirements

- Run type checking, linting, unit/integration tests, local D1 migrations and the production build for every change.
- Add tests for every role/permission change, workflow transition, SLA rule, Case ID change and upload policy change.
- Do not weaken assertions, thresholds or security controls to make checks pass.
- Exercise critical workflows against local D1/R2 when API behavior changes.

## Git workflow

- Work on a dedicated feature branch.
- Keep commits logical and reviewable; do not rewrite unrelated history or force-push.
- Pull requests must describe architecture impact, migrations, security controls, tests, limitations and deployment state.
- Do not merge failing checks.

## Cloudflare deployment

- Preview and production must use separate Workers, D1 databases, R2 buckets, Turnstile keys, Access audiences and secrets.
- Wrangler configuration is the source of truth. Keep environment resource names stable.
- Apply D1 migrations before deploying the Worker and verify `/api/health` afterward.
- Never seed `seed/preview.sql` into production.
- Do not claim success until the deployed public form, D1 write, R2 write/download, protected portal and workflow have been verified.
