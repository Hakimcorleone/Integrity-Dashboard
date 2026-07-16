import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";


const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_DIR = path.join(ROOT, "public", "generated");

const DATASET_PATH = path.join(
  ROOT,
  "data",
  "raw",
  "integrity_procurement_risk_dataset.csv",
);
const MODEL_COMPARISON_PATH = path.join(
  ROOT,
  "outputs",
  "reports",
  "model_comparison.csv",
);
const CLASSIFICATION_REPORT_PATH = path.join(
  ROOT,
  "outputs",
  "reports",
  "classification_report.txt",
);
const CONFUSION_MATRIX_PATH = path.join(
  ROOT,
  "outputs",
  "charts",
  "confusion_matrix.png",
);
const FEATURE_IMPORTANCE_PATH = path.join(
  ROOT,
  "outputs",
  "charts",
  "feature_importance.png",
);

const NUMERIC_COLUMNS = new Set([
  "contract_amount",
  "invoice_amount",
  "claimed_units",
  "verified_units",
  "number_of_bidders",
  "tender_duration_days",
  "has_checker",
  "has_approver",
  "coi_declared",
  "past_complaints_12m",
  "variation_order_count",
  "variation_order_amount",
  "late_delivery_days",
  "duplicate_invoice_flag",
  "round_amount_flag",
  "split_purchase_flag",
  "invoice_contract_ratio",
  "invoice_contract_variance",
  "claim_variance_units",
  "claim_variance_pct",
  "direct_award_flag",
  "emergency_procurement_flag",
  "single_bidder_flag",
  "short_tender_flag",
  "missing_checker_flag",
  "missing_approver_flag",
  "complaint_flag",
  "vo_amount_ratio",
  "late_delivery_flag",
  "risk_score",
  "accuracy",
  "macro_precision",
  "macro_recall",
  "macro_f1_score",
  "weighted_f1_score",
]);

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...records] = rows;
  if (!headers?.length) {
    throw new Error("CSV input has no header row.");
  }

  return records.map((values) =>
    Object.fromEntries(
      headers.map((header, index) => {
        const value = values[index] ?? "";
        return [header, NUMERIC_COLUMNS.has(header) ? Number(value) : value];
      }),
    ),
  );
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required build input is missing: ${path.relative(ROOT, filePath)}`);
  }
  return parseCsv(fs.readFileSync(filePath, "utf8"));
}

const transactions = readCsv(DATASET_PATH);
const modelComparison = readCsv(MODEL_COMPARISON_PATH);
const classificationReport = fs.readFileSync(CLASSIFICATION_REPORT_PATH, "utf8");

const riskDistribution = Object.fromEntries(
  ["Low", "Medium", "High", "Critical"].map((level) => [
    level,
    transactions.filter((row) => row.risk_level === level).length,
  ]),
);

const payload = {
  generatedFrom: "Synthetic repository artifacts",
  transactionCount: transactions.length,
  riskDistribution,
  transactions,
  modelComparison,
  classificationReport,
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(
  path.join(OUTPUT_DIR, "dashboard-data.json"),
  JSON.stringify(payload),
  "utf8",
);
fs.copyFileSync(
  CONFUSION_MATRIX_PATH,
  path.join(OUTPUT_DIR, "confusion-matrix.png"),
);
fs.copyFileSync(
  FEATURE_IMPORTANCE_PATH,
  path.join(OUTPUT_DIR, "feature-importance.png"),
);

console.log(
  `Prepared ${transactions.length.toLocaleString()} synthetic transactions for the React dashboard.`,
);
