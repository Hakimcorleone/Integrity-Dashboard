import {
  Bell, ClipboardCheck, FileBarChart, FolderKanban, Gauge, ListChecks, Menu, Settings, ShieldCheck, Users, X,
} from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import type { Actor } from "../../shared/types";
import { loadMe } from "../api";

const ActorContext = createContext<Actor | null>(null);
export const useActor = () => useContext(ActorContext);

export function PublicLayout() {
  return (
    <div className="public-shell">
      <header className="public-header">
        <Link to="/" className="brand" aria-label="Integrity Case Management home">
          <span className="brand-mark"><ShieldCheck size={22} /></span>
          <span><b>Integrity</b><small>Case Management</small></span>
        </Link>
        <nav aria-label="Public navigation">
          <Link to="/">Submit a complaint</Link>
          <Link to="/track">Track submission</Link>
          <Link to="/login" className="button button-secondary">Staff access</Link>
        </nav>
      </header>
      <main><Outlet /></main>
      <footer className="public-footer"><span>Secure reporting channel</span><span>Confidential · Protected · Auditable</span></footer>
    </div>
  );
}

const navigation = [
  ["Dashboard", "/portal", Gauge], ["Complaint register", "/portal/cases", FolderKanban],
  ["Approval inbox", "/portal/approvals", ClipboardCheck], ["Corrective actions", "/portal/actions", ListChecks],
  ["Reports", "/portal/reports", FileBarChart], ["Notifications", "/portal/notifications", Bell],
  ["Users & roles", "/portal/users", Users], ["System settings", "/portal/settings", Settings],
  ["Audit log", "/portal/audit", ShieldCheck],
] as const;

export function PortalLayout() {
  const [actor, setActor] = useState<Actor | null>(null);
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { loadMe().then(setActor).catch(() => setError("Your session is not authorised for the Integrity portal.")); }, []);
  if (error) return <div className="auth-state"><ShieldCheck size={42} /><h1>Access restricted</h1><p>{error}</p><Link className="button" to="/login">Return to access page</Link></div>;
  if (!actor) return <div className="auth-state"><span className="spinner" /><p>Verifying secure access…</p></div>;
  return (
    <ActorContext.Provider value={actor}>
      <div className="portal-shell">
        <aside className={mobileOpen ? "sidebar open" : "sidebar"}>
          <div className="sidebar-top">
            <Link to="/portal" className="brand brand-inverse" onClick={() => setMobileOpen(false)}>
              <span className="brand-mark"><ShieldCheck size={22} /></span><span><b>Integrity</b><small>Case Management</small></span>
            </Link>
            <button className="icon-button mobile-only" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X /></button>
          </div>
          <nav className="sidebar-nav" aria-label="Portal navigation">
            {navigation.map(([label, href, Icon]) => (
              <NavLink key={href} to={href} end={href === "/portal"} onClick={() => setMobileOpen(false)}>
                <Icon size={18} />{label}
              </NavLink>
            ))}
          </nav>
          <div className="profile-card"><span className="avatar">{actor.displayName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><b>{actor.displayName}</b><small>{actor.roles[0]?.replaceAll("_", " ")}</small></span></div>
        </aside>
        <div className="portal-main">
          <header className="portal-header">
            <button className="icon-button mobile-only" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></button>
            <div><span className="environment-pill">Protected workspace</span><small>Confidential case information</small></div>
            <Link to="/portal/notifications" className="icon-button" aria-label="Notifications"><Bell size={20} /></Link>
          </header>
          <main className="portal-content"><Outlet /></main>
        </div>
      </div>
    </ActorContext.Provider>
  );
}
