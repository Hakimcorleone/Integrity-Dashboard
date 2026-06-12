"""Streamlit app for the Integrity Risk Modelling Lab."""

from __future__ import annotations

import pickle
from pathlib import Path

import pandas as pd
import streamlit as st


PROJECT_ROOT = Path(__file__).resolve().parent
DATA_PATH = PROJECT_ROOT / "data" / "raw" / "integrity_procurement_risk_dataset.csv"
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
MODEL_PATH = PROJECT_ROOT / "models" / "integrity_risk_model.pkl"
PREPROCESSOR_PATH = PROCESSED_DIR / "preprocessor.pkl"
X_TRAIN_PATH = PROCESSED_DIR / "X_train.csv"
MODEL_COMPARISON_PATH = PROJECT_ROOT / "outputs" / "reports" / "model_comparison.csv"
CLASSIFICATION_REPORT_PATH = PROJECT_ROOT / "outputs" / "reports" / "classification_report.txt"
CONFUSION_MATRIX_PATH = PROJECT_ROOT / "outputs" / "charts" / "confusion_matrix.png"
FEATURE_IMPORTANCE_PATH = PROJECT_ROOT / "outputs" / "charts" / "feature_importance.png"

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

PROCUREMENT_METHODS = [
    "Open Tender",
    "RFQ",
    "Direct Award",
    "Emergency Procurement",
    "Panel Vendor",
]

BASE_FEATURE_COLUMNS = [
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
]

RISK_LEVEL_ORDER = ["Low", "Medium", "High", "Critical"]


st.set_page_config(
    page_title="Integrity Risk Modelling Lab",
    page_icon=":bar_chart:",
    layout="wide",
)


@st.cache_data
def load_dataset() -> pd.DataFrame:
    return pd.read_csv(DATA_PATH)


@st.cache_data
def load_model_comparison() -> pd.DataFrame:
    return pd.read_csv(MODEL_COMPARISON_PATH)


@st.cache_data
def load_training_feature_columns() -> list[str]:
    return list(pd.read_csv(X_TRAIN_PATH, nrows=1).columns)


@st.cache_resource
def load_pickle(path: Path):
    with path.open("rb") as file:
        return pickle.load(file)


def bool_to_int(value: bool) -> int:
    return 1 if value else 0


def build_case_features(raw_case: dict) -> pd.DataFrame:
    contract_amount = max(float(raw_case["contract_amount"]), 1.0)
    invoice_amount = float(raw_case["invoice_amount"])
    verified_units = max(int(raw_case["verified_units"]), 1)
    claimed_units = int(raw_case["claimed_units"])
    variation_order_amount = float(raw_case["variation_order_amount"])

    claim_variance_units = claimed_units - verified_units
    features = {
        **raw_case,
        "invoice_contract_ratio": invoice_amount / contract_amount,
        "invoice_contract_variance": invoice_amount - contract_amount,
        "claim_variance_units": claim_variance_units,
        "claim_variance_pct": claim_variance_units / verified_units,
        "direct_award_flag": int(raw_case["procurement_method"] == "Direct Award"),
        "emergency_procurement_flag": int(raw_case["procurement_method"] == "Emergency Procurement"),
        "single_bidder_flag": int(raw_case["number_of_bidders"] <= 1),
        "short_tender_flag": int(raw_case["tender_duration_days"] < 7),
        "missing_checker_flag": int(raw_case["has_checker"] == 0),
        "missing_approver_flag": int(raw_case["has_approver"] == 0),
        "complaint_flag": int(raw_case["past_complaints_12m"] > 0),
        "vo_amount_ratio": variation_order_amount / contract_amount,
        "late_delivery_flag": int(raw_case["late_delivery_days"] > 14),
    }
    return pd.DataFrame([features], columns=BASE_FEATURE_COLUMNS)


def predict_risk_level(raw_case: dict) -> str:
    model = load_pickle(MODEL_PATH)
    preprocessor = load_pickle(PREPROCESSOR_PATH)
    training_columns = load_training_feature_columns()

    raw_features = build_case_features(raw_case)
    encoded_array = preprocessor.transform(raw_features)
    encoded_features = pd.DataFrame(
        encoded_array,
        columns=preprocessor.get_feature_names_out(),
    )
    encoded_features = encoded_features.reindex(columns=training_columns, fill_value=0)
    return str(model.predict(encoded_features)[0])


