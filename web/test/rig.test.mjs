import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { setupValueOk, setupText, setupChanges, rigPlan } from "../src/rig.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(path.join(HERE, "spec-for-tests.json"), "utf8"));
const fixtures = JSON.parse(readFileSync(path.join(HERE, "rig-fixtures.json"), "utf8"));

// Key order shouldn't matter for object equality; sort a plan row's keys before comparing so a JS
// object built in a different field order still counts as equal.
function sortedPlan(plan) {
  return plan.map((row) => Object.fromEntries(Object.keys(row).sort().map((k) => [k, row[k]])));
}

test("setupValueOk matches Python spec.setup_value_ok", () => {
  for (const { index, value, expected } of fixtures.setupValueOk) {
    assert.equal(setupValueOk(index, value, spec), expected, `index ${index}, value ${value}`);
  }
});

test("setupChanges matches Python server.setup_changes", () => {
  for (const { values, index, value, expected } of fixtures.setupChanges) {
    assert.deepEqual(setupChanges(values, index, value), expected, `index ${index}, value ${value}`);
  }
});

test("rigPlan matches Python spec.rig_plan across every wizard answer combination", () => {
  const { valueSets, cases } = fixtures.rigPlan;
  let checked = 0;
  for (const { answers, valueSet, expected } of cases) {
    const values = valueSets[valueSet];
    const got = rigPlan(answers, values, spec);
    assert.deepEqual(sortedPlan(got), sortedPlan(expected),
      `answers=${JSON.stringify(answers)} valueSet=${valueSet}`);
    checked++;
  }
  assert.equal(checked, cases.length);
});

// setupText isn't exercised directly by the Python fixtures (spec.py has no standalone setup_text
// test data), but rigPlan's "from"/"to" fields run through it on every case above, across every kind
// (choice, onoff, percent, locut, hz2, step) that appears in a plan row. Spot-check the two kinds a
// plan row would otherwise not exercise if every fixture case happened to skip them.
test("setupText: locut and hz2 formatting", () => {
  assert.equal(setupText(43, 0, spec), "20 Hz"); // locut index 0 -> 20 * 2^0
  assert.equal(setupText(43, 112, spec), "508 Hz"); // locut index 112 -> top of range
  assert.equal(setupText(14, 880, spec), "440.0 Hz"); // hz2: raw value is Hz * 2
});
