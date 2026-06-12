# integrity-risk-modelling-lab

Open-source prototype for integrity risk modelling using synthetic procurement and payment data.

This project predicts an integrity risk level for review prioritisation. It does not detect, prove, or allege corruption, fraud, bribery, misconduct, or any other wrongdoing.

## Data Notice

- The dataset is fully synthetic.
- Do not add real names, IC numbers, emails, phone numbers, bank accounts, or confidential data.
- Vendor IDs and transaction IDs are synthetic identifiers only.
- Risk labels are intended to help prioritise human review, not to make determinations about conduct.

## Project Structure

```text
data/raw/
data/processed/
src/
models/
outputs/charts/
outputs/reports/
notebooks/
app.py
requirements.txt
README.md
LICENSE
.gitignore
```

## Quick Start

Install dependencies:

```bash
pip install -r requirements.txt
```

Generate the synthetic dataset:

```bash
python src/generate_dataset.py
```

Preprocess the dataset:

```bash
python src/preprocess.py
```

Train and compare baseline models:

```bash
python src/train_model.py
```

Evaluate the selected model:

```bash
python src/evaluate_model.py
```

Launch the Streamlit app:

```bash
streamlit run app.py
```

The generator writes:

```text
data/raw/integrity_procurement_risk_dataset.csv
```

Training writes:

```text
models/integrity_risk_model.pkl
outputs/reports/model_comparison.csv
outputs/reports/classification_report.txt
outputs/charts/confusion_matrix.png
outputs/charts/feature_importance.png
```

## Dataset

The generator creates 1,000 synthetic procurement/payment transactions with transaction attributes, derived red-flag features, a capped `risk_score` from 0 to 100, a `risk_level`, and a `review_required` field.

Risk level bands:

- `Low`: 0 to 24
- `Medium`: 25 to 49
- `High`: 50 to 74
- `Critical`: 75 to 100

Approximate generated distribution:

- Low: 40-50%
- Medium: 25-35%
- High: 15-20%
- Critical: 5-10%

## Intended Use

Use this repository for learning, prototyping, modelling experiments, dashboards, and documentation around review prioritisation workflows with synthetic procurement/payment data.

Do not use the prototype as a decision system or as evidence of wrongdoing.