def render_overview() -> None:
    st.header("Overview")
    st.write(
        "Integrity Risk Modelling Lab is an open-source prototype for integrity risk analytics "
        "using synthetic procurement and payment data."
    )
    st.info(
        "The model predicts review priority. It does not detect, prove, or confirm misconduct."
    )


def render_dataset(df: pd.DataFrame) -> None:
    st.header("Dataset")
    st.write(f"Dataset shape: {df.shape[0]:,} rows x {df.shape[1]:,} columns")
    st.dataframe(df.head(25), use_container_width=True)
    st.download_button(
        label="Download dataset CSV",
        data=DATA_PATH.read_bytes(),
        file_name="integrity_procurement_risk_dataset.csv",
        mime="text/csv",
    )


def render_analytics_dashboard(df: pd.DataFrame) -> None:
    st.header("Analytics Dashboard")
    total_transactions = len(df)
    average_risk_score = df["risk_score"].mean()
    high_cases = int((df["risk_level"] == "High").sum())
    critical_cases = int((df["risk_level"] == "Critical").sum())

    metric_columns = st.columns(4)
    metric_columns[0].metric("Total transactions", f"{total_transactions:,}")
    metric_columns[1].metric("Average risk score", f"{average_risk_score:.1f}")
    metric_columns[2].metric("High risk cases", f"{high_cases:,}")
    metric_columns[3].metric("Critical risk cases", f"{critical_cases:,}")

    chart_left, chart_right = st.columns(2)
    risk_level_counts = (
        df["risk_level"].value_counts().reindex(RISK_LEVEL_ORDER, fill_value=0).rename("transactions")
    )
    procurement_counts = df["procurement_method"].value_counts().rename("transactions")

    with chart_left:
        st.subheader("Risk Level")
        st.bar_chart(risk_level_counts)

    with chart_right:
        st.subheader("Procurement Method")
        st.bar_chart(procurement_counts)

    vendor_risk = (
        df.groupby("vendor_id", as_index=False)["risk_score"]
        .mean()
        .sort_values("risk_score", ascending=False)
        .head(10)
        .rename(columns={"risk_score": "average_risk_score"})
    )
    st.subheader("Top 10 Vendors by Average Risk Score")
    st.dataframe(vendor_risk, use_container_width=True)

    highest_risk_columns = [
        "transaction_id",
        "vendor_id",
        "department",
        "region",
        "procurement_method",
        "invoice_amount",
        "risk_score",
        "risk_level",
        "review_required",
    ]
    highest_risk = df.sort_values("risk_score", ascending=False).head(10)[highest_risk_columns]
    st.subheader("Top 10 Highest-Risk Transactions")
    st.dataframe(highest_risk, use_container_width=True)


def render_model_results() -> None:
    st.header("Model Results")

    if MODEL_COMPARISON_PATH.exists():
        st.subheader("Model Comparison")
        st.dataframe(load_model_comparison(), use_container_width=True)
    else:
        st.warning("Model comparison is not available. Run: python src/train_model.py")

    if CLASSIFICATION_REPORT_PATH.exists():
        st.subheader("Classification Report")
        st.text(CLASSIFICATION_REPORT_PATH.read_text(encoding="utf-8"))
    else:
        st.warning("Classification report is not available. Run: python src/evaluate_model.py")

    image_columns = st.columns(2)
    with image_columns[0]:
        st.subheader("Confusion Matrix")
        if CONFUSION_MATRIX_PATH.exists():
            st.image(str(CONFUSION_MATRIX_PATH), use_container_width=True)
        else:
            st.warning("Confusion matrix chart is not available.")

    with image_columns[1]:
        st.subheader("Feature Importance")
        if FEATURE_IMPORTANCE_PATH.exists():
            st.image(str(FEATURE_IMPORTANCE_PATH), use_container_width=True)
        else:
            st.warning("Feature importance chart is not available for the current model.")


