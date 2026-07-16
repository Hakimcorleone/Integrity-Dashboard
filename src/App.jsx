import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_SCENARIO,
  RISK_LEVELS,
  RISK_META,
  evaluateScenario,
  formatCurrency,
  formatPercent,
} from "./lib/risk.js";


const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "transactions", label: "Transactions", icon: "list" },
  { id: "model", label: "Model Lab", icon: "pulse" },
  { id: "scenario", label: "Scenario", icon: "spark" },
];

const DEPARTMENTS = [
  "Facilities",
  "Procurement",
  "Project Management",
  "Finance",
  "IT",
  "Operations",
  "Corporate Services",
];

const REGIONS = [
  "Northern",
  "Central",
  "Southern",
  "East Coast",
  "Sabah",
  "Sarawak",
];

const PROCUREMENT_METHODS = [
  "Open Tender",
  "RFQ",
  "Direct Award",
  "Emergency Procurement",
  "Panel Vendor",
];

function Icon({ name, size = 18 }) {
  const paths = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    list: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </>
    ),
    pulse: <path d="M3 12h4l2.5-7 5 14 2.5-7h4" />,
    spark: (
      <>
        <path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z" />
        <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
      </>
    ),
    shield: (
      <path d="M12 3 4.5 6v5.2c0 4.7 3.2 8.5 7.5 9.8 4.3-1.3 7.5-5.1 7.5-9.8V6L12 3Z" />
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    arrow: <path d="m9 18 6-6-6-6" />,
    check: <path d="m5 12 4 4L19 6" />,
    alert: (
      <>
        <path d="M12 4 3 20h18L12 4Z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
        <path d="M4 19h16" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {paths[name] ?? paths.grid}
      </g>
    </svg>
  );
}

function RiskPill({ level }) {
  const meta = RISK_META[level] ?? RISK_META.Low;
  return (
    <span
      className="risk-pill"
      style={{ "--risk-color": meta.color, "--risk-tint": meta.tint }}
    >
      <span className="risk-dot" />
      {level}
    </span>
  );
}

function MetricCard({ eyebrow, value, detail, tone = "blue", icon = "grid" }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-icon">
        <Icon name={icon} size={20} />
      </div>
      <div>
        <p>{eyebrow}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <div className="section-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="empty-state">
      <Icon name="search" size={28} />
      <strong>No matching records</strong>
      <span>{message}</span>
    </div>
  );
}

