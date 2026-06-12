"""Preprocess synthetic integrity risk data for model training.

The target is review priority level (`risk_level`). The processed files are
for prototype modelling only and do not represent confirmed misconduct.
"""

from __future__ import annotations

import json
import pickle
from pathlib import Path

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import OneHotEncoder


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_DATA_PATH = PROJECT_ROOT / "data" / "raw" / "integrity_procurement_risk_dataset.csv"
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"

TARGET_COLUMN = "risk_level"
CATEGORICAL_COLUMNS = ["department", "region", "procurement_method"]
EXCLUDED_FEATURE_COLUMNS = [
    "transaction_id",
    "vendor_id",
    "risk_score",
    "review_required",
]

RANDOM_STATE = 42
TEST_SIZE = 0.20


def validate_input_columns(df: pd.DataFrame) -> None:
    required_columns = set(CATEGORICAL_COLUMNS + EXCLUDED_FEATURE_COLUMNS + [TARGET_COLUMN])
    missing_columns = sorted(required_columns - set(df.columns))
    if missing_columns:
        raise ValueError(f"Input dataset is missing required columns: {missing_columns}")


def build_preprocessor(numeric_columns: list[str]) -> ColumnTransformer:
    # Fit encoders on training data only to avoid leaking test-set categories.
    return ColumnTransformer(
        transformers=[
            (
                "categorical",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                CATEGORICAL_COLUMNS,
            ),
            ("numeric", "passthrough", numeric_columns),
        ],
        verbose_feature_names_out=False,
    )


def save_processed_split(
    X_train_processed: pd.DataFrame,
    X_test_processed: pd.DataFrame,
    y_train: pd.Series,
    y_test: pd.Series,
) -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    X_train_processed.to_csv(PROCESSED_DIR / "X_train.csv", index=False)
    X_test_processed.to_csv(PROCESSED_DIR / "X_test.csv", index=False)
    y_train.to_frame(name=TARGET_COLUMN).to_csv(PROCESSED_DIR / "y_train.csv", index=False)
    y_test.to_frame(name=TARGET_COLUMN).to_csv(PROCESSED_DIR / "y_test.csv", index=False)


def main() -> None:
    print("Loading synthetic integrity risk dataset...")
    if not RAW_DATA_PATH.exists():
        raise FileNotFoundError(
            f"Could not find {RAW_DATA_PATH}. Run: python src/generate_dataset.py"
        )

    df = pd.read_csv(RAW_DATA_PATH)
    validate_input_columns(df)
    print(f"Loaded {len(df):,} rows from {RAW_DATA_PATH}")

    y = df[TARGET_COLUMN]
    X = df.drop(columns=EXCLUDED_FEATURE_COLUMNS + [TARGET_COLUMN])
    numeric_columns = [column for column in X.columns if column not in CATEGORICAL_COLUMNS]

    print("Creating stratified train/test split...")
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=TEST_SIZE,
        random_state=RANDOM_STATE,
        stratify=y,
    )

    print("Fitting categorical encoder on training data only...")
    preprocessor = build_preprocessor(numeric_columns)
    X_train_array = preprocessor.fit_transform(X_train)
    X_test_array = preprocessor.transform(X_test)

    feature_names = preprocessor.get_feature_names_out()
    X_train_processed = pd.DataFrame(X_train_array, columns=feature_names, index=X_train.index)
    X_test_processed = pd.DataFrame(X_test_array, columns=feature_names, index=X_test.index)

    save_processed_split(X_train_processed, X_test_processed, y_train, y_test)

    metadata = {
        "target_column": TARGET_COLUMN,
        "excluded_feature_columns": EXCLUDED_FEATURE_COLUMNS,
        "categorical_columns": CATEGORICAL_COLUMNS,
        "numeric_columns": numeric_columns,
        "encoded_feature_count": len(feature_names),
        "train_rows": len(X_train_processed),
        "test_rows": len(X_test_processed),
        "test_size": TEST_SIZE,
        "random_state": RANDOM_STATE,
        "purpose": "Predict review priority level, not confirmed misconduct.",
    }
    (PROCESSED_DIR / "preprocessing_metadata.json").write_text(
        json.dumps(metadata, indent=2),
        encoding="utf-8",
    )

    with (PROCESSED_DIR / "preprocessor.pkl").open("wb") as file:
        pickle.dump(preprocessor, file)

    print("Saved processed training and test files to data/processed/")
    print(f"Training rows: {len(X_train_processed):,}")
    print(f"Test rows: {len(X_test_processed):,}")
    print("Target distribution in training split:")
    for level, count in y_train.value_counts(normalize=True).sort_index().items():
        print(f"  {level}: {count:.1%}")
    print("Preprocessing complete.")


if __name__ == "__main__":
    main()
