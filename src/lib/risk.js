export const RISK_LEVELS = ["Low", "Medium", "High", "Critical"];

export const RISK_META = {
  Low: { color: "#2dd4bf", tint: "rgba(45, 212, 191, 0.14)" },
  Medium: { color: "#fbbf24", tint: "rgba(251, 191, 36, 0.14)" },
  High: { color: "#fb7185", tint: "rgba(251, 113, 133, 0.14)" },
  Critical: { color: "#c084fc", tint: "rgba(192, 132, 252, 0.16)" },
};

export const DEFAULT_SCENARIO = {
  department: "Procurement",
  region: "Central",
  procurement_method: "Open Tender",
  contract_amount: 50000,
  invoice_amount: 50000,
  claimed_units: 100,
  verified_units: 100,
  number_of_bidders: 3,
  tender_duration_days: 14,
  has_checker: true,
  has_approver: true,
  coi_declared: false,
  past_complaints_12m: 0,
  variation_order_count: 0,
  variation_order_amount: 0,
  late_delivery_days: 0,
  duplicate_invoice_flag: false,
  round_amount_flag: false,
  split_purchase_flag: false,
};

export function riskLevelFromScore(score) {
  if (score <= 24) return "Low";
  if (score <= 49) return "Medium";
  if (score <= 74) return "High";
  return "Critical";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function evaluateScenario(input) {
  const contractAmount = Math.max(number(input.contract_amount), 1);
  const invoiceAmount = number(input.invoice_amount);
  const claimedUnits = number(input.claimed_units);
  const verifiedUnits = Math.max(number(input.verified_units), 1);
  const variationOrderAmount = number(input.variation_order_amount);

  const invoiceRatio = invoiceAmount / contractAmount;
  const claimVariancePct = (claimedUnits - verifiedUnits) / verifiedUnits;
  const variationRatio = variationOrderAmount / contractAmount;

  const signals = [
    {
      active: invoiceAmount > contractAmount,
      weight: 20,
      label: "Invoice exceeds contract value",
    },
    {
      active: invoiceRatio > 1.2,
      weight: 10,
      label: "Invoice is more than 120% of contract",
    },
    {
      active: claimedUnits > verifiedUnits,
      weight: 20,
      label: "Claimed units exceed verified units",
    },
    {
      active: claimVariancePct > 0.25,
      weight: 10,
      label: "Claim variance exceeds 25%",
    },
    {
      active: !input.has_checker,
      weight: 15,
      label: "Checker control is missing",
    },
    {
      active: !input.has_approver,
      weight: 20,
      label: "Approver control is missing",
    },
    {
      active: Boolean(input.coi_declared),
      weight: 20,
      label: "Conflict-of-interest declaration flagged",
    },
    {
      active: number(input.past_complaints_12m) > 0,
      weight: 10,
      label: "Past complaints recorded",
    },
    {
      active: number(input.past_complaints_12m) >= 3,
      weight: 10,
      label: "Three or more complaints recorded",
    },
    {
      active: input.procurement_method === "Direct Award",
      weight: 10,
      label: "Direct award procurement",
    },
    {
      active: input.procurement_method === "Emergency Procurement",
      weight: 10,
      label: "Emergency procurement",
    },
    {
      active: number(input.number_of_bidders) <= 1,
      weight: 10,
      label: "Single-bidder process",
    },
    {
      active: number(input.tender_duration_days) < 7,
      weight: 10,
      label: "Tender duration below seven days",
    },
    {
      active: number(input.variation_order_count) > 2,
      weight: 10,
      label: "More than two variation orders",
    },
    {
      active: variationRatio > 0.2,
      weight: 10,
      label: "Variation orders exceed 20% of contract",
    },
    {
      active: number(input.late_delivery_days) > 14,
      weight: 5,
      label: "Delivery is more than 14 days late",
    },
    {
      active: number(input.late_delivery_days) > 30,
      weight: 5,
      label: "Delivery is more than 30 days late",
    },
    {
      active: Boolean(input.duplicate_invoice_flag),
      weight: 25,
      label: "Duplicate invoice flag",
    },
    {
      active: Boolean(input.round_amount_flag),
      weight: 5,
      label: "Round-amount flag",
    },
    {
      active: Boolean(input.split_purchase_flag),
      weight: 20,
      label: "Split-purchase flag",
    },
  ];

  const activeSignals = signals.filter((signal) => signal.active);
  const score = Math.min(
    activeSignals.reduce((total, signal) => total + signal.weight, 0),
    100,
  );
  const level = riskLevelFromScore(score);

  return {
    score,
    level,
    reviewRequired: level === "High" || level === "Critical",
    activeSignals,
    ratios: {
      invoice: invoiceRatio,
      claimVariance: claimVariancePct,
      variationOrder: variationRatio,
    },
  };
}

export function formatCurrency(value) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 0,
  }).format(number(value));
}

export function formatPercent(value, digits = 1) {
  return `${(number(value) * 100).toFixed(digits)}%`;
}
