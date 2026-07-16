from __future__ import annotations

from src.generate_dataset import (
    RISK_BANDS,
    calculate_risk_score,
    generate_dataset,
)


def test_generated_dataset_is_reproducible_and_valid() -> None:
    first = generate_dataset(row_count=100, seed=42)
    second = generate_dataset(row_count=100, seed=42)

    assert first.equals(second)
    assert first["transaction_id"].is_unique
    assert first["vendor_id"].notna().all()
    assert first["risk_score"].between(0, 100).all()
    assert set(first["risk_level"]) == set(RISK_BANDS)

    for row in first.to_dict(orient="records"):
        assert row["risk_score"] == calculate_risk_score(row)
        lower, upper = RISK_BANDS[row["risk_level"]]
        assert lower <= row["risk_score"] <= upper


def test_generated_review_flag_matches_priority() -> None:
    dataset = generate_dataset(row_count=100, seed=7)
    expected = dataset["risk_level"].isin(["High", "Critical"]).map(
        {True: "Yes", False: "No"}
    )

    assert dataset["review_required"].equals(expected)
