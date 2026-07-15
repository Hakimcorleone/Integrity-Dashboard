# User roles and permissions

## Permission matrix

| Capability | Sys admin | Integrity admin | Integrity officer | Case officer | Reviewer | Mgmt approver | Action owner | Auditor |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Configure users/roles | ✓ | View | — | — | — | — | — | View audit only |
| Configure SLA/settings | ✓ | ✓ | — | — | — | — | — | View |
| View all cases | ✓ | ✓ | ✓ | Assigned | ✓ | ✓ | Action-related | ✓ |
| Preliminary assessment | ✓ | ✓ | ✓ | — | — | — | — | — |
| Assign/reassign | ✓ | ✓ | — | — | ✓ | — | — | — |
| Investigation activity | ✓ | ✓ | ✓ | Assigned | — | — | — | — |
| Evidence upload/download | ✓ | ✓ | ✓ | Assigned | Read | Read | Action evidence | Read per policy |
| Submit findings | ✓ | ✓ | ✓ | Assigned | — | — | — | — |
| Reviewer decision | ✓ | — | — | — | ✓ | — | — | — |
| Final decision | ✓ | — | — | — | — | ✓ | — | — |
| Create corrective action | ✓ | ✓ | — | — | ✓ | ✓ | — | — |
| Update action | ✓ | ✓ | — | — | ✓ | ✓ | Own | — |
| Verify/close action | ✓ | ✓ | — | — | ✓ | ✓ | Never own | — |
| Close/reopen case | ✓ | ✓ | — | — | — | ✓ | — | — |
| Audit log | ✓ | ✓ | — | — | — | — | — | ✓ |

“View” never implies mutation. Case-level rules narrow this matrix further.

## Administration

- Users must have an email in `ALLOWED_EMAIL_DOMAIN`.
- Authentication through Access does not automatically create or authorize a user.
- Role changes require System Administrator permission and create audit events.
- Disable users instead of deleting them so historical attribution remains intact.
- Avoid combining Action Owner and verification roles for the same business process.

## Conflict of interest

An assessor declaring a conflict cannot complete that assessment. Assignments record conflict status/details and must be ended/reassigned with a reason. A conflicted investigator must not retain active access through assignment.

## Read-only audit

Auditors can view cases/audit according to policy but cannot mutate when Auditor is their only role. Exports exclude complainant contact and full narrative fields by default.
