# Integrity Intelligence Dashboard

Integrity Intelligence Dashboard is a React and Vite analytics workspace for exploring fully synthetic procurement and payment data. It combines a reproducible Python machine-learning pipeline with a Vercel-ready frontend for review-priority analysis.

The project predicts and visualises integrity review priority. It does not detect, prove, confirm, or allege corruption, fraud, bribery, misconduct, or wrongdoing.

## Key Features

- React and Vite production dashboard designed for Vercel.
- Responsive overview, transaction explorer, model lab, and scenario studio.
- 1,000 fully synthetic procurement/payment transactions.
- Transparent browser-side scenario scoring from 0 to 100.
- Low, Medium, High, and Critical review-priority bands.
- Search, department, region, and risk-level filters.
- Filtered CSV export directly from the browser.
- Logistic Regression, Decision Tree, Random Forest, and Gradient Boosting comparison.
- Classification report, confusion matrix, and feature-importance visualisation.
- End-to-end Python and JavaScript tests in GitHub Actions.

## Responsible Use

All records, IDs, labels, and values are synthetic. Do not add real names, identity numbers, emails, phone numbers, bank accounts, confidential data, commercially sensitive data, or personal data.

The scenario studio is a transparent planning tool. Its output supports human review prioritisation and is not a finding or allegation of misconduct.

## Architecture

```text
React / Vite frontend
  ├── Overview dashboard
  ├── Transaction explorer
  ├── Model Lab
  └── Browser-side Scenario Studio
            │
            ▼
Vite build-time data preparation
  ├── Synthetic transaction CSV
  ├── Model comparison report
  ├── Classification report
  ├── Confusion matrix
  └── Feature importance
            │
            ▼
Python ML pipeline
  ├── Generate synthetic data
  ├── Preprocess features
  ├── Train four classifiers
  └── Evaluate the selected model
```

## Project Structure

```text
index.html
package.json
vercel.json
vite.config.js
scripts/
  prepare-data.mjs
src/
  App.jsx
  main.jsx
  styles.css
  lib/
    risk.js
    risk.test.js
data/
  raw/
  processed/
models/
outputs/
  charts/
  reports/
tests/
  test_generate_dataset.py
  test_preprocess.py
run_pipeline.py
requirements.txt
requirements-dev.txt
```

## Frontend Development

Install Node.js 22 or later, then:

```bash
npm install
npm run dev
```

The Vite development server starts the React dashboard. Before every production build, `scripts/prepare-data.mjs` converts the repository's synthetic CSV and model reports into static browser assets.

Run frontend tests:

```bash
npm test
```

Create the production build:

```bash
npm run build
```

The production output is written to `dist/`.

## Rebuild the Synthetic Data and Models

Install Python dependencies:

```bash
pip install -r requirements-dev.txt
```

Run the complete reproducible pipeline:

```bash
python run_pipeline.py
```

This command generates the dataset, preprocesses features, trains and compares four classifiers, selects the best model by macro F1-score, and regenerates the evaluation reports and charts.

Run Python tests:

```bash
pytest
```

## Deploy to Vercel

1. Import `Hakimcorleone/Integrity-Dashboard` into Vercel.
2. Set the production branch to `main`.
3. Keep the project root as the repository root.
4. Vercel will read `vercel.json`, install the Node dependencies, run `npm run build`, and serve `dist/`.
5. Every subsequent push to `main` creates a new production deployment.

No Python server is required in production. The React dashboard is delivered as static assets, and the scenario engine runs in the user's browser.

## Machine-Learning Approach

The Python modelling workflow uses `risk_level` as the target and excludes identifiers plus rule-derived outputs that would leak the answer:

- `transaction_id`
- `vendor_id`
- `risk_score`
- `review_required`

Categorical features are one-hot encoded. A stratified train/test split preserves class distribution. The best model is selected using macro F1-score so each risk class receives equal weight.

Current model comparison:

1. Logistic Regression
2. Gradient Boosting Classifier
3. Random Forest Classifier
4. Decision Tree Classifier

The model results are displayed for governance and evaluation. The web scenario studio deliberately uses the documented transparent synthetic scoring rules so users can see every active signal and its contribution.

## Risk Bands

- Low: 0–24
- Medium: 25–49
- High: 50–74
- Critical: 75–100

High and Critical synthetic scenarios are prioritised for human review.

## Automated Validation

GitHub Actions runs on every push and pull request to `main`:

- rebuild the complete Python pipeline;
- run the Python test suite;
- install the React dependencies;
- run browser-side scoring tests; and
- create the Vite production build.

## Limitations

- The dataset is synthetic and does not represent any real organisation, supplier, person, payment, or transaction.
- Synthetic labels reflect documented rules rather than real-world investigation outcomes.
- The prototype does not perform automated adverse decisions.
- Public deployments must not accept confidential, personal, commercially sensitive, or operationally sensitive data.
- Feature importance values are model signals and must not be interpreted as proof of wrongdoing.
- Any real implementation requires governance, legal review, data protection, validation, monitoring, and human oversight.

## License

Licensed under the MIT License. See [LICENSE](LICENSE).

Copyright (c) 2026 Hakim Shaisham
