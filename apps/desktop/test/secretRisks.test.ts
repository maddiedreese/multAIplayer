import assert from "node:assert/strict";
import { test } from "node:test";
import { detectBrowserSecretRisks, detectSecretRisks } from "../src/lib/secretRisks";

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
  const risks = detectSecretRisks([
    "$ printenv",
    "AWS_SECRET_ACCESS_KEY=abc123456789000000",
    "api_token: redacted-but-still-sensitive-looking"
  ].join("\n"));

  assert.deepEqual(risks, [
    "Environment variables",
    "Credential-looking output"
  ]);
});

test("detectSecretRisks flags token and private key patterns", () => {
  assert.deepEqual(detectSecretRisks("token=ghp_1234567890abcdefghijklmnop"), [
    "Credential-looking output",
    "Token or private key pattern"
  ]);
  assert.deepEqual(detectSecretRisks("-----BEGIN OPENSSH PRIVATE KEY-----\nabc"), [
    "Token or private key pattern"
  ]);
});

test("detectBrowserSecretRisks flags signed-in and account pages", () => {
  assert.deepEqual(detectBrowserSecretRisks("https://github.com/maddiedreese/multAIplayer"), [
    "Signed-in browser page"
  ]);
  assert.deepEqual(detectBrowserSecretRisks("https://github.com/settings/tokens"), [
    "Signed-in browser page",
    "Account or credential page"
  ]);
  assert.deepEqual(detectBrowserSecretRisks("https://example.com/account/security"), [
    "Account or credential page"
  ]);
  assert.deepEqual(detectBrowserSecretRisks("not a url"), []);
});
