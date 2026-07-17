import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readRepositoryFile = (path) => readFileSync(path, "utf8");

const workflowStep = (workflow, name) => {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `release workflow must contain the ${name} step`);
  const nextStep = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, nextStep === -1 ? workflow.length : nextStep);
};

test("built-in-token release pull requests dispatch every protected branch check", () => {
  const releaseWorkflow = readRepositoryFile(".github/workflows/release.yml");
  const dispatchStep = workflowStep(
    releaseWorkflow,
    "Dispatch protected checks for a built-in-token release pull request"
  );

  assert.match(
    dispatchStep,
    /if: steps\.release\.outputs\.prs_created == 'true' && steps\.credential\.outputs\.uses_custom_token == 'false'/
  );
  assert.match(dispatchStep, /RELEASE_BRANCH="\$\(jq [^\n]+\)"/);
  assert.match(dispatchStep, /gh workflow run ci\.yml --ref "\$RELEASE_BRANCH"/);
  assert.match(dispatchStep, /gh workflow run journeys\.yml --ref "\$RELEASE_BRANCH" --field required_only=true/);
  assert.match(dispatchStep, /gh workflow run codeql\.yml --ref "\$RELEASE_BRANCH"/);
});

test("Railway watches every relay image build and runtime dependency", () => {
  const railway = JSON.parse(readRepositoryFile("railway.json"));
  assert.equal(railway.build?.builder, "DOCKERFILE");
  assert.equal(railway.build?.dockerfilePath, "apps/relay/Dockerfile");

  const watchPatterns = new Set(railway.build?.watchPatterns);
  const requiredPatterns = [
    "/apps/relay/**",
    "/apps/desktop/src-tauri/Cargo.lock",
    "/apps/desktop/src-tauri/Cargo.toml",
    "/apps/desktop/src-tauri/crates/mls-core/**",
    "/packages/**",
    "/tools/release/relay-runtime-dependency-closure.mjs",
    "/.dockerignore",
    "/package.json",
    "/package-lock.json",
    "/tsconfig.base.json",
    "/railway.json"
  ];

  for (const pattern of requiredPatterns) {
    assert.ok(watchPatterns.has(pattern), `Railway must rebuild when ${pattern} changes`);
  }
});
