import type { ComplaintStatus, RiskLevel, RoleCode } from "./constants";

export interface Actor {
  id: string;
  email: string;
  displayName: string;
  department: string | null;
  roles: RoleCode[];
}

export interface ComplaintListItem {
  id: string;
  caseId: string;
  dateReceived: string;
  title: string;
  category: string;
  department: string | null;
  riskRating: RiskLevel;
  status: ComplaintStatus;
  assignedOfficer: string | null;
  slaDueAt: string | null;
  isOverdue: boolean;
  confidentiality: string;
}

export interface DashboardData {
  metrics: Record<string, number>;
  byStatus: Array<{ label: string; value: number }>;
  byRisk: Array<{ label: string; value: number }>;
  byCategory: Array<{ label: string; value: number }>;
  monthlyTrend: Array<{ label: string; value: number }>;
}

export interface ApiEnvelope<T> {
  data: T;
  correlationId: string;
}
