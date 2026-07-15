# Operations guide

## Daily operations

- Review new Preliminary Assessment cases and Critical/High risk cards.
- Review overdue cases and corrective actions; record approved extensions before changing due dates.
- Monitor failed notification delivery and retry only after correcting provider configuration.
- Review quarantined/pending evidence and scanner integration state.
- Keep next action and due date current for every active investigation.

## Incident response

1. Preserve the correlation ID, timestamp, user and affected entity.
2. Do not copy complaint content into tickets or general chat.
3. Review Worker logs, audit log and Cloudflare security events using the correlation ID.
4. Disable a compromised internal user in D1/administration and revoke Access sessions.
5. Rotate affected Worker/GitHub secrets and verify both environments.
6. Preserve relevant D1/R2 data under legal hold; do not delete suspected evidence.
7. Document containment, recovery and post-incident control changes.

## Notification failures

- `FAILED` notifications retain attempts and a non-sensitive error state.
- In-app notification remains the system record even if email fails.
- Do not attach evidence to retry messages.
- Validate Graph application permission, sender mailbox and secret expiry through approved administration.

## SLA extensions

Every overdue extension needs delay reason, revised date, justification, approver and approval date. Extension does not erase prior SLA events. Repeated overdue stages remain idempotent by unique stage key.

## Evidence operations

- Treat Public Submission files as unverified.
- Integrate an approved malware scanner and quarantine unsafe/failed scans before production use.
- Verify checksum and source before classifying an object as internal evidence.
- Download only through the case workspace; raw R2 access is an operational emergency privilege.
- Deletion requires retention authority, a reason and an immutable audit event.

## Backup and recovery

- Record a D1 Time Travel/bookmark before migrations and high-risk bulk operations.
- Restore into an isolated Worker/D1/R2 preview environment first.
- Verify row counts, foreign keys, recent audit chain, attachment metadata and sample authorized downloads.
- Rebind production only after security/management approval.
- Apply R2 lifecycle/retention rules consistent with legal and records-management policy.

## Monitoring

Monitor:

- `/api/health` availability and deployment version;
- Worker error rate/latency and D1/R2 failures;
- Turnstile validation and public 429 rates;
- Access denied/authentication anomalies;
- failed notifications and Cron execution;
- overdue SLA/action totals;
- evidence scan backlog;
- immutable-trigger violations.

Logs must remain metadata-only. Never add request-body, complainant, finding, token or filename logging.

## Release verification

Use synthetic data. Verify intake, tracking, D1, R2, Access, RBAC, workflow, closure guards, segregation of duties, Cron and security headers. Confirm preview resource identifiers differ from production before promotion.

## Data subject and retention requests

Route privacy/retention actions through authorised legal/records procedures. Do not directly erase complaint or audit records without confirming statutory obligations, holds, investigation requirements and approved redaction/retention treatment.
