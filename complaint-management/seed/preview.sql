-- Preview-only seed. Do not include this file in production migrations.
INSERT OR IGNORE INTO users (id, email, display_name, department) VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin@example.invalid', 'Amina Rahman', 'Integrity'),
  ('00000000-0000-4000-8000-000000000002', 'officer@example.invalid', 'Daniel Wong', 'Integrity'),
  ('00000000-0000-4000-8000-000000000003', 'reviewer@example.invalid', 'Nur Izzati', 'Integrity'),
  ('00000000-0000-4000-8000-000000000004', 'approver@example.invalid', 'Michael Lee', 'Management'),
  ('00000000-0000-4000-8000-000000000005', 'owner@example.invalid', 'Sara Lim', 'Procurement'),
  ('00000000-0000-4000-8000-000000000006', 'auditor@example.invalid', 'Omar Hassan', 'Internal Audit');

INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES
  ('00000000-0000-4000-8000-000000000001', 'role-system-admin'),
  ('00000000-0000-4000-8000-000000000001', 'role-integrity-admin'),
  ('00000000-0000-4000-8000-000000000002', 'role-case-officer'),
  ('00000000-0000-4000-8000-000000000002', 'role-integrity-officer'),
  ('00000000-0000-4000-8000-000000000003', 'role-reviewer'),
  ('00000000-0000-4000-8000-000000000004', 'role-management'),
  ('00000000-0000-4000-8000-000000000005', 'role-action-owner'),
  ('00000000-0000-4000-8000-000000000006', 'role-auditor');
