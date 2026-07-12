import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const policyPath = ".github/crypto-vector-dependency.json";
const workflowPath = ".github/workflows/ci.yml";
const policy = JSON.parse(readFileSync(policyPath, "utf8"));
const workflow = readFileSync(workflowPath, "utf8");
const dayMs = 24 * 60 * 60 * 1_000;
const reviewedAt = parseDate(policy.reviewedAt, "reviewedAt");
const reviewBy = parseDate(policy.reviewBy, "reviewBy");
const today = currentDate();

assert.equal(policy.package, "cryptography", `${policyPath}: package must remain cryptography`);
assert.match(policy.version, /^\d+\.\d+\.\d+$/, `${policyPath}: version must be exact`);
assert.equal(policy.maximumReviewDays, 90, `${policyPath}: review window must remain capped at 90 days`);
assert.ok(reviewBy >= reviewedAt, `${policyPath}: reviewBy precedes reviewedAt`);
assert.ok(
  (reviewBy.getTime() - reviewedAt.getTime()) / dayMs <= policy.maximumReviewDays,
  `${policyPath}: dependency review window exceeds ${policy.maximumReviewDays} days`
);
assert.match(
  workflow,
  new RegExp(`python3 -m pip install --disable-pip-version-check ${policy.package}==${escapeRegex(policy.version)}`),
  `${workflowPath}: independent verifier must install ${policy.package}==${policy.version}`
);

if (today > reviewBy) {
  throw new Error(
    `${policy.package}==${policy.version} review expired on ${policy.reviewBy}. ` +
      `Review current releases and advisories, update the exact pin if appropriate, then advance reviewedAt/reviewBy.`
  );
}

console.log(`${policy.package}==${policy.version} is reviewed through ${policy.reviewBy}.`);

function parseDate(value, field) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/, `${policyPath}: ${field} must use YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00Z`);
  assert.equal(date.toISOString().slice(0, 10), value, `${policyPath}: ${field} is not a real date`);
  return date;
}

function currentDate() {
  const override = process.env.MULTAIPLAYER_POLICY_DATE;
  return override ? parseDate(override, "MULTAIPLAYER_POLICY_DATE") : new Date(new Date().toISOString().slice(0, 10));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
