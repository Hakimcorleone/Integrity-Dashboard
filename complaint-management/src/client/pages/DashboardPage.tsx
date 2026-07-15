import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, FileCheck2, Files, ShieldAlert, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DashboardData } from "../../shared/types";
import { request } from "../api";

const metricConfig = [
  ["totalComplaints", "Total complaints", Files, "blue"],
  ["newComplaints", "New today", FileCheck2, "teal"],
  ["openCases", "Open cases", Clock3, "amber"],
  ["closedCases", "Closed cases", CheckCircle2, "green"],
  ["overdueCases", "Overdue cases", AlertTriangle, "red"],
  ["highRiskCases", "Critical & high risk", ShieldAlert, "red"],
  ["awaitingAssessment", "Awaiting assessment", Files, "purple"],
  ["awaitingApproval", "Awaiting approval", FileCheck2, "amber"],
] as const;

function BarList({ title, data }: { title: string; data: Array<{ label: string; value: number }> }) {
  const max = Math.max(...data.map((item) => item.value), 1);
  return <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Distribution</p><h2>{title}</h2></div></div><div className="bar-list">{data.length ? data.map((item) => <div className="bar-row" key={item.label}><div><span>{item.label}</span><b>{item.value}</b></div><div className="bar-track"><span style={{ width: `${Math.max(4, item.value / max * 100)}%` }} /></div></div>) : <p className="empty-copy">No case data yet.</p>}</div></section>;
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { request<DashboardData>("/api/internal/dashboard").then(setData).catch((cause: Error) => setError(cause.message)); }, []);
  return <div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Operational overview</p><h1>Integrity dashboard</h1><p>Current complaint workload, risk exposure and service-level performance.</p></div><div className="heading-actions"><Link className="button button-secondary" to="/portal/reports">Open reports</Link><Link className="button" to="/portal/cases">View register <ArrowRight size={17} /></Link></div></header>
    {error && <div className="notice error">{error}</div>}
    {!data ? <div className="panel loading-panel"><span className="spinner" /> Loading dashboard…</div> : <>
      <section className="metrics-grid">{metricConfig.map(([key, label, Icon, tone]) => <article className="metric-card" key={key}><span className={`metric-icon ${tone}`}><Icon size={20} /></span><span>{label}</span><strong>{data.metrics[key] ?? 0}</strong></article>)}</section>
      <section className="performance-strip"><div><span className="metric-icon green"><TrendingUp size={20} /></span><p><b>{data.metrics.slaCompliance ?? 0}%</b><small>SLA compliance</small></p></div><div><span className="metric-icon blue"><Clock3 size={20} /></span><p><b>{data.metrics.averageDaysToClose ?? 0}</b><small>Average days to close</small></p></div><div><span className="metric-icon red"><AlertTriangle size={20} /></span><p><b>{data.metrics.overdueCases ?? 0}</b><small>Cases requiring escalation</small></p></div></section>
      <div className="dashboard-grid"><BarList title="Cases by status" data={data.byStatus} /><BarList title="Cases by risk rating" data={data.byRisk} /><BarList title="Leading complaint categories" data={data.byCategory} /><BarList title="Monthly intake trend" data={data.monthlyTrend} /></div>
    </>}
  </div>;
}
