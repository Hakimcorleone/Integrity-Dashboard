import { CheckCircle2, FileLock2, KeyRound, LockKeyhole, Send, ShieldCheck, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, request } from "../api";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; theme: string }) => string;
      remove: (widgetId: string) => void;
    };
  }
}

interface PublicConfig {
  appName: string;
  turnstileSiteKey: string;
  categories: Array<{ id: string; code: string; name: string }>;
  maxUploadBytes: number;
  acceptedFileTypes: string[];
}

interface Confirmation {
  reference: string;
  trackingToken: string;
  status: string;
}

function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let widgetId = "";
    const render = () => {
      if (container.current && window.turnstile && !container.current.hasChildNodes()) {
        widgetId = window.turnstile.render(container.current, { sitekey: siteKey, callback: onToken, "expired-callback": () => onToken(""), theme: "light" });
      }
    };
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]');
    if (existing) { if (window.turnstile) render(); else existing.addEventListener("load", render, { once: true }); }
    else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", render, { once: true });
      document.head.appendChild(script);
    }
    return () => { if (widgetId && window.turnstile) window.turnstile.remove(widgetId); };
  }, [siteKey, onToken]);
  return <div ref={container} aria-label="Human verification" />;
}

export function PublicSubmitPage() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [complainantType, setComplainantType] = useState("Internal");
  const [preferredCommunication, setPreferredCommunication] = useState("Email");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  useEffect(() => { request<PublicConfig>("/api/public/config").then(setConfig).catch((cause: Error) => setError(cause.message)); }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !turnstileToken) return;
    setSubmitting(true); setError("");
    const form = new FormData(event.currentTarget);
    form.set("turnstileToken", turnstileToken);
    for (const field of ["confidentialityAcknowledged", "declarationAccurate", "privacyConsent"]) form.set(field, form.has(field) ? "true" : "false");
    try {
      setConfirmation(await request<Confirmation>("/api/public/complaints", { method: "POST", body: form }));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Submission could not be completed.");
    } finally { setSubmitting(false); }
  };

  if (confirmation) return (
    <section className="confirmation-wrap">
      <div className="confirmation-card">
        <span className="success-icon"><CheckCircle2 /></span>
        <p className="eyebrow">Submission received</p>
        <h1>Your report has been recorded securely.</h1>
        <p>Save both values below. The access token is displayed once and will not be sent by email.</p>
        <div className="credential-box"><span>Complaint reference</span><strong>{confirmation.reference}</strong></div>
        <div className="credential-box sensitive"><span>Secret tracking token</span><strong>{confirmation.trackingToken}</strong></div>
        <div className="notice warning"><KeyRound size={19} /><p>Anyone with both values can view the limited public status. Do not share them.</p></div>
        <div className="button-row"><Link className="button" to="/track">Track this complaint</Link><button className="button button-secondary" onClick={() => setConfirmation(null)}>Submit another</button></div>
      </div>
    </section>
  );

  return (
    <>
      <section className="public-hero">
        <div>
          <p className="eyebrow">Speak up safely</p>
          <h1>Report an integrity concern with confidence.</h1>
          <p className="hero-copy">Your complaint will be handled through a controlled, confidential case-management process with restricted evidence access and a complete audit trail.</p>
          <div className="trust-row"><span><LockKeyhole />Encrypted in transit</span><span><FileLock2 />Evidence protected</span><span><ShieldCheck />Access controlled</span></div>
        </div>
        <aside className="hero-aside"><b>Need anonymity?</b><p>Select “Anonymous.” Personal details will not be required, and you will receive a secret tracking token.</p><Link to="/track">Already submitted? Track your status →</Link></aside>
      </section>
      <section className="form-section">
        <div className="form-intro"><p className="eyebrow">Secure complaint form</p><h2>Tell us what happened</h2><p>Fields marked with * are required. Avoid including information unrelated to the concern.</p></div>
        <form className="complaint-form" onSubmit={submit}>
          {error && <div className="notice error" role="alert">{error}</div>}
          <fieldset>
            <legend><span>01</span> About you</legend>
            <div className="choice-grid three">
              {([ ["Internal", "I work for the organisation"], ["External", "I am an external party"], ["Anonymous", "Do not collect my identity"] ] as const).map(([value, description]) => (
                <label className={`choice-card ${complainantType === value ? "selected" : ""}`} key={value}>
                  <input type="radio" name="complainantType" value={value} checked={complainantType === value} onChange={() => { setComplainantType(value); setPreferredCommunication(value === "Anonymous" ? "Secure tracking" : preferredCommunication === "Secure tracking" ? "Email" : preferredCommunication); }} />
                  <b>{value}</b><small>{description}</small>
                </label>
              ))}
            </div>
            {complainantType !== "Anonymous" && <div className="form-grid">
              <label>Full name *<input name="fullName" required autoComplete="name" maxLength={200} /></label>
              <label>Email address<input name="email" type="email" autoComplete="email" maxLength={320} /></label>
              <label>Telephone number<input name="telephone" type="tel" autoComplete="tel" maxLength={50} /></label>
              <label>Organisation<input name="organisation" maxLength={200} /></label>
            </div>}
            <label>Preferred communication method *<select name="preferredCommunication" required value={preferredCommunication} onChange={(event) => setPreferredCommunication(event.target.value)}><option>Email</option><option>Telephone</option><option>Secure tracking</option><option>None</option></select></label>
          </fieldset>
          <fieldset>
            <legend><span>02</span> Complaint details</legend>
            <div className="form-grid">
              <label>Complaint category *<select name="categoryId" required defaultValue=""><option value="" disabled>Select a category</option>{config?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <label>Subject or title *<input name="title" required minLength={5} maxLength={200} /></label>
              <label>Date of incident<input name="incidentDate" type="date" /></label>
              <label>Department involved<input name="department" maxLength={200} /></label>
              <label>Project<input name="project" maxLength={200} /></label>
              <label>Location<input name="location" maxLength={200} /></label>
            </div>
            <label>Person or organisation complained against<textarea name="subjectDetails" rows={3} maxLength={500} /></label>
            <label>Detailed complaint description *<textarea name="description" required minLength={20} maxLength={20000} rows={9} placeholder="Describe what happened, when, who was involved, and any steps already taken." /></label>
            <label>Estimated financial impact, if known<input name="financialImpact" type="number" min="0" max="1000000000" step="0.01" placeholder="0.00" /></label>
          </fieldset>
          <fieldset>
            <legend><span>03</span> Supporting documents</legend>
            <label className="upload-zone"><UploadCloud size={28} /><b>Add supporting documents</b><span>PDF, JPG, PNG, TXT, DOCX or XLSX · Maximum 5 files · {config ? Math.round(config.maxUploadBytes / 1024 / 1024) : 10} MB each</span><input name="attachments" type="file" multiple accept={config?.acceptedFileTypes.join(",")} /></label>
            <div className="notice"><FileLock2 size={19} /><p>Files are stored in a private evidence bucket. Downloads require case permission and are audited.</p></div>
          </fieldset>
          <fieldset>
            <legend><span>04</span> Declaration and consent</legend>
            <div className="check-list">
              <label><input name="confidentialityAcknowledged" type="checkbox" required /> I understand how confidentiality will be managed and that access is limited to authorised personnel.</label>
              <label><input name="declarationAccurate" type="checkbox" required /> I declare that the information provided is accurate to the best of my knowledge.</label>
              <label><input name="privacyConsent" type="checkbox" required /> I acknowledge the privacy notice and consent to processing for complaint management.</label>
            </div>
            {config && <Turnstile siteKey={config.turnstileSiteKey} onToken={setTurnstileToken} />}
          </fieldset>
          <button className="button button-large" type="submit" disabled={submitting || !turnstileToken}>{submitting ? "Submitting securely…" : <><Send size={18} /> Submit complaint</>}</button>
        </form>
      </section>
    </>
  );
}

