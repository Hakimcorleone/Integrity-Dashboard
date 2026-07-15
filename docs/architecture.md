# Complaint Management System architecture

## Cloudflare architecture

```mermaid
flowchart TB
  subgraph Internet
    P[Public complainant]
    S[Internal user]
  end
  subgraph Cloudflare
    T[Turnstile]
    A[Cloudflare Access]
    W[Worker + React assets]
    D[(D1 database)]
    R[(Private R2 evidence)]
    C[Cron Trigger]
  end
  subgraph Approved providers
    M[Microsoft Graph or future provider]
  end
  P --> T --> W
  S --> A --> W
  W --> D
  W --> R
  C --> W
  W -. metadata-only notification .-> M
```

The public and internal interfaces share one deployment but use separate route security. `/api/public/*` permits only narrow intake/tracking operations. `/portal*` and `/api/internal/*` are protected by Cloudflare Access at the edge and independently authenticated by the Worker.

## Component responsibilities

| Component | Responsibility |
|---|---|
| React client | Accessible workflows; no authorization decisions or confidential persistent storage |
| Worker API | Validation, authentication, RBAC, case scope, workflow, audit and safe responses |
| D1 | Relational case data, constraints, sequence allocation, audit and idempotency |
| R2 | Private evidence objects accessed only through authorized Worker routes |
| Turnstile | Human verification; every token is validated by Siteverify |
| Access | Organisation identity and edge enforcement for internal routes |
| Cron | Daily SLA evaluation and escalation events |
| Notification provider | In-app history; optional Microsoft Graph delivery |

## Complaint submission flow

```mermaid
sequenceDiagram
  participant C as Complainant
  participant UI as Public UI
  participant T as Turnstile
  participant W as Worker
  participant D as D1
  participant R as R2
  C->>UI: Enter complaint and files
  UI->>T: Complete verification
  UI->>W: Multipart submission + token
  W->>T: Siteverify validation
  W->>D: Enforce rate limit and allocate Case ID
  W->>R: Store objects under random private keys
  W->>D: Atomic complaint, metadata, status and audit batch
  W-->>C: Reference + one-time tracking token
```

## Internal case-management flow

```mermaid
flowchart LR
  New --> Ack[Acknowledged]
  Ack --> PA[Preliminary Assessment]
  PA --> PI[Pending Information]
  PI --> PA
  PA --> Assign[Pending Assignment]
  Assign --> Inv[Investigation Ongoing]
  Inv --> Review[Pending Review]
  Review --> Return[Returned for Amendment]
  Return --> Inv
  Review --> Mgmt[Pending Management Decision]
  Mgmt --> Outcome[Outcome Communication Pending]
  Outcome --> CAM[Corrective Action Monitoring]
  Outcome --> Closed
  CAM --> Closed
  Closed --> Reopened
  Reopened --> Inv
```

Only domain actions create status changes. There is no generic “set status” endpoint.

## Deployment flow

```mermaid
flowchart LR
  Branch[Feature branch] --> CI[Typecheck + lint + tests + migration + build]
  CI --> PR[Pull request]
  PR --> Preview[Preview D1/R2/Worker]
  Preview --> Verify[Health and workflow verification]
  Verify --> Main[Main branch]
  Main --> ProdMig[Production D1 migrations]
  ProdMig --> Prod[Production Worker]
  Prod --> ProdVerify[Production verification]
```
