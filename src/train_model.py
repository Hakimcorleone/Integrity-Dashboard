"""Train integrity risk review-priority models on processed synthetic data."""

from __future__ import annotations

import pickle
from pathlib import Path

import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
MODELS_DIR = PROJECT_ROOT / "models"
REPORTS_DIR = PROJECT_ROOT / "outputs" / "reports"

MODEL_OUTPUT_PATH = MODELS_DIR / "integrity_risk_model.pkl"
COMPARISON_OUTPUT_PATH = REPORTS_DIR / "model_comparison.csv"
TARGET_COLUMN = "risk_level"
RANDOM_STATE = 42


def load_processed_data() -> tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series]:
    required_files = {
        "X_train": PROCESSED_DIR / "X_train.csv",
        "X_test": PROCESSED_DIR / "X_test.csv",
        "y_train": PROCESSED_DIR / "y_train.csv",
        "y_test": PROCESSED_DIR / "y_test.csv",
    }
    missing_files = [str(path) for path in required_files.values() if not path.exists()]
    if missing_files:
        raise FileNotFoundError(
            "Missing processed files. Run `python src/preprocess.py` first. "
            f"Missing: {missing_files}"
        )

    X_train = pd.read_csv(required_files["X_train"])
    X_test = pd.read_csv(required_files["X_test"])
    y_train = pd.read_csv(required_files["y_train"])[TARGET_COLUMN]
    y_test = pd.read_csv(required_files["y_test"])[TARGET_COLUMN]
    return X_train, X_test, y_train, y_test


def build_model_pipelines() -> dict[str, Pipeline]:
    return {
        "Logistic Regression": Pipeline(
            steps=[
                ("scaler", StandardScaler()),
                (
                    "classifier",
                    LogisticRegression(
                        max_iter=2_000,
                        class_weight="balanced",
                        random_state=RANDOM_STATE,
                    ),
                ),
            ]
        ),
        "Decision Tree Classifier": Pipeline(
            steps=[
                (
                    "classifier",
                    DecisionTreeClassifier(
                        max_depth=8,
                        class_weight="balanced",
                        random_state=RANDOM_STATE,
                    ),
                )
            ]
        ),
        "Random Forest Classifier": Pipeline(
            steps=[
                (
                    "classifier",
                    RandomForestClassifier(
                        n_estimators=300,
                        class_weight="balanced",
                        random_state=RANDOM_STATE,
                        n_jobs=-1,
                    ),
                )
            ]
        ),
        "Gradient Boosting Classifier": Pipeline(
            steps=[
                (
                    "classifier",
                    GradientBoostingClassifier(random_state=RANDOM_STATE),
                )
            ]
        ),
    }


def evaluate_predictions(y_test: pd.Series, predictions: pd.Series | list[str]) -> dict[str, float]:
    return {
        "accuracy": accuracy_score(y_test, predictions),
        "macro_precision": precision_score(y_test, predictions, average="macro", zero_division=0),
        "macro_recall": recall_score(y_test, predictions, average="macro", zero_division=0),
        "macro_f1_score": f1_score(y_test, predictions, average="macro", zero_division=0),
        "weighted_f1_score": f1_score(y_test, predictions, average="weighted", zero_division=0),
    }


def main() -> None:
    print("Loading processed synthetic training data...")
    X_train, X_test, y_train, y_test = load_processed_data()
    print(f"Training rows: {len(X_train):,}")
    print(f"Test rows: {len(X_test):,}")
    print("Training models to predict review priority level, not confirmed misconduct.")

    model_pipelines = build_model_pipelines()
    comparison_rows = []
    fitted_models: dict[str, Pipeline] = {}

    for model_name, pipeline in model_pipelines.items():
        print(f"Training {model_name}...")
        pipeline.fit(X_train, y_train)
        predictions = pipeline.predict(X_test)
        metrics = evaluate_predictions(y_test, predictions)
        comparison_rows.append({"model": model_name, **metrics})
        fitted_models[model_name] = pipeline

        print(
            f"  macro F1: {metrics['macro_f1_score']:.3f} | "
            f"accuracy: {metrics['accuracy']:.3f}"
        )

    comparison_df = pd.DataFrame(comparison_rows).sort_values(
        by="macro_f1_score",
        ascending=False,
    )
    best_model_name = str(comparison_df.iloc[0]["model"])
    best_model = fitted_models[best_model_name]

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    comparison_df.to_csv(COMPARISON_OUTPUT_PATH, index=False)
    with MODEL_OUTPUT_PATH.open("wb") as file:
        pickle.dump(best_model, file)

    print(f"Saved model comparison to {COMPARISON_OUTPUT_PATH}")
    print(f"Best model selected by macro F1-score: {best_model_name}")
    print(f"Saved best model to {MODEL_OUTPUT_PATH}")
    print("Training complete.")


if __name__ == "__main__":
    main()