export function TrackPage() {
  const [status, setStatus] = useState<{ status: string; lastUpdated: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setLoading(true); setError(""); setStatus(null);
    const form = new FormData(event.currentTarget);
    try { setStatus(await request("/api/public/track", { method: "POST", body: JSON.stringify({ reference: form.get("reference"), trackingToken: form.get("trackingToken") }), headers: { "Content-Type": "application/json" } })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Tracking failed."); }
    finally { setLoading(false); }
  };
  return <section className="narrow-page"><div className="page-card"><span className="large-icon"><KeyRound /></span><p className="eyebrow">Limited public tracking</p><h1>Check your complaint status</h1><p>For your protection, this page never displays investigation details, names, evidence, findings, or internal decisions.</p><form className="stack-form" onSubmit={submit}>{error && <div className="notice error">{error}</div>}<label>Complaint reference<input name="reference" required placeholder="CR-2026-XXXXXXXXXXXX" autoCapitalize="characters" /></label><label>Secret tracking token<input name="trackingToken" required type="password" autoComplete="off" /></label><button className="button button-large" disabled={loading}>{loading ? "Checking…" : "Check status"}</button></form>{status && <div className="tracking-result"><span>Current status</span><strong>{status.status}</strong><small>Last updated {new Date(status.lastUpdated).toLocaleDateString()}</small></div>}</div></section>;
}

export function LoginPage() {
  return <section className="narrow-page"><div className="page-card center"><span className="large-icon"><ShieldCheck /></span><p className="eyebrow">Authorised personnel only</p><h1>Integrity staff portal</h1><p>Access is protected by Cloudflare Access and your organisation identity. Every case view and significant action is recorded.</p><a className="button button-large" href="/portal">Continue with organisation sign-in</a><div className="notice"><LockKeyhole size={18} /><p>Do not proceed on a shared or untrusted device.</p></div></div></section>;
}
