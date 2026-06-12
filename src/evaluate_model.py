"""Evaluate the trained integrity risk review-priority model.

The model output supports review prioritisation. It is not an automated
judgement and does not confirm misconduct.
"""

from __future__ import annotations

import pickle
from pathlib import Path

import pandas as pd
from PIL import Image, ImageDraw, ImageFont
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.pipeline import Pipeline


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
MODELS_DIR = PROJECT_ROOT / "models"
CHARTS_DIR = PROJECT_ROOT / "outputs" / "charts"
REPORTS_DIR = PROJECT_ROOT / "outputs" / "reports"

MODEL_PATH = MODELS_DIR / "integrity_risk_model.pkl"
CLASSIFICATION_REPORT_PATH = REPORTS_DIR / "classification_report.txt"
CONFUSION_MATRIX_PATH = CHARTS_DIR / "confusion_matrix.png"
FEATURE_IMPORTANCE_PATH = CHARTS_DIR / "feature_importance.png"
TARGET_COLUMN = "risk_level"
CHART_BACKGROUND = "#ffffff"
CHART_TEXT = "#202124"
CHART_MUTED_TEXT = "#5f6368"
CHART_BLUE = "#2f6f8f"
CHART_LIGHT_BLUE = "#e8f1f7"


def load_model() -> Pipeline:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Could not find {MODEL_PATH}. Run: python src/train_model.py"
        )

    with MODEL_PATH.open("rb") as file:
        model = pickle.load(file)
    return model


def load_test_data() -> tuple[pd.DataFrame, pd.Series]:
    X_test_path = PROCESSED_DIR / "X_test.csv"
    y_test_path = PROCESSED_DIR / "y_test.csv"

    missing_files = [str(path) for path in [X_test_path, y_test_path] if not path.exists()]
    if missing_files:
        raise FileNotFoundError(
            "Missing processed test files. Run `python src/preprocess.py` first. "
            f"Missing: {missing_files}"
        )

    X_test = pd.read_csv(X_test_path)
    y_test = pd.read_csv(y_test_path)[TARGET_COLUMN]
    return X_test, y_test


def get_classifier(model: Pipeline):
    if isinstance(model, Pipeline):
        return model.steps[-1][1]
    return model


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    font_candidates = ["arialbd.ttf", "arial.ttf"] if bold else ["arial.ttf"]
    for font_name in font_candidates:
        try:
            return ImageFont.truetype(font_name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_centered_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: str,
) -> None:
    x, y = xy
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.text((x - (right - left) / 2, y - (bottom - top) / 2), text, fill=fill, font=font)


def draw_right_aligned_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: str,
) -> None:
    x, y = xy
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.text((x - (right - left), y - (bottom - top) / 2), text, fill=fill, font=font)


def save_classification_report(
    y_test: pd.Series,
    predictions: list[str],
    labels: list[str],
) -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    report = classification_report(
        y_test,
        predictions,
        labels=labels,
        digits=3,
        zero_division=0,
    )
    metrics = {
        "accuracy": accuracy_score(y_test, predictions),
        "macro_precision": precision_score(y_test, predictions, average="macro", zero_division=0),
        "macro_recall": recall_score(y_test, predictions, average="macro", zero_division=0),
        "macro_f1_score": f1_score(y_test, predictions, average="macro", zero_division=0),
        "weighted_f1_score": f1_score(y_test, predictions, average="weighted", zero_division=0),
    }

    explanation = """Evaluation Notes
================

This model predicts integrity review priority levels using synthetic data.
It supports review prioritisation, not automated judgement.

Accuracy alone is not enough because class balance and the cost of different
mistakes matter in review workflows.

Precision matters because false positives can create unnecessary review
workload for teams.

Recall matters because false negatives may miss cases that should be reviewed.

Summary Metrics
===============
"""

    metric_lines = "\n".join(f"{name}: {value:.3f}" for name, value in metrics.items())
    output = f"{explanation}{metric_lines}\n\nClassification Report\n=====================\n\n{report}"
    CLASSIFICATION_REPORT_PATH.write_text(output, encoding="utf-8")