function OverviewView({ data, onNavigate }) {
  const transactions = data.transactions;
  const total = transactions.length;
  const averageRisk =
    transactions.reduce((sum, row) => sum + row.risk_score, 0) / Math.max(total, 1);
  const reviewRequired = transactions.filter(
    (row) => row.review_required === "Yes",
  ).length;
  const critical = data.riskDistribution.Critical ?? 0;
  const bestModel = data.modelComparison[0];

  const riskRows = RISK_LEVELS.map((level) => ({
    label: level,
    value: data.riskDistribution[level] ?? 0,
    color: RISK_META[level].color,
  }));

  const procurementRows = useMemo(() => {
    const counts = new Map();
    transactions.forEach((row) => {
      counts.set(
        row.procurement_method,
        (counts.get(row.procurement_method) ?? 0) + 1,
      );
    });
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [transactions]);

  const departmentRows = useMemo(() => {
    const groups = new Map();
    transactions.forEach((row) => {
      const current = groups.get(row.department) ?? {
        label: row.department,
        total: 0,
        risk: 0,
        critical: 0,
      };
      current.total += 1;
      current.risk += row.risk_score;
      current.critical += row.risk_level === "Critical" ? 1 : 0;
      groups.set(row.department, current);
    });
    return [...groups.values()]
      .map((group) => ({
        ...group,
        average: group.risk / group.total,
      }))
      .sort((a, b) => b.average - a.average);
  }, [transactions]);

  const topCases = [...transactions]
    .sort((a, b) => b.risk_score - a.risk_score)
    .slice(0, 6);

  let cursor = 0;
  const donutSegments = riskRows.map((row) => {
    const start = cursor;
    cursor += (row.value / total) * 100;
    return `${row.color} ${start}% ${cursor}%`;
  });

  return (
    <>
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Integrity Risk Intelligence</span>
          <h1>See the signals.<br />Prioritise the review.</h1>
          <p>
            A transparent analytics workspace for exploring fully synthetic
            procurement transactions and review-priority signals.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => onNavigate("scenario")}>
              Test a scenario
              <Icon name="arrow" />
            </button>
            <button className="ghost-button" onClick={() => onNavigate("transactions")}>
              Explore records
            </button>
          </div>
        </div>
        <div className="hero-visual" aria-label="Integrity analytics visual">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="signal-core">
            <Icon name="shield" size={38} />
            <strong>{total.toLocaleString()}</strong>
            <span>synthetic signals</span>
          </div>
          <div className="floating-chip chip-critical">
            <span>Critical</span>
            <strong>{critical}</strong>
          </div>
          <div className="floating-chip chip-model">
            <span>Macro F1</span>
            <strong>{formatPercent(bestModel.macro_f1_score)}</strong>
          </div>
        </div>
      </section>

      <section className="metric-grid" aria-label="Portfolio metrics">
        <MetricCard
          detail="Synthetic procurement records"
          eyebrow="Transactions"
          icon="list"
          tone="blue"
          value={total.toLocaleString()}
        />
        <MetricCard
          detail="Across the complete portfolio"
          eyebrow="Average risk score"
          icon="pulse"
          tone="amber"
          value={averageRisk.toFixed(1)}
        />
        <MetricCard
          detail={`${formatPercent(reviewRequired / total)} of all records`}
          eyebrow="Review required"
          icon="alert"
          tone="rose"
          value={reviewRequired.toLocaleString()}
        />
        <MetricCard
          detail={bestModel.model}
          eyebrow="Best model accuracy"
          icon="spark"
          tone="violet"
          value={formatPercent(bestModel.accuracy)}
        />
      </section>

      <section className="dashboard-grid">
        <article className="panel distribution-panel">
          <SectionHeader
            description="Portfolio composition by synthetic review-priority band."
            eyebrow="Distribution"
            title="Risk landscape"
          />
          <div className="donut-layout">
            <div
              className="donut"
              style={{
                background: `conic-gradient(${donutSegments.join(", ")})`,
              }}
            >
              <div className="donut-center">
                <strong>{total.toLocaleString()}</strong>
                <span>records</span>
              </div>
            </div>
            <div className="legend-list">
              {riskRows.map((row) => (
                <div className="legend-row" key={row.label}>
                  <span className="legend-swatch" style={{ background: row.color }} />
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                  <small>{formatPercent(row.value / total, 0)}</small>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="panel">
          <SectionHeader
            description="How the synthetic portfolio was sourced."
            eyebrow="Procurement mix"
            title="Methods"
          />
          <div className="bar-list">
            {procurementRows.map((row) => {
              const max = procurementRows[0]?.value || 1;
              return (
                <div className="bar-row" key={row.label}>
                  <div className="bar-label">
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                  <div className="bar-track">
                    <span style={{ width: `${(row.value / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel wide-panel">
          <SectionHeader
            action={
              <button className="text-button" onClick={() => onNavigate("transactions")}>
                View all <Icon name="arrow" size={15} />
              </button>
            }
            description="Average score and critical volume by business area."
            eyebrow="Department exposure"
            title="Where attention concentrates"
          />
          <div className="department-table table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Transactions</th>
                  <th>Average score</th>
                  <th>Critical</th>
                  <th>Exposure</th>
                </tr>
              </thead>
              <tbody>
                {departmentRows.map((row) => (
                  <tr key={row.label}>
                    <td><strong>{row.label}</strong></td>
                    <td>{row.total}</td>
                    <td>{row.average.toFixed(1)}</td>
                    <td>{row.critical}</td>
                    <td>
                      <div className="mini-track">
                        <span style={{ width: `${row.average}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel wide-panel">
          <SectionHeader
            description="Highest synthetic scores for immediate exploration."
            eyebrow="Priority queue"
            title="Cases at the top"
          />
          <div className="case-grid">
            {topCases.map((row) => (
              <button
                className="case-card"
                key={row.transaction_id}
                onClick={() => onNavigate("transactions")}
              >
                <div>
                  <span>{row.transaction_id}</span>
                  <RiskPill level={row.risk_level} />
                </div>
                <strong>{row.vendor_id}</strong>
                <p>{row.department} · {row.procurement_method}</p>
                <footer>
                  <span>{formatCurrency(row.invoice_amount)}</span>
                  <b>{row.risk_score}</b>
                </footer>
              </button>
            ))}
          </div>
        </article>
      </section>
    </>
  );
}

function TransactionsView({ data }) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("All");
  const [region, setRegion] = useState("All");
  const [risk, setRisk] = useState("All");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return data.transactions.filter((row) => {
      const matchesQuery =
        !term ||
        row.transaction_id.toLowerCase().includes(term) ||
        row.vendor_id.toLowerCase().includes(term) ||
        row.procurement_method.toLowerCase().includes(term);
      return (
        matchesQuery &&
        (department === "All" || row.department === department) &&
        (region === "All" || row.region === region) &&
        (risk === "All" || row.risk_level === risk)
      );
    });
  }, [data.transactions, department, query, region, risk]);

  const downloadCsv = () => {
    const headers = Object.keys(data.transactions[0] ?? {});
    const escape = (value) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const csv = [
      headers.join(","),
      ...filtered.map((row) => headers.map((header) => escape(row[header])).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "integrity-risk-filtered.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="view-section">
      <SectionHeader
        action={
          <button className="ghost-button compact-button" onClick={downloadCsv}>
            <Icon name="download" size={16} /> Download filtered CSV
          </button>
        }
        description="Search and filter the fully synthetic transaction portfolio."
        eyebrow="Portfolio explorer"
        title="Transactions"
      />

      <div className="filter-bar">
        <label className="search-field">
          <Icon name="search" size={17} />
          <input
            aria-label="Search transactions"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search transaction, vendor, or method"
            value={query}
          />
        </label>
        <label>
          <span>Department</span>
          <select value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option>All</option>
            {DEPARTMENTS.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>Region</span>
          <select value={region} onChange={(event) => setRegion(event.target.value)}>
            <option>All</option>
            {REGIONS.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>Risk level</span>
          <select value={risk} onChange={(event) => setRisk(event.target.value)}>
            <option>All</option>
            {RISK_LEVELS.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
      </div>

      <div className="results-summary">
        <strong>{filtered.length.toLocaleString()}</strong>
        <span>matching synthetic transactions</span>
      </div>

      <article className="panel transaction-panel">
        {filtered.length ? (
          <div className="table-scroll">
            <table className="transaction-table">
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>Vendor</th>
                  <th>Department</th>
                  <th>Method</th>
                  <th>Invoice</th>
                  <th>Score</th>
                  <th>Priority</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((row) => (
                  <tr key={row.transaction_id}>
                    <td><strong>{row.transaction_id}</strong><small>{row.region}</small></td>
                    <td>{row.vendor_id}</td>
                    <td>{row.department}</td>
                    <td>{row.procurement_method}</td>
                    <td>{formatCurrency(row.invoice_amount)}</td>
                    <td><b className="score-number">{row.risk_score}</b></td>
                    <td><RiskPill level={row.risk_level} /></td>
                    <td>{row.review_required}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 100 ? (
              <p className="table-note">Showing the first 100 matches. Download the CSV for the complete filtered set.</p>
            ) : null}
          </div>
        ) : (
          <EmptyState message="Try removing one or more filters." />
        )}
      </article>
    </section>
  );
}

function ModelView({ data }) {
  const best = data.modelComparison[0];

  return (
    <section className="view-section">
      <SectionHeader
        description="A reproducible comparison of four classifiers trained on synthetic data."
        eyebrow="Model governance"
        title="Model Lab"
      />

      <div className="model-banner">
        <div>
          <span className="eyebrow">Selected by macro F1</span>
          <h3>{best.model}</h3>
          <p>
            The model supports human review prioritisation. It does not determine
            whether misconduct occurred.
          </p>
        </div>
        <div className="model-score">
          <strong>{formatPercent(best.macro_f1_score)}</strong>
          <span>Macro F1 score</span>
        </div>
      </div>

      <section className="metric-grid model-metrics">
        <MetricCard
          detail="Overall test-set performance"
          eyebrow="Accuracy"
          icon="check"
          tone="blue"
          value={formatPercent(best.accuracy)}
        />
        <MetricCard
          detail="Equal weight across classes"
          eyebrow="Macro precision"
          icon="pulse"
          tone="violet"
          value={formatPercent(best.macro_precision)}
        />
        <MetricCard
          detail="Sensitivity across classes"
          eyebrow="Macro recall"
          icon="alert"
          tone="amber"
          value={formatPercent(best.macro_recall)}
        />
        <MetricCard
          detail="Adjusted for class volume"
          eyebrow="Weighted F1"
          icon="spark"
          tone="rose"
          value={formatPercent(best.weighted_f1_score)}
        />
      </section>

      <article className="panel">
        <SectionHeader
          description="Models are ranked by macro F1 to give minority classes equal importance."
          eyebrow="Benchmark"
          title="Model comparison"
        />
        <div className="table-scroll">
          <table className="model-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Accuracy</th>
                <th>Precision</th>
                <th>Recall</th>
                <th>Macro F1</th>
                <th>Weighted F1</th>
              </tr>
            </thead>
            <tbody>
              {data.modelComparison.map((row, index) => (
                <tr key={row.model}>
                  <td>
                    <strong>{row.model}</strong>
                    {index === 0 ? <span className="best-badge">Selected</span> : null}
                  </td>
                  <td>{formatPercent(row.accuracy)}</td>
                  <td>{formatPercent(row.macro_precision)}</td>
                  <td>{formatPercent(row.macro_recall)}</td>
                  <td><strong>{formatPercent(row.macro_f1_score)}</strong></td>
                  <td>{formatPercent(row.weighted_f1_score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <div className="model-visual-grid">
        <article className="panel image-panel">
          <SectionHeader eyebrow="Error analysis" title="Confusion matrix" />
          <img
            alt="Confusion matrix for the selected model"
            src="/generated/confusion-matrix.png"
          />
        </article>
        <article className="panel image-panel">
          <SectionHeader eyebrow="Signal analysis" title="Feature importance" />
          <img
            alt="Feature importance for the selected model"
            src="/generated/feature-importance.png"
          />
        </article>
      </div>

      <article className="panel report-panel">
        <SectionHeader
          description="Repository-generated evaluation output, reproduced by GitHub Actions."
          eyebrow="Evaluation record"
          title="Classification report"
        />
        <pre>{data.classificationReport}</pre>
      </article>
    </section>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function ScenarioView() {
  const [scenario, setScenario] = useState(DEFAULT_SCENARIO);
  const [result, setResult] = useState(() => evaluateScenario(DEFAULT_SCENARIO));

  const setValue = (name, value) => {
    setScenario((current) => ({ ...current, [name]: value }));
  };

  const submit = (event) => {
    event.preventDefault();
    setResult(evaluateScenario(scenario));
  };

  const loadHighSignal = () => {
    const next = {
      ...DEFAULT_SCENARIO,
      procurement_method: "Direct Award",
      invoice_amount: 78000,
      claimed_units: 140,
      verified_units: 100,
      number_of_bidders: 1,
      tender_duration_days: 4,
      has_checker: false,
      past_complaints_12m: 3,
      variation_order_count: 3,
      variation_order_amount: 15000,
      late_delivery_days: 35,
      duplicate_invoice_flag: true,
    };
    setScenario(next);
    setResult(evaluateScenario(next));
  };

  const meta = RISK_META[result.level];

  return (
    <section className="view-section">
      <SectionHeader
        action={
          <button className="text-button" onClick={loadHighSignal} type="button">
            Load high-signal example <Icon name="spark" size={16} />
          </button>
        }
        description="Explore how transparent synthetic red-flag rules change review priority."
        eyebrow="Interactive analysis"
        title="Scenario Studio"
      />

      <div className="scenario-layout">
        <form className="panel scenario-form" onSubmit={submit}>
          <div className="form-section">
            <div className="form-section-title">
              <span>01</span>
              <div>
                <strong>Context</strong>
                <small>Business area and procurement route</small>
              </div>
            </div>
            <div className="form-grid three-columns">
              <Field label="Department">
                <select
                  value={scenario.department}
                  onChange={(event) => setValue("department", event.target.value)}
                >
                  {DEPARTMENTS.map((value) => <option key={value}>{value}</option>)}
                </select>
              </Field>
              <Field label="Region">
                <select
                  value={scenario.region}
                  onChange={(event) => setValue("region", event.target.value)}
                >
                  {REGIONS.map((value) => <option key={value}>{value}</option>)}
                </select>
              </Field>
              <Field label="Procurement method">
                <select
                  value={scenario.procurement_method}
                  onChange={(event) => setValue("procurement_method", event.target.value)}
                >
                  {PROCUREMENT_METHODS.map((value) => <option key={value}>{value}</option>)}
                </select>
              </Field>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">
              <span>02</span>
              <div>
                <strong>Commercial values</strong>
                <small>Contract, invoice, claims, and variations</small>
              </div>
            </div>
            <div className="form-grid three-columns">
              {[
                ["contract_amount", "Contract amount", 1000],
                ["invoice_amount", "Invoice amount", 1000],
                ["variation_order_amount", "Variation order amount", 500],
                ["claimed_units", "Claimed units", 1],
                ["verified_units", "Verified units", 1],
                ["variation_order_count", "Variation order count", 1],
              ].map(([name, label, step]) => (
                <Field key={name} label={label}>
                  <input
                    min="0"
                    step={step}
                    type="number"
                    value={scenario[name]}
                    onChange={(event) => setValue(name, Number(event.target.value))}
                  />
                </Field>
              ))}
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">
              <span>03</span>
              <div>
                <strong>Process controls</strong>
                <small>Competition, delivery, and oversight signals</small>
              </div>
            </div>
            <div className="form-grid three-columns">
              {[
                ["number_of_bidders", "Number of bidders"],
                ["tender_duration_days", "Tender duration (days)"],
                ["past_complaints_12m", "Complaints in 12 months"],
                ["late_delivery_days", "Late delivery (days)"],
              ].map(([name, label]) => (
                <Field key={name} label={label}>
                  <input
                    min="0"
                    step="1"
                    type="number"
                    value={scenario[name]}
                    onChange={(event) => setValue(name, Number(event.target.value))}
                  />
                </Field>
              ))}
            </div>
            <div className="toggle-grid">
              {[
                ["has_checker", "Checker completed"],
                ["has_approver", "Approver completed"],
                ["coi_declared", "COI declaration flagged"],
                ["duplicate_invoice_flag", "Duplicate invoice"],
                ["round_amount_flag", "Round amount"],
                ["split_purchase_flag", "Split purchase"],
              ].map(([name, label]) => (
                <label className="toggle-row" key={name}>
                  <span>{label}</span>
                  <input
                    checked={Boolean(scenario[name])}
                    type="checkbox"
                    onChange={(event) => setValue(name, event.target.checked)}
                  />
                  <i aria-hidden="true" />
                </label>
              ))}
            </div>
          </div>

          <button className="primary-button submit-button" type="submit">
            Analyse scenario <Icon name="spark" />
          </button>
        </form>

        <aside className="scenario-result">
          <div
            className="result-card"
            style={{ "--risk-color": meta.color, "--risk-tint": meta.tint }}
          >
            <span className="eyebrow">Current assessment</span>
            <div
              className="score-gauge"
              style={{
                background: `conic-gradient(${meta.color} ${result.score}%, rgba(255,255,255,.08) 0)`,
              }}
            >
              <div>
                <strong>{result.score}</strong>
                <span>/ 100</span>
              </div>
            </div>
            <RiskPill level={result.level} />
            <h3>{result.reviewRequired ? "Human review prioritised" : "Routine monitoring"}</h3>
            <p>
              This transparent score is a scenario-planning signal, not a finding
              or allegation of misconduct.
            </p>
          </div>

          <div className="panel signal-panel">
            <div className="signal-heading">
              <div>
                <span className="eyebrow">Active signals</span>
                <strong>{result.activeSignals.length}</strong>
              </div>
              <span>{result.activeSignals.reduce((sum, item) => sum + item.weight, 0)} raw points</span>
            </div>
            {result.activeSignals.length ? (
              <ul className="signal-list">
                {result.activeSignals.map((signal) => (
                  <li key={signal.label}>
                    <Icon name="alert" size={16} />
                    <span>{signal.label}</span>
                    <strong>+{signal.weight}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="quiet-state">
                <Icon name="check" size={22} />
                <span>No synthetic red-flag conditions are active.</span>
              </div>
            )}
          </div>

          <div className="ratio-grid">
            <div><span>Invoice / contract</span><strong>{formatPercent(result.ratios.invoice)}</strong></div>
            <div><span>Claim variance</span><strong>{formatPercent(result.ratios.claimVariance)}</strong></div>
            <div><span>Variation ratio</span><strong>{formatPercent(result.ratios.variationOrder)}</strong></div>
          </div>
        </aside>
      </div>
    </section>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="brand-mark"><Icon name="shield" size={26} /></div>
      <div className="loading-line"><span /></div>
      <strong>Preparing integrity intelligence</strong>
      <span>Loading synthetic portfolio and model outputs…</span>
    </main>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState("overview");
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    fetch("/generated/dashboard-data.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Dashboard data returned HTTP ${response.status}.`);
        }
        return response.json();
      })
      .then(setData)
      .catch((error) => setLoadError(error.message));
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeView]);

  if (loadError) {
    return (
      <main className="fatal-state">
        <Icon name="alert" size={34} />
        <h1>Dashboard assets are unavailable</h1>
        <p>{loadError}</p>
        <span>Run <code>npm run build</code> to regenerate the static data bundle.</span>
      </main>
    );
  }

  if (!data) return <LoadingScreen />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setActiveView("overview")}>
          <span className="brand-mark"><Icon name="shield" size={22} /></span>
          <span>
            <strong>IRIS</strong>
            <small>Integrity Intelligence</small>
          </span>
        </button>

        <nav aria-label="Primary navigation">
          <span className="nav-label">Workspace</span>
          {NAV_ITEMS.map((item) => (
            <button
              className={activeView === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setActiveView(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <Icon name="shield" size={19} />
          <strong>Synthetic data only</strong>
          <span>No real organisation, supplier, or person is represented.</span>
        </div>
        <footer>
          <span className="status-dot" />
          <span>Analytics ready</span>
          <small>v2.0</small>
        </footer>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="mobile-brand">IRIS</span>
            <strong>{NAV_ITEMS.find((item) => item.id === activeView)?.label}</strong>
          </div>
          <div className="topbar-meta">
            <span>1,000 synthetic records</span>
            <span className="divider" />
            <span className="responsible-badge"><Icon name="check" size={14} /> Human review</span>
          </div>
        </header>

        <main className="content">
          {activeView === "overview" ? (
            <OverviewView data={data} onNavigate={setActiveView} />
          ) : null}
          {activeView === "transactions" ? <TransactionsView data={data} /> : null}
          {activeView === "model" ? <ModelView data={data} /> : null}
          {activeView === "scenario" ? <ScenarioView /> : null}
        </main>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          {NAV_ITEMS.map((item) => (
            <button
              className={activeView === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setActiveView(item.id)}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
