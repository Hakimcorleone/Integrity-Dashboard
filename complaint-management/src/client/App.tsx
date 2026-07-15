import { Navigate, Route, Routes } from "react-router-dom";
import { PublicLayout, PortalLayout } from "./components/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { CaseDetailPage, CasesPage } from "./pages/CasesPage";
import { LoginPage, PublicSubmitPage, TrackPage } from "./pages/PublicPages";
import {
  ActionsPage,
  ApprovalsPage,
  AuditPage,
  NotificationsPage,
  ReportsPage,
  SettingsPage,
  UsersPage,
} from "./pages/ManagementPages";

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<PublicSubmitPage />} />
        <Route path="track" element={<TrackPage />} />
        <Route path="login" element={<LoginPage />} />
      </Route>
      <Route path="portal" element={<PortalLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="cases" element={<CasesPage />} />
        <Route path="cases/:caseId" element={<CaseDetailPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="actions" element={<ActionsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