def save_confusion_matrix_chart(
    y_test: pd.Series,
    predictions: list[str],
    labels: list[str],
) -> None:
    CHARTS_DIR.mkdir(parents=True, exist_ok=True)

    matrix = confusion_matrix(y_test, predictions, labels=labels)
    cell_size = 128
    left_margin = 220
    top_margin = 150
    right_margin = 80
    bottom_margin = 110
    width = left_margin + (cell_size * len(labels)) + right_margin
    height = top_margin + (cell_size * len(labels)) + bottom_margin
    max_count = max(int(matrix.max()), 1)

    image = Image.new("RGB", (width, height), CHART_BACKGROUND)
    draw = ImageDraw.Draw(image)
    title_font = load_font(26, bold=True)
    label_font = load_font(17, bold=True)
    tick_font = load_font(16)
    value_font = load_font(22, bold=True)

    draw.text(
        (40, 35),
        "Integrity Risk Review Priority - Confusion Matrix",
        fill=CHART_TEXT,
        font=title_font,
    )
    draw.text((left_margin, height - 55), "Predicted risk level", fill=CHART_MUTED_TEXT, font=label_font)
    draw.text((40, top_margin - 38), "Actual risk level", fill=CHART_MUTED_TEXT, font=label_font)

    for column_index, label in enumerate(labels):
        x = left_margin + (column_index * cell_size) + (cell_size // 2)
        draw_centered_text(draw, (x, top_margin - 30), label, tick_font, CHART_TEXT)

    for row_index, label in enumerate(labels):
        y = top_margin + (row_index * cell_size) + (cell_size // 2)
        draw_right_aligned_text(draw, (left_margin - 18, y), label, tick_font, CHART_TEXT)

    for row_index in range(len(labels)):
        for column_index in range(len(labels)):
            value = int(matrix[row_index, column_index])
            intensity = value / max_count
            red = int(232 - (185 * intensity))
            green = int(241 - (120 * intensity))
            blue = int(247 - (55 * intensity))
            fill = (red, green, blue)
            x0 = left_margin + (column_index * cell_size)
            y0 = top_margin + (row_index * cell_size)
            x1 = x0 + cell_size
            y1 = y0 + cell_size
            draw.rectangle((x0, y0, x1, y1), fill=fill, outline="#ffffff", width=3)
            text_color = "#ffffff" if intensity > 0.55 else CHART_TEXT
            draw_centered_text(draw, (x0 + cell_size // 2, y0 + cell_size // 2), str(value), value_font, text_color)

    image.save(CONFUSION_MATRIX_PATH)


def get_feature_importance(model: Pipeline, feature_names: list[str]) -> pd.DataFrame | None:
    classifier = get_classifier(model)

    if hasattr(classifier, "feature_importances_"):
        importance_values = classifier.feature_importances_
        importance_type = "feature_importance"
    elif hasattr(classifier, "coef_"):
        coefficients = classifier.coef_
        # For multiclass linear models, mean absolute coefficient size gives a
        # compact view of which encoded features most influence predictions.
        importance_values = abs(coefficients).mean(axis=0)
        importance_type = "mean_absolute_coefficient"
    else:
        return None

    return pd.DataFrame(
        {
            "feature": feature_names,
            "importance": importance_values,
            "importance_type": importance_type,
        }
    ).sort_values("importance", ascending=False)


def save_feature_importance_chart(importances: pd.DataFrame, top_n: int = 20) -> None:
    top_features = importances.head(top_n).sort_values("importance", ascending=True)
    bar_height = 24
    row_gap = 12
    left_margin = 430
    top_margin = 95
    right_margin = 130
    bottom_margin = 85
    bar_area_width = 560
    width = left_margin + bar_area_width + right_margin
    height = top_margin + (len(top_features) * (bar_height + row_gap)) + bottom_margin
    max_importance = max(float(top_features["importance"].max()), 1e-9)

    image = Image.new("RGB", (width, height), CHART_BACKGROUND)
    draw = ImageDraw.Draw(image)
    title_font = load_font(26, bold=True)
    label_font = load_font(16, bold=True)
    tick_font = load_font(14)
    value_font = load_font(13)

    importance_label = top_features["importance_type"].iloc[0].replace("_", " ").title()
    draw.text((40, 35), "Top Feature Signals for Review Priority Prediction", fill=CHART_TEXT, font=title_font)
    draw.text((left_margin, height - 48), importance_label, fill=CHART_MUTED_TEXT, font=label_font)

    for index, row in enumerate(top_features.itertuples(index=False)):
        y = top_margin + (index * (bar_height + row_gap))
        bar_width = int((float(row.importance) / max_importance) * bar_area_width)
        draw_right_aligned_text(
            draw,
            (left_margin - 16, y + bar_height // 2),
            str(row.feature),
            tick_font,
            CHART_TEXT,
        )
        draw.rectangle((left_margin, y, left_margin + bar_area_width, y + bar_height), fill=CHART_LIGHT_BLUE)
        draw.rectangle((left_margin, y, left_margin + bar_width, y + bar_height), fill=CHART_BLUE)
        draw.text(
            (left_margin + bar_width + 8, y + 3),
            f"{float(row.importance):.3f}",
            fill=CHART_MUTED_TEXT,
            font=value_font,
        )

    image.save(FEATURE_IMPORTANCE_PATH)


def main() -> None:
    print("Loading trained integrity risk review-priority model...")
    model = load_model()

    print("Loading processed test data...")
    X_test, y_test = load_test_data()

    print("Generating predictions...")
    predictions = model.predict(X_test)
    labels = list(getattr(model, "classes_", sorted(y_test.unique())))

    print("Saving classification report...")
    save_classification_report(y_test, predictions, labels)

    print("Saving confusion matrix chart...")
    save_confusion_matrix_chart(y_test, predictions, labels)

    print("Checking feature importance support...")
    feature_importance = get_feature_importance(model, list(X_test.columns))
    if feature_importance is not None:
        save_feature_importance_chart(feature_importance)
        print(f"Saved feature importance chart to {FEATURE_IMPORTANCE_PATH}")
    else:
        print("The loaded model does not expose feature importance or coefficients.")

    print(f"Saved classification report to {CLASSIFICATION_REPORT_PATH}")
    print(f"Saved confusion matrix chart to {CONFUSION_MATRIX_PATH}")
    print("Evaluation complete. Use results for review prioritisation, not automated judgement.")


if __name__ == "__main__":
    main()
