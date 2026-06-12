"""Generate a synthetic integrity risk dataset for review prioritisation.

The dataset is intentionally synthetic. It does not contain real people,
identity numbers, contact details, bank accounts, or confidential records.
The risk score is a prioritisation signal for review, not a finding of
corruption, fraud, bribery, or misconduct.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_PATH = PROJECT_ROOT / "data" / "raw" / "integrity_procurement_risk_dataset.csv"

DEPARTMENTS = [
    "Facilities",
    "Procurement",
    "Project Management",
    "Finance",
    "IT",
    "Operations",
    "Corporate Services",
]

REGIONS = [
    "Northern",
    "Central",
    "Southern",
    "East Coast",
    "Sabah",
    "Sarawak",
]

NON_EXCEPTION_METHODS = ["Open Tender", "RFQ", "Panel Vendor"]
RISK_TARGETS = {
    "Low": 0.45,
    "Medium": 0.30,
    "High": 0.18,
    "Critical": 0.07,
}

RISK_BANDS = {
    "Low": (0, 24),
    "Medium": (25, 49),
    "High": (50, 74),
    "Critical": (75, 100),
}

PROFILE_PROBABILITIES = {
    "Low": {
        "invoice_over": 0.05,
        "invoice_ratio_gt_120": 0.01,
        "claimed_over": 0.04,
        "claim_pct_gt_25": 0.02,
        "missing_checker": 0.03,
        "missing_approver": 0.01,
        "coi": 0.005,
        "complaint": 0.04,
        "complaint_3plus": 0.004,
        "direct_award": 0.07,
        "emergency": 0.01,
        "single_bidder": 0.04,
        "short_tender": 0.04,
        "vo_count_gt_2": 0.03,
        "vo_ratio_gt_20": 0.02,
        "late_gt_14": 0.07,
        "late_gt_30": 0.02,
        "duplicate_invoice": 0.004,
        "round_amount": 0.12,
        "split_purchase": 0.02,
    },
    "Medium": {
        "invoice_over": 0.16,
        "invoice_ratio_gt_120": 0.05,
        "claimed_over": 0.16,
        "claim_pct_gt_25": 0.07,
        "missing_checker": 0.09,
        "missing_approver": 0.06,
        "coi": 0.03,
        "complaint": 0.14,
        "complaint_3plus": 0.025,
        "direct_award": 0.15,
        "emergency": 0.04,
        "single_bidder": 0.13,
        "short_tender": 0.14,
        "vo_count_gt_2": 0.12,
        "vo_ratio_gt_20": 0.10,
        "late_gt_14": 0.18,
        "late_gt_30": 0.05,
        "duplicate_invoice": 0.035,
        "round_amount": 0.18,
        "split_purchase": 0.08,
    },
    "High": {
        "invoice_over": 0.34,
        "invoice_ratio_gt_120": 0.16,
        "claimed_over": 0.30,
        "claim_pct_gt_25": 0.17,
        "missing_checker": 0.17,
        "missing_approver": 0.14,
        "coi": 0.08,
        "complaint": 0.28,
        "complaint_3plus": 0.08,
        "direct_award": 0.23,
        "emergency": 0.07,
        "single_bidder": 0.24,
        "short_tender": 0.25,
        "vo_count_gt_2": 0.22,
        "vo_ratio_gt_20": 0.20,
        "late_gt_14": 0.28,
        "late_gt_30": 0.11,
        "duplicate_invoice": 0.07,
        "round_amount": 0.24,
        "split_purchase": 0.16,
    },
    "Critical": {
        "invoice_over": 0.54,
        "invoice_ratio_gt_120": 0.34,
        "claimed_over": 0.48,
        "claim_pct_gt_25": 0.34,
        "missing_checker": 0.28,
        "missing_approver": 0.24,
        "coi": 0.16,
        "complaint": 0.42,
        "complaint_3plus": 0.17,
        "direct_award": 0.30,
        "emergency": 0.13,
        "single_bidder": 0.34,
        "short_tender": 0.34,
        "vo_count_gt_2": 0.34,
        "vo_ratio_gt_20": 0.32,
        "late_gt_14": 0.40,
        "late_gt_30": 0.20,
        "duplicate_invoice": 0.14,
        "round_amount": 0.30,
        "split_purchase": 0.28,
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a synthetic procurement/payment integrity risk dataset."
    )
    parser.add_argument("--rows", type=int, default=1000, help="Number of rows to generate.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="CSV output path.",
    )
    return parser.parse_args()


def risk_level_from_score(score: int) -> str:
    if score <= 24:
        return "Low"
    if score <= 49:
        return "Medium"
    if score <= 74:
        return "High"
    return "Critical"


def calculate_risk_score(row: dict) -> int:
    invoice_contract_ratio = row["invoice_amount"] / row["contract_amount"]
    claim_variance_pct = (row["claimed_units"] - row["verified_units"]) / row["verified_units"]
    vo_amount_ratio = row["variation_order_amount"] / row["contract_amount"]

    score = 0
    score += 20 if row["invoice_amount"] > row["contract_amount"] else 0
    score += 10 if invoice_contract_ratio > 1.20 else 0
    score += 20 if row["claimed_units"] > row["verified_units"] else 0
    score += 10 if claim_variance_pct > 0.25 else 0
    score += 15 if row["has_checker"] == 0 else 0
    score += 20 if row["has_approver"] == 0 else 0
    score += 20 if row["coi_declared"] == 1 else 0
    score += 10 if row["past_complaints_12m"] > 0 else 0
    score += 10 if row["past_complaints_12m"] >= 3 else 0
    score += 10 if row["procurement_method"] == "Direct Award" else 0
    score += 10 if row["procurement_method"] == "Emergency Procurement" else 0
    score += 10 if row["number_of_bidders"] <= 1 else 0
    score += 10 if row["tender_duration_days"] < 7 else 0
    score += 10 if row["variation_order_count"] > 2 else 0
    score += 10 if vo_amount_ratio > 0.20 else 0
    score += 5 if row["late_delivery_days"] > 14 else 0
    score += 5 if row["late_delivery_days"] > 30 else 0
    score += 25 if row["duplicate_invoice_flag"] == 1 else 0
    score += 5 if row["round_amount_flag"] == 1 else 0
    score += 20 if row["split_purchase_flag"] == 1 else 0
    return min(score, 100)


def risk_target_sequence(row_count: int, rng: np.random.Generator) -> list[str]:
    counts = {level: int(row_count * share) for level, share in RISK_TARGETS.items()}
    counts["Low"] += row_count - sum(counts.values())

    targets: list[str] = []
    for level, count in counts.items():
        targets.extend([level] * count)
    rng.shuffle(targets)
    return targets


def sample_bool(rng: np.random.Generator, probability: float) -> bool:
    return bool(rng.random() < probability)


def sample_flags(level: str, rng: np.random.Generator) -> dict:
    probabilities = PROFILE_PROBABILITIES[level]
    flags = {name: sample_bool(rng, probability) for name, probability in probabilities.items()}

    if flags["invoice_ratio_gt_120"]:
        flags["invoice_over"] = True
    if flags["claim_pct_gt_25"]:
        flags["claimed_over"] = True
    if flags["complaint_3plus"]:
        flags["complaint"] = True
    if flags["late_gt_30"]:
        flags["late_gt_14"] = True

    if flags["direct_award"] and flags["emergency"]:
        flags["emergency"] = bool(rng.random() < 0.25)
        flags["direct_award"] = not flags["emergency"]

    return flags


def sample_contract_amount(rng: np.random.Generator) -> float:
    amount = rng.lognormal(mean=10.2, sigma=1.0)
    amount = float(np.clip(amount, 1_000, 1_500_000))
    return round(amount, 2)


def apply_round_amount(invoice_amount: float) -> float:
    if invoice_amount >= 100_000:
        return float(round(invoice_amount / 5_000) * 5_000)
    if invoice_amount >= 10_000:
        return float(round(invoice_amount / 1_000) * 1_000)
    return float(round(invoice_amount / 100) * 100)


def sample_invoice_amount(
    contract_amount: float,
    flags: dict,
    rng: np.random.Generator,
) -> float:
    if flags["invoice_ratio_gt_120"]:
        ratio = rng.uniform(1.21, 1.45)
    elif flags["invoice_over"]:
        ratio = rng.uniform(1.02, 1.18)
    else:
        ratio = rng.uniform(0.72, 1.00)

    invoice_amount = round(contract_amount * ratio, 2)

    if flags["round_amount"]:
        invoice_amount = apply_round_amount(invoice_amount)
        if flags["invoice_over"] and invoice_amount <= contract_amount:
            invoice_amount = apply_round_amount(contract_amount * 1.08)
            if invoice_amount <= contract_amount:
                invoice_amount = round(contract_amount + 100, 2)
        if not flags["invoice_over"] and invoice_amount > contract_amount:
            invoice_amount = round(contract_amount * 0.98, 2)

    return round(max(invoice_amount, 100.0), 2)


def sample_units(flags: dict, rng: np.random.Generator) -> tuple[int, int]:
    verified_units = int(rng.integers(1, 501))
    if flags["claim_pct_gt_25"]:
        variance_pct = rng.uniform(0.26, 0.75)
        claimed_units = int(np.ceil(verified_units * (1 + variance_pct)))
    elif flags["claimed_over"]:
        variance_pct = rng.uniform(0.02, 0.24)
        claimed_units = int(np.ceil(verified_units * (1 + variance_pct)))
    else:
        claimed_units = verified_units
    return claimed_units, verified_units


def sample_procurement_method(flags: dict, rng: np.random.Generator) -> str:
    if flags["direct_award"]:
        return "Direct Award"
    if flags["emergency"]:
        return "Emergency Procurement"
    return str(rng.choice(NON_EXCEPTION_METHODS, p=[0.52, 0.30, 0.18]))


def sample_bidders(procurement_method: str, flags: dict, rng: np.random.Generator) -> int:
    if procurement_method in {"Direct Award", "Emergency Procurement"}:
        return 1 if rng.random() < 0.75 else int(rng.integers(2, 4))
    if flags["single_bidder"]:
        return 1
    return int(rng.integers(2, 9))


def sample_tender_duration(procurement_method: str, flags: dict, rng: np.random.Generator) -> int:
    if procurement_method == "Emergency Procurement":
        return int(rng.integers(1, 7))
    if flags["short_tender"]:
        return int(rng.integers(1, 7))
    if procurement_method == "Direct Award":
        return int(rng.integers(7, 15))
    if procurement_method == "RFQ":
        return int(rng.integers(7, 22))
    return int(rng.integers(14, 61))


def sample_complaints(flags: dict, rng: np.random.Generator) -> int:
    if flags["complaint_3plus"]:
        return int(rng.integers(3, 7))
    if flags["complaint"]:
        return int(rng.integers(1, 3))
    return 0


def sample_variation_order(contract_amount: float, flags: dict, rng: np.random.Generator) -> tuple[int, float]:
    if flags["vo_count_gt_2"]:
        count = int(rng.integers(3, 7))
    else:
        count = int(rng.choice([0, 1, 2], p=[0.60, 0.27, 0.13]))

    if count == 0:
        return count, 0.0

    if flags["vo_ratio_gt_20"]:
        ratio = rng.uniform(0.21, 0.48)
    else:
        ratio = rng.uniform(0.02, 0.18)
    return count, round(contract_amount * ratio, 2)


def sample_late_delivery_days(flags: dict, rng: np.random.Generator) -> int:
    if flags["late_gt_30"]:
        return int(rng.integers(31, 91))
    if flags["late_gt_14"]:
        return int(rng.integers(15, 31))
    return int(rng.integers(0, 15))


def build_base_row(level: str, rng: np.random.Generator) -> dict:
    flags = sample_flags(level, rng)
    contract_amount = sample_contract_amount(rng)
    invoice_amount = sample_invoice_amount(contract_amount, flags, rng)
    claimed_units, verified_units = sample_units(flags, rng)
    procurement_method = sample_procurement_method(flags, rng)
    number_of_bidders = sample_bidders(procurement_method, flags, rng)
    tender_duration_days = sample_tender_duration(procurement_method, flags, rng)
    variation_order_count, variation_order_amount = sample_variation_order(contract_amount, flags, rng)

    return {
        "vendor_id": f"VEND-{int(rng.integers(1, 121)):04d}",
        "department": str(rng.choice(DEPARTMENTS, p=[0.14, 0.18, 0.18, 0.13, 0.12, 0.17, 0.08])),
        "region": str(rng.choice(REGIONS, p=[0.17, 0.28, 0.17, 0.14, 0.12, 0.12])),
        "procurement_method": procurement_method,
        "contract_amount": contract_amount,
        "invoice_amount": invoice_amount,
        "claimed_units": claimed_units,
        "verified_units": verified_units,
        "number_of_bidders": number_of_bidders,
        "tender_duration_days": tender_duration_days,
        "has_checker": 0 if flags["missing_checker"] else 1,
        "has_approver": 0 if flags["missing_approver"] else 1,
        "coi_declared": 1 if flags["coi"] else 0,
        "past_complaints_12m": sample_complaints(flags, rng),
        "variation_order_count": variation_order_count,
        "variation_order_amount": variation_order_amount,
        "late_delivery_days": sample_late_delivery_days(flags, rng),
        "duplicate_invoice_flag": 1 if flags["duplicate_invoice"] else 0,
        "round_amount_flag": 1 if flags["round_amount"] else 0,
        "split_purchase_flag": 1 if flags["split_purchase"] else 0,
    }


def sample_row_for_level(level: str, rng: np.random.Generator, max_attempts: int = 10_000) -> dict:
    lower_bound, upper_bound = RISK_BANDS[level]
    best_row = None
    best_distance = float("inf")

    for _ in range(max_attempts):
        row = build_base_row(level, rng)
        score = calculate_risk_score(row)
        if lower_bound <= score <= upper_bound:
            row["risk_score"] = score
            return row

        midpoint = (lower_bound + upper_bound) / 2
        distance = abs(score - midpoint)
        if distance < best_distance:
            best_row = row
            best_distance = distance

    if best_row is None:
        raise RuntimeError(f"Unable to generate row for risk level {level}.")

    best_row["risk_score"] = calculate_risk_score(best_row)
    return best_row


def add_derived_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["invoice_contract_ratio"] = (df["invoice_amount"] / df["contract_amount"]).round(4)
    df["invoice_contract_variance"] = (df["invoice_amount"] - df["contract_amount"]).round(2)
    df["claim_variance_units"] = df["claimed_units"] - df["verified_units"]
    df["claim_variance_pct"] = (df["claim_variance_units"] / df["verified_units"]).round(4)
    df["direct_award_flag"] = (df["procurement_method"] == "Direct Award").astype(int)
    df["emergency_procurement_flag"] = (df["procurement_method"] == "Emergency Procurement").astype(int)
    df["single_bidder_flag"] = (df["number_of_bidders"] <= 1).astype(int)
    df["short_tender_flag"] = (df["tender_duration_days"] < 7).astype(int)
    df["missing_checker_flag"] = (df["has_checker"] == 0).astype(int)
    df["missing_approver_flag"] = (df["has_approver"] == 0).astype(int)
    df["complaint_flag"] = (df["past_complaints_12m"] > 0).astype(int)
    df["vo_amount_ratio"] = (df["variation_order_amount"] / df["contract_amount"]).round(4)
    df["late_delivery_flag"] = (df["late_delivery_days"] > 14).astype(int)
    df["risk_level"] = df["risk_score"].apply(risk_level_from_score)
    df["review_required"] = df["risk_level"].isin(["High", "Critical"]).map({True: "Yes", False: "No"})
    return df


def generate_dataset(row_count: int, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = [sample_row_for_level(level, rng) for level in risk_target_sequence(row_count, rng)]
    df = pd.DataFrame(rows)
    df.insert(0, "transaction_id", [f"TXN-{idx:06d}" for idx in range(1, len(df) + 1)])
    df = add_derived_features(df)

    column_order = [
        "transaction_id",
        "vendor_id",
        "department",
        "region",
        "procurement_method",
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
        "risk_level",
        "review_required",
    ]
    return df[column_order]


def main() -> None:
    args = parse_args()
    output_path = args.output
    if not output_path.is_absolute():
        output_path = PROJECT_ROOT / output_path

    output_path.parent.mkdir(parents=True, exist_ok=True)
    df = generate_dataset(row_count=args.rows, seed=args.seed)
    df.to_csv(output_path, index=False)

    print(f"Saved {len(df):,} synthetic transactions to {output_path}")
    print("Risk level distribution:")
    distribution = df["risk_level"].value_counts(normalize=True).mul(100).reindex(RISK_BANDS).round(1)
    for level, percentage in distribution.items():
        print(f"  {level}: {percentage:.1f}%")


if __name__ == "__main__":
    main()
