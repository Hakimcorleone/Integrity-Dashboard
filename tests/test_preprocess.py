from __future__ import annotations

import pandas as pd
import pytest

from src.preprocess import build_preprocessor, validate_input_columns


def test_validate_input_columns_reports_missing_schema() -> None:
    with pytest.raises(ValueError, match="missing required columns"):
        validate_input_columns(pd.DataFrame({"risk_level": ["Low"]}))


def test_preprocessor_handles_unseen_categories() -> None:
    training = pd.DataFrame(
        {
            "department": ["Finance", "IT"],
            "region": ["Central", "Southern"],
            "procurement_method": ["Open Tender", "RFQ"],
            "contract_amount": [10_000.0, 20_000.0],
        }
    )
    unseen = pd.DataFrame(
        {
            "department": ["Operations"],
            "region": ["Sabah"],
            "procurement_method": ["Direct Award"],
            "contract_amount": [15_000.0],
        }
    )

    preprocessor = build_preprocessor(["contract_amount"])
    preprocessor.fit(training)
    transformed = preprocessor.transform(unseen)

    assert transformed.shape == (1, len(preprocessor.get_feature_names_out()))
