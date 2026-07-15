PRAGMA foreign_keys = ON;

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  department TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE complaint_categories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  default_confidentiality TEXT NOT NULL DEFAULT 'Confidential'
    CHECK (default_confidentiality IN ('Restricted', 'Confidential', 'Internal', 'General')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sequence_counters (
  sequence_name TEXT NOT NULL,
  sequence_year INTEGER NOT NULL CHECK (sequence_year >= 2020),
  next_value INTEGER NOT NULL CHECK (next_value > 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sequence_name, sequence_year)
);

CREATE TABLE complaints (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE CHECK (length(case_id) = 15 AND substr(case_id, 1, 4) = 'CMP-' AND substr(case_id, 9, 1) = '-'),
  complaint_reference TEXT NOT NULL UNIQUE,
  tracking_token_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'Public web form',
  complainant_type TEXT NOT NULL CHECK (complainant_type IN ('Internal', 'External', 'Anonymous')),
  category_id TEXT NOT NULL REFERENCES complaint_categories(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 5 AND 200),
  summary TEXT NOT NULL,
  full_description TEXT NOT NULL,
  incident_date TEXT,
  location TEXT,
  project TEXT,
  department TEXT,
  subject_details TEXT,
  estimated_financial_impact REAL NOT NULL DEFAULT 0 CHECK (estimated_financial_impact >= 0),
  confidentiality TEXT NOT NULL DEFAULT 'Confidential'
    CHECK (confidentiality IN ('Restricted', 'Confidential', 'Internal', 'General')),
  risk_rating TEXT NOT NULL DEFAULT 'Medium' CHECK (risk_rating IN ('Critical', 'High', 'Medium', 'Low')),
  risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Urgent', 'High', 'Normal', 'Low')),
  status TEXT NOT NULL DEFAULT 'New' CHECK (status IN (
    'New', 'Acknowledged', 'Preliminary Assessment', 'Pending Information', 'Pending Assignment',
    'Investigation Ongoing', 'Pending Review', 'Returned for Amendment', 'Pending Management Decision',
    'Referred', 'Outcome Communication Pending', 'Corrective Action Monitoring', 'Closed', 'Reopened'
  )),
  public_status TEXT NOT NULL DEFAULT 'Received' CHECK (public_status IN ('Received', 'Under assessment', 'In progress', 'Completed')),
  sla_due_at TEXT,
  investigation_due_at TEXT,
  last_action_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_action TEXT,
  next_action_due_at TEXT,
  investigation_outcome TEXT,
  closure_reason TEXT,
  closed_at TEXT,
  reopened_at TEXT,
  acknowledged_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE complainants (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL UNIQUE REFERENCES complaints(id) ON DELETE RESTRICT,
  full_name TEXT,
  email TEXT,
  telephone TEXT,
  organisation TEXT,
  preferred_communication TEXT NOT NULL CHECK (preferred_communication IN ('Email', 'Telephone', 'Secure tracking', 'None')),
  privacy_consent_at TEXT NOT NULL,
  confidentiality_acknowledged_at TEXT NOT NULL,
  declaration_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE complaint_subjects (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  subject_type TEXT NOT NULL DEFAULT 'Person or organisation',
  name_or_description TEXT NOT NULL,
  organisation TEXT,
  position_title TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE complaint_assignments (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assignment_type TEXT NOT NULL CHECK (assignment_type IN ('PRIMARY', 'SUPPORTING')),
  scope TEXT NOT NULL,
  instructions TEXT,
  assigned_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  end_reason TEXT,
  conflict_declared INTEGER NOT NULL DEFAULT 0 CHECK (conflict_declared IN (0, 1)),
  conflict_details TEXT
);

CREATE UNIQUE INDEX uq_active_primary_assignment
  ON complaint_assignments(complaint_id) WHERE assignment_type = 'PRIMARY' AND ended_at IS NULL;
CREATE INDEX idx_assignments_user_active ON complaint_assignments(user_id, ended_at);

CREATE TABLE preliminary_assessments (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  within_jurisdiction INTEGER NOT NULL CHECK (within_jurisdiction IN (0, 1)),
  information_sufficient INTEGER NOT NULL CHECK (information_sufficient IN (0, 1)),
  duplicate_complaint INTEGER NOT NULL CHECK (duplicate_complaint IN (0, 1)),
  existing_related_case INTEGER NOT NULL CHECK (existing_related_case IN (0, 1)),
  bribery_corruption INTEGER NOT NULL CHECK (bribery_corruption IN (0, 1)),
  fraud INTEGER NOT NULL CHECK (fraud IN (0, 1)),
  misconduct INTEGER NOT NULL CHECK (misconduct IN (0, 1)),
  conflict_of_interest INTEGER NOT NULL CHECK (conflict_of_interest IN (0, 1)),
  abuse_of_power INTEGER NOT NULL CHECK (abuse_of_power IN (0, 1)),
  procurement_irregularities INTEGER NOT NULL CHECK (procurement_irregularities IN (0, 1)),
  senior_management_involved INTEGER NOT NULL CHECK (senior_management_involved IN (0, 1)),
  evidence_destruction_risk INTEGER NOT NULL CHECK (evidence_destruction_risk IN (0, 1)),
  immediate_risk INTEGER NOT NULL CHECK (immediate_risk IN (0, 1)),
  assessor_conflict INTEGER NOT NULL CHECK (assessor_conflict IN (0, 1)),
  recommended_risk TEXT NOT NULL CHECK (recommended_risk IN ('Critical', 'High', 'Medium', 'Low')),
  decision TEXT NOT NULL,
  decision_reason TEXT NOT NULL,
  remarks TEXT,
  related_case_id TEXT,
  assessed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (complaint_id, version)
);

CREATE TABLE investigation_activities (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  activity_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  officer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  next_action TEXT,
  next_action_due_at TEXT,
  attachment_references TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('Restricted', 'Confidential', 'Internal', 'General')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE investigation_findings (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  allegations TEXT NOT NULL,
  analysis TEXT NOT NULL,
  findings TEXT NOT NULL,
  recommendations TEXT NOT NULL,
  outcome TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'SUPERSEDED')),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TEXT,
  UNIQUE (complaint_id, version)
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  activity_id TEXT REFERENCES investigation_activities(id) ON DELETE SET NULL,
  corrective_action_id TEXT,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  checksum_sha256 TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('Restricted', 'Confidential', 'Internal', 'General')),
  source TEXT NOT NULL CHECK (source IN ('PUBLIC_SUBMISSION', 'INTERNAL_EVIDENCE', 'CORRECTIVE_ACTION')),
  verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED', 'QUARANTINED')),
  malware_scan_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED' CHECK (malware_scan_status IN ('NOT_CONFIGURED', 'PENDING', 'CLEAN', 'INFECTED', 'ERROR')),
  uploader_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  replaced_attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  deleted_at TEXT,
  deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  deletion_reason TEXT
);

CREATE INDEX idx_attachments_case ON attachments(complaint_id, deleted_at);

CREATE TABLE approval_versions (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  finding_id TEXT NOT NULL REFERENCES investigation_findings(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  snapshot TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (complaint_id, version)
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  approval_version_id TEXT NOT NULL REFERENCES approval_versions(id) ON DELETE RESTRICT,
  stage TEXT NOT NULL CHECK (stage IN ('REVIEWER', 'MANAGEMENT', 'LEGAL', 'HR')),
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  approver_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approver_role TEXT NOT NULL,
  decision TEXT NOT NULL,
  remarks TEXT NOT NULL,
  decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  returned_to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  subsequent_action TEXT,
  UNIQUE (approval_version_id, stage, sequence_number)
);

CREATE TABLE corrective_actions (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL UNIQUE,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  recommendation TEXT NOT NULL,
  action_owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  responsible_department TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
  target_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Pending Evidence', 'Pending Verification', 'Overdue', 'Completed', 'Closed', 'Rejected')),
  progress_update TEXT,
  integrity_verifier_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  verification_remarks TEXT,
  verified_at TEXT,
  completion_date TEXT,
  closure_approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  monitoring_transferred INTEGER NOT NULL DEFAULT 0 CHECK (monitoring_transferred IN (0, 1)),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  CHECK (integrity_verifier_id IS NULL OR integrity_verifier_id <> action_owner_id),
  CHECK (closure_approved_by IS NULL OR closure_approved_by <> action_owner_id)
);

CREATE TABLE corrective_action_updates (
  id TEXT PRIMARY KEY,
  corrective_action_id TEXT NOT NULL REFERENCES corrective_actions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  progress_update TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE case_relationships (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  related_complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('RELATED', 'DUPLICATE', 'PARENT', 'CHILD')),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (complaint_id, related_complaint_id, relationship_type),
  CHECK (complaint_id <> related_complaint_id)
);

CREATE TABLE communications (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  communication_type TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND', 'INTERNAL')),
  channel TEXT NOT NULL,
  recipient TEXT,
  subject TEXT,
  summary TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'COMPLETED')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  complaint_id TEXT REFERENCES complaints(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  idempotency_key TEXT UNIQUE,
  delivery_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING', 'SENT', 'SKIPPED', 'FAILED', 'DELIVERED')),
  provider_message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  read_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sla_rules (
  id TEXT PRIMARY KEY,
  category_id TEXT REFERENCES complaint_categories(id) ON DELETE CASCADE,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('Critical', 'High', 'Medium', 'Low')),
  target_business_days INTEGER NOT NULL CHECK (target_business_days > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (category_id, risk_level)
);

CREATE TABLE sla_events (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  stage_key TEXT NOT NULL,
  due_at TEXT NOT NULL,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (complaint_id, event_type, stage_key)
);

CREATE TABLE sla_extensions (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  previous_due_date TEXT NOT NULL,
  revised_due_date TEXT NOT NULL,
  delay_reason TEXT NOT NULL,
  justification TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE status_history (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  correlation_id TEXT NOT NULL,
  ip_hash TEXT,
  session_metadata TEXT,
  reason TEXT,
  source TEXT NOT NULL CHECK (source IN ('PUBLIC', 'INTERNAL', 'SCHEDULED', 'SYSTEM'))
);

CREATE TABLE application_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 0 CHECK (is_secret IN (0, 1)),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rate_limits (
  bucket_key TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  window_started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_complaints_status ON complaints(status, deleted_at);
CREATE INDEX idx_complaints_risk ON complaints(risk_rating, deleted_at);
CREATE INDEX idx_complaints_category ON complaints(category_id, deleted_at);
CREATE INDEX idx_complaints_department ON complaints(department, deleted_at);
CREATE INDEX idx_complaints_sla ON complaints(sla_due_at, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_complaints_created ON complaints(created_at DESC);
CREATE INDEX idx_complaints_search_title ON complaints(title COLLATE NOCASE);
CREATE INDEX idx_subjects_case ON complaint_subjects(complaint_id);
CREATE INDEX idx_activities_case ON investigation_activities(complaint_id, occurred_at DESC);
CREATE INDEX idx_findings_case ON investigation_findings(complaint_id, version DESC);
CREATE INDEX idx_approvals_case ON approvals(complaint_id, decided_at DESC);
CREATE INDEX idx_actions_owner ON corrective_actions(action_owner_id, status);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, timestamp DESC);
CREATE INDEX idx_audit_user ON audit_logs(user_id, timestamp DESC);
CREATE INDEX idx_status_history_case ON status_history(complaint_id, changed_at DESC);

CREATE TRIGGER audit_logs_immutable_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'Audit logs are immutable');
END;

CREATE TRIGGER audit_logs_immutable_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'Audit logs are immutable');
END;

CREATE TRIGGER status_history_immutable_update
BEFORE UPDATE ON status_history
BEGIN
  SELECT RAISE(ABORT, 'Status history is immutable');
END;

CREATE TRIGGER status_history_immutable_delete
BEFORE DELETE ON status_history
BEGIN
  SELECT RAISE(ABORT, 'Status history is immutable');
END;

CREATE TRIGGER approvals_immutable_update
BEFORE UPDATE ON approvals
BEGIN
  SELECT RAISE(ABORT, 'Approval decisions are immutable');
END;

CREATE TRIGGER approvals_immutable_delete
BEFORE DELETE ON approvals
BEGIN
  SELECT RAISE(ABORT, 'Approval decisions are immutable');
END;
