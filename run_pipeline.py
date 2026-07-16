"""Run the complete synthetic-data and model pipeline in order."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
PIPELINE_STEPS = [
    ("Generate dataset", PROJECT_ROOT / "src" / "generate_dataset.py"),
    ("Preprocess dataset", PROJECT_ROOT / "src" / "preprocess.py"),
    ("Train and compare models", PROJECT_ROOT / "src" / "train_model.py"),
    ("Evaluate selected model", PROJECT_ROOT / "src" / "evaluate_model.py"),
]


def main() -> None:
    for step_number, (description, script_path) in enumerate(PIPELINE_STEPS, start=1):
        print(f"\n[{step_number}/{len(PIPELINE_STEPS)}] {description}", flush=True)
        subprocess.run(
            [sys.executable, str(script_path)],
            cwd=PROJECT_ROOT,
            check=True,
        )

    print("\nPipeline complete. The dashboard artifacts are ready.")


if __name__ == "__main__":
    main()
