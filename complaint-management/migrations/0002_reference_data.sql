INSERT INTO roles (id, code, name, description) VALUES
  ('role-system-admin', 'SYSTEM_ADMINISTRATOR', 'System Administrator', 'Platform configuration, users, roles and all cases.'),
  ('role-integrity-admin', 'INTEGRITY_ADMINISTRATOR', 'Integrity Administrator', 'Complaint registration, triage, assignment and oversight.'),
  ('role-integrity-officer', 'INTEGRITY_OFFICER', 'Integrity Officer', 'Complaint assessment and integrity operations.'),
  ('role-case-officer', 'CASE_OFFICER', 'Case Officer / Investigator', 'Assigned-case investigation activities and findings.'),
  ('role-reviewer', 'REVIEWER', 'Reviewer / Head of Unit', 'Review of submitted findings and escalations.'),
  ('role-management', 'MANAGEMENT_APPROVER', 'Management Approver', 'Final management decisions.'),
  ('role-action-owner', 'DEPARTMENT_ACTION_OWNER', 'Department Action Owner', 'Assigned corrective actions only.'),
  ('role-auditor', 'AUDITOR', 'Auditor / Read-Only User', 'Read-only case and immutable audit access.');

INSERT INTO complaint_categories (id, code, name, default_confidentiality) VALUES
  ('cat-bribery', 'BRIBERY', 'Bribery / corruption', 'Restricted'),
  ('cat-fraud', 'FRAUD', 'Fraud', 'Restricted'),
  ('cat-misconduct', 'MISCONDUCT', 'Misconduct', 'Confidential'),
  ('cat-coi', 'CONFLICT', 'Conflict of interest', 'Confidential'),
  ('cat-abuse', 'ABUSE', 'Abuse of power', 'Confidential'),
  ('cat-procurement', 'PROCUREMENT', 'Procurement irregularity', 'Restricted'),
  ('cat-retaliation', 'RETALIATION', 'Retaliation / victimisation', 'Restricted'),
  ('cat-other', 'OTHER', 'Other integrity concern', 'Confidential');

INSERT INTO sla_rules (id, category_id, risk_level, target_business_days) VALUES
  ('sla-critical', NULL, 'Critical', 7),
  ('sla-high', NULL, 'High', 15),
  ('sla-medium', NULL, 'Medium', 30),
  ('sla-low', NULL, 'Low', 45);

INSERT INTO application_settings (setting_key, setting_value) VALUES
  ('allowed_upload_extensions', '["pdf","jpg","jpeg","png","txt","docx","xlsx"]'),
  ('max_upload_bytes', '10485760'),
  ('sla_reminder_days', '[7,3,0]'),
  ('sla_overdue_repeat_days', '3'),
  ('malware_scanner_mode', 'integration-required');
