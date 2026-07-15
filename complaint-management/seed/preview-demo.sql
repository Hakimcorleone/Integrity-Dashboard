-- Synthetic preview-only case-management scenarios. Never execute in production.
INSERT INTO sequence_counters (sequence_name, sequence_year, next_value)
VALUES ('complaint_case', CAST(strftime('%Y', 'now') AS INTEGER), 20)
ON CONFLICT(sequence_name, sequence_year) DO UPDATE SET next_value = MAX(next_value, 20);

INSERT OR IGNORE INTO complaints
  (id, case_id, complaint_reference, tracking_token_hash, source, complainant_type, category_id, title, summary, full_description,
   incident_date, location, project, department, subject_details, estimated_financial_impact, confidentiality, risk_rating,
   risk_score, priority, status, public_status, sla_due_at, created_at, updated_at, closed_at, investigation_outcome, closure_reason)
VALUES
  ('10000000-0000-4000-8000-000000000010', 'CMP-2026-000010', 'CR-2026-DEMO00000010', '1010101010101010101010101010101010101010101010101010101010101010', 'Preview seed', 'Internal', 'cat-misconduct', 'Unrecorded hospitality declaration', 'A hospitality declaration may not have been recorded.', 'Synthetic preview scenario: an employee reports an omitted hospitality declaration requiring registration review.', date('now','-2 days'), 'Head Office', NULL, 'Corporate Services', 'Synthetic employee A', 0, 'Confidential', 'Low', 12, 'Normal', 'New', 'Received', date('now','+45 days'), datetime('now','-2 days'), datetime('now','-2 days'), NULL, NULL, NULL),
  ('10000000-0000-4000-8000-000000000011', 'CMP-2026-000011', 'CR-2026-DEMO00000011', '1111111111111111111111111111111111111111111111111111111111111111', 'Preview seed', 'External', 'cat-bribery', 'Alleged facilitation payment in land approval', 'Critical allegation involving a senior decision maker.', 'Synthetic preview scenario: a third party alleges a facilitation payment linked to a land approval.', date('now','-6 days'), 'Central Region', 'Housing Project Alpha', 'Project Management', 'Synthetic senior manager', 2500000, 'Restricted', 'Critical', 88, 'Urgent', 'Preliminary Assessment', 'Under assessment', date('now','+2 days'), datetime('now','-6 days'), datetime('now','-1 day'), NULL, NULL, NULL),
  ('10000000-0000-4000-8000-000000000012', 'CMP-2026-000012', 'CR-2026-DEMO00000012', '1212121212121212121212121212121212121212121212121212121212121212', 'Preview seed', 'Internal', 'cat-other', 'Operational access-control exception', 'Medium-risk operational integrity concern.', 'Synthetic preview scenario: repeated privileged access exceptions were approved without complete evidence.', date('now','-14 days'), 'Data Centre', NULL, 'IT', 'Synthetic operations team', 50000, 'Internal', 'Medium', 32, 'Normal', 'Pending Assignment', 'Under assessment', date('now','+18 days'), datetime('now','-14 days'), datetime('now','-3 days'), NULL, NULL, NULL),
  ('10000000-0000-4000-8000-000000000013', 'CMP-2026-000013', 'CR-2026-DEMO00000013', '1313131313131313131313131313131313131313131313131313131313131313', 'Preview seed', 'Anonymous', 'cat-abuse', 'Anonymous report of roster manipulation', 'Anonymous allegation concerning abuse of authority.', 'Synthetic preview scenario: an anonymous reporter alleges that work rosters were manipulated as retaliation.', date('now','-9 days'), 'Northern Region', NULL, 'Operations', 'Synthetic supervisor', 0, 'Restricted', 'High', 54, 'High', 'Preliminary Assessment', 'Under assessment', date('now','+8 days'), datetime('now','-9 days'), datetime('now','-2 days'), NULL, NULL, NULL),
  ('10000000-0000-4000-8000-000000000014', 'CMP-2026-000014', 'CR-2026-DEMO00000014', '1414141414141414141414141414141414141414141414141414141414141414', 'Preview seed', 'External', 'cat-fraud', 'Invoice duplication concern', 'Additional invoice detail has been requested.', 'Synthetic preview scenario: a supplier identifies a potential duplicate invoice but has not provided the invoice number.', date('now','-20 days'), 'East Coast', 'Maintenance Package B', 'Finance', 'Synthetic vendor record', 125000, 'Confidential', 'Medium', 38, 'Normal', 'Pending Information', 'Under assessment', date('now','+10 days'), datetime('now','-20 days'), datetime('now','-4 days'), NULL, NULL, NULL),
  ('10000000-0000-4000-8000-000000000015', 'CMP-2026-000015', 'CR-2026-DEMO00000015', '1515151515151515151515151515151515151515151515151515151515151515', 'Preview seed', 'Internal', 'cat-coi', 'Undeclared evaluation-panel relationship', 'Investigation is reviewing evaluation records and declarations.', 'Synthetic preview scenario: an evaluator may have an undeclared relationship with a bidder director.', date('now','-25 days'), 'Head Office', 'Tender Gamma', 'Procurement', 'Synthetic evaluation officer', 750000, 'Restricted', 'High', 61, 'High', 'Investigation Ongoing', 'In progress', date('now','+5 days'), datetime('now','-25 days'), datetime('now','-1 day'), NULL, NULL, NULL),
  ('10000000-0000-4000-8000-000000000016', 'CMP-2026-000016', 'CR-2026-DEMO00000016', '1616161616161616161616161616161616161616161616161616161616161616', 'Preview seed', 'Internal', 'cat-misconduct', 'Policy override without recorded authority', 'Findings have been submitted for reviewer approval.', 'Synthetic preview scenario: a policy exception was applied without evidence of delegated authority.', date('now','-38 days'), 'Head Office', NULL, 'Corporate Services', 'Synthetic department lead', 0, 'Confidential', 'Medium', 35, 'Normal', 'Pending Review', 'In progress', date('now','+3 days'), datetime('now','-38 days'), datetime('now','-1 day'), NULL, NULL, NULL),
  ('10000000-0000-4000-8000-000000000017', 'CMP-2026-000017', 'CR-2026-DEMO00000017', '1717171717171717171717171717171717171717171717171717171717171717', 'Preview seed', 'External', 'cat-procurement', 'Tender scoring change after closure', 'High-risk procurement investigation is overdue.', 'Synthetic preview scenario: scoring weights changed after tender closure without an approval record.', date('now','-70 days'), 'Southern Region', 'Tender Delta', 'Procurement', 'Synthetic evaluation committee', 1800000, 'Restricted', 'High', 67, 'Urgent', 'Investigation Ongoing', 'In progress', date('now','-6 days'), datetime('now','-70 days'), datetime('now','-4 days'), NULL, NULL, NULL),
  ('10000000-0000-4000-8000-000000000018', 'CMP-2026-000018', 'CR-2026-DEMO00000018', '1818181818181818181818181818181818181818181818181818181818181818', 'Preview seed', 'Internal', 'cat-other', 'Control documentation gap', 'Completed low-risk control documentation case.', 'Synthetic preview scenario: a control document was outdated; no misconduct was established and remediation was completed.', date('now','-120 days'), 'Head Office', NULL, 'Finance', 'Synthetic control owner', 0, 'Internal', 'Low', 8, 'Low', 'Closed', 'Completed', date('now','-75 days'), datetime('now','-120 days'), datetime('now','-70 days'), datetime('now','-70 days'), 'Unsubstantiated', 'Control gap corrected; final decision and communication completed.'),
  ('10000000-0000-4000-8000-000000000019', 'CMP-2026-000019', 'CR-2026-DEMO00000019', '1919191919191919191919191919191919191919191919191919191919191919', 'Preview seed', 'Internal', 'cat-procurement', 'Incomplete procurement change log', 'Corrective action evidence is pending independent verification.', 'Synthetic preview scenario: approved findings led to a corrective action to make procurement change logs immutable.', date('now','-90 days'), 'Head Office', 'Tender Epsilon', 'Procurement', 'Synthetic process owner', 350000, 'Confidential', 'Medium', 42, 'Normal', 'Corrective Action Monitoring', 'In progress', date('now','+5 days'), datetime('now','-90 days'), datetime('now','-2 days'), NULL, 'Substantiated', NULL);

