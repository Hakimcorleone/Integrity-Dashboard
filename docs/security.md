# Security model

## Trust boundaries

- Public input is untrusted, including filenames, MIME types, tracking values and Turnstile tokens.
- Client-side role checks are presentation only. The Worker is the authorization boundary.
- D1 and R2 bindings are server-only. Neither resource is public or present in the frontend bundle.
- GitHub and Cloudflare secrets are account-level trust boundaries and never enter Git history.

## Authentication

Cloudflare Access places a signed application JWT in `Cf-Access-Jwt-Assertion`. The Worker verifies RS256 signature, issuer, audience and expiry against the Access JWKS, then enforces the configured email domain and active D1 user. The `CF_Authorization` cookie is not used as an unverified identity source.

Production cannot activate the development header bypass because it additionally requires a non-production environment.

## Authorization

Authorization combines:

1. an active authenticated D1 user;
2. one or more server-resolved roles;
3. route-specific permission;
4. case-level access (global oversight, active assignment, or owned corrective action);
5. workflow state and segregation-of-duties rules.

An action owner cannot verify or close their own corrective action. Auditors are read-only unless they also hold a mutation-capable role.

## Public abuse protection

- Turnstile Siteverify is mandatory and fail-closed.
- Tokens are single-use and validated with a generated idempotency key.
- Fixed-window D1 rate limiting stores only a keyed hash of the source address.
- Tracking requires both an unguessable reference and a 256-bit token; only its SHA-256 digest is stored.
- Public tracking returns one of four safe states and no internal detail.

## CSRF, XSS and browser security

- Internal mutations require a same-origin HMAC CSRF header obtained through the authenticated API.
- The client does not use local/session storage for authentication or case information.
- React escapes text by default; no raw HTML rendering is used.
- CSP permits only same-origin assets and the exact Cloudflare Turnstile origins.
- HSTS, nosniff, frame denial, permissions policy, referrer policy and no-store API caching are set by the Worker.

## SQL and mass assignment

- Every query uses bound parameters.
- Filter column names come from fixed server maps, never request values.
- Zod schemas enumerate accepted properties and enforce length/range/enum rules.
- Domain actions write explicit columns; request objects are never spread into persistence models.

## Evidence security

- Allowlisted MIME/extension pairs, maximum size and count are enforced.
- Filenames are normalized, stripped of path components/control characters and stored only as metadata.
- Object keys use random UUIDs and are not returned as public URLs.
- SHA-256 checksum, uploader, time, source, classification and scan state are stored in D1.
- Downloads re-check case and classification permission, stream through the Worker, disable caching and create an audit event.
- Public uploads are distinct from verified internal evidence.
- Malware-scanner state supports pending, clean, infected, quarantined and error outcomes. An approved scanner must be integrated before production evidence acceptance.

## Audit and privacy

Audit rows contain actor, action, entity, before/after snapshots where appropriate, correlation ID, time, reason, source and a hashed address where relevant. Database triggers reject update/delete operations on audit logs, status history and approval decisions.

Application errors expose a correlation ID but not SQL, storage keys, tokens, stack traces or personal data. Worker logs record route, method, correlation ID and error class only.

## Secrets

Required secrets are stored with Cloudflare Worker secrets and protected GitHub environments. Repository scanning in CI rejects common private-key and credential patterns. Rotation should invalidate the prior secret after both environments are verified.
