import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SCENARIO,
  evaluateScenario,
  riskLevelFromScore,
} from "./risk.js";


test("risk level boundaries are stable", () => {
  assert.equal(riskLevelFromScore(24), "Low");
  assert.equal(riskLevelFromScore(25), "Medium");
  assert.equal(riskLevelFromScore(50), "High");
  assert.equal(riskLevelFromScore(75), "Critical");
  assert.equal(riskLevelFromScore(100), "Critical");
});

test("the default controlled scenario is low priority", () => {
  const result = evaluateScenario(DEFAULT_SCENARIO);

  assert.equal(result.score, 0);
  assert.equal(result.level, "Low");
  assert.equal(result.reviewRequired, false);
  assert.deepEqual(result.activeSignals, []);
});

test("a high-signal scenario is capped at critical priority", () => {
  const result = evaluateScenario({
    ...DEFAULT_SCENARIO,
    procurement_method: "Direct Award",
    invoice_amount: 100000,
    claimed_units: 200,
    verified_units: 100,
    number_of_bidders: 1,
    tender_duration_days: 2,
    has_checker: false,
    has_approver: false,
    coi_declared: true,
    past_complaints_12m: 4,
    variation_order_count: 4,
    variation_order_amount: 20000,
    late_delivery_days: 45,
    duplicate_invoice_flag: true,
    split_purchase_flag: true,
  });

  assert.equal(result.score, 100);
  assert.equal(result.level, "Critical");
  assert.equal(result.reviewRequired, true);
  assert.ok(result.activeSignals.length >= 10);
});