INSERT OR IGNORE INTO complainants
  (id, complaint_id, full_name, email, preferred_communication, privacy_consent_at, confidentiality_acknowledged_at, declaration_at)
SELECT '20000000-0000-4000-8000-' || substr(id, 25), id,
  CASE WHEN complainant_type = 'Anonymous' THEN NULL ELSE 'Synthetic Preview Reporter' END,
  CASE WHEN complainant_type = 'Anonymous' THEN NULL ELSE 'reporter@example.invalid' END,
  CASE WHEN complainant_type = 'Anonymous' THEN 'Secure tracking' ELSE 'Email' END,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM complaints WHERE source = 'Preview seed';

INSERT OR IGNORE INTO complaint_assignments
  (id, complaint_id, user_id, reviewer_id, assignment_type, scope, instructions, assigned_by)
SELECT '30000000-0000-4000-8000-' || substr(id, 25), id,
  '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003',
  'PRIMARY', 'Synthetic preview investigation scope.', 'Use synthetic records only.', '00000000-0000-4000-8000-000000000001'
FROM complaints WHERE id IN (
  '10000000-0000-4000-8000-000000000015',
  '10000000-0000-4000-8000-000000000016',
  '10000000-0000-4000-8000-000000000017',
  '10000000-0000-4000-8000-000000000019'
);

INSERT OR IGNORE INTO investigation_findings
  (id, complaint_id, version, allegations, analysis, findings, recommendations, outcome, status, created_by, submitted_at)
VALUES
  ('40000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000016', 1,
   'Synthetic policy override allegation.', 'Synthetic documentary analysis.', 'Control override was not supported by delegated authority.',
   'Introduce a delegated-authority validation step.', 'Substantiated', 'SUBMITTED', '00000000-0000-4000-8000-000000000002', datetime('now','-1 day'));

INSERT OR IGNORE INTO approval_versions
  (id, complaint_id, finding_id, version, snapshot, created_by)
VALUES
  ('50000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000016',
   '40000000-0000-4000-8000-000000000016', 1, '{"synthetic":true,"version":1}',
   '00000000-0000-4000-8000-000000000002');

INSERT OR IGNORE INTO corrective_actions
  (id, action_id, complaint_id, recommendation, action_owner_id, responsible_department, priority, target_date, status,
   progress_update, created_by)
VALUES
  ('60000000-0000-4000-8000-000000000019', 'ACT-2026-DEMO0019', '10000000-0000-4000-8000-000000000019',
   'Implement immutable procurement change logging.', '00000000-0000-4000-8000-000000000005', 'Procurement', 'High',
   date('now','+14 days'), 'Pending Verification', 'Synthetic completion evidence submitted.',
   '00000000-0000-4000-8000-000000000001');