def render_prediction_form() -> None:
    st.header("Predict New Case")
    st.caption("Create a new synthetic transaction for review-priority prediction.")

    required_artifacts = [MODEL_PATH, PREPROCESSOR_PATH, X_TRAIN_PATH]
    missing_artifacts = [path for path in required_artifacts if not path.exists()]
    if missing_artifacts:
        st.warning(
            "Prediction artifacts are missing. Run `python src/preprocess.py` and "
            "`python src/train_model.py` before using this form."
        )
        st.write([str(path.relative_to(PROJECT_ROOT)) for path in missing_artifacts])
        return

    with st.form("new_synthetic_transaction"):
        col1, col2, col3 = st.columns(3)
        with col1:
            department = st.selectbox("Department", DEPARTMENTS, index=1)
            region = st.selectbox("Region", REGIONS, index=1)
            procurement_method = st.selectbox("Procurement method", PROCUREMENT_METHODS)
            contract_amount = st.number_input("Contract amount", min_value=1.0, value=50000.0, step=1000.0)
            invoice_amount = st.number_input("Invoice amount", min_value=1.0, value=52000.0, step=1000.0)
        with col2:
            claimed_units = st.number_input("Claimed units", min_value=1, value=100, step=1)
            verified_units = st.number_input("Verified units", min_value=1, value=95, step=1)
            number_of_bidders = st.number_input("Number of bidders", min_value=0, value=3, step=1)
            tender_duration_days = st.number_input("Tender duration days", min_value=0, value=14, step=1)
            past_complaints_12m = st.number_input("Past complaints in 12 months", min_value=0, value=0, step=1)
        with col3:
            variation_order_count = st.number_input("Variation order count", min_value=0, value=1, step=1)
            variation_order_amount = st.number_input("Variation order amount", min_value=0.0, value=5000.0, step=500.0)
            late_delivery_days = st.number_input("Late delivery days", min_value=0, value=5, step=1)
            has_checker = st.checkbox("Has checker", value=True)
            has_approver = st.checkbox("Has approver", value=True)

        flag_col1, flag_col2, flag_col3 = st.columns(3)
        with flag_col1:
            coi_declared = st.checkbox("COI declared", value=False)
        with flag_col2:
            duplicate_invoice_flag = st.checkbox("Duplicate invoice flag", value=False)
        with flag_col3:
            round_amount_flag = st.checkbox("Round amount flag", value=False)
            split_purchase_flag = st.checkbox("Split purchase flag", value=False)

        submitted = st.form_submit_button("Predict risk level")

    if submitted:
        raw_case = {
            "department": department,
            "region": region,
            "procurement_method": procurement_method,
            "contract_amount": float(contract_amount),
            "invoice_amount": float(invoice_amount),
            "claimed_units": int(claimed_units),
            "verified_units": int(verified_units),
            "number_of_bidders": int(number_of_bidders),
            "tender_duration_days": int(tender_duration_days),
            "has_checker": bool_to_int(has_checker),
            "has_approver": bool_to_int(has_approver),
            "coi_declared": bool_to_int(coi_declared),
            "past_complaints_12m": int(past_complaints_12m),
            "variation_order_count": int(variation_order_count),
            "variation_order_amount": float(variation_order_amount),
            "late_delivery_days": int(late_delivery_days),
            "duplicate_invoice_flag": bool_to_int(duplicate_invoice_flag),
            "round_amount_flag": bool_to_int(round_amount_flag),
            "split_purchase_flag": bool_to_int(split_purchase_flag),
        }
        predicted_level = predict_risk_level(raw_case)
        st.success(f"Predicted risk level: {predicted_level}")
        st.warning(
            "This prediction is for review prioritisation only and is not a finding of misconduct."
        )


def main() -> None:
    st.title("Integrity Risk Modelling Lab")

    render_overview()

    if DATA_PATH.exists():
        df = load_dataset()
        render_dataset(df)
        render_analytics_dashboard(df)
    else:
        st.error("Dataset is missing. Run: python src/generate_dataset.py")

    render_model_results()
    render_prediction_form()


if __name__ == "__main__":
    main()
