import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSecretRisks, detectTerminalCommandRisks } from "../src/lib/security/secretRisks";

test("detectSecretRisks flags sensitive filenames", () => {
  assert.deepEqual(detectSecretRisks("DATABASE_URL=postgres://example", "/repo/.env.local"), [
    "Sensitive file access",
    "Environment variables"
  ]);
  assert.deepEqual(detectSecretRisks("[default]\naws_access_key_id = abc", "/Users/maddie/.aws/credentials"), [
    "Sensitive file access",
    "Credential-looking output"
  ]);
});

test("detectSecretRisks flags environment dumps and credential-looking output", () => {
  const risks = detectSecretRisks(
    ["$ printenv", "AWS_SECRET_ACCESS_KEY=abc123456789000000", "api_token: redacted-but-still-sensitive-looking"].join(
      "\n"
    )
  );

  assert.deepEqual(risks, ["Environment variables", "Credential-looking output"]);
});

test("detectSecretRisks flags token and private key patterns", () => {
  assert.deepEqual(detectSecretRisks("token=ghp_1234567890abcdefghijklmnop"), [
    "Credential-looking output",
    "Token or private key pattern"
  ]);
  assert.deepEqual(detectSecretRisks("-----BEGIN OPENSSH PRIVATE KEY-----\nabc"), ["Token or private key pattern"]);
});

test("detectTerminalCommandRisks flags environment dumps and sensitive file reads", () => {
  assert.deepEqual(detectTerminalCommandRisks("printenv | sort"), ["Environment variables"]);
  assert.deepEqual(detectTerminalCommandRisks("cat .env.local"), ["Sensitive file access"]);
  assert.deepEqual(detectTerminalCommandRisks("rg token ~/.aws/credentials"), ["Sensitive file access"]);
});

test("detectTerminalCommandRisks flags credential-looking command text", () => {
  assert.deepEqual(
    detectTerminalCommandRisks("curl -H 'Authorization: token=ghp_1234567890abcdefghijklmnop' https://api.github.com"),
    ["Credential-looking command", "Token or private key pattern"]
  );
  assert.deepEqual(detectTerminalCommandRisks("npm test"), []);
});
