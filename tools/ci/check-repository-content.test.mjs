import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseYamlFiles,
  validateIssueTemplate,
  validateMarkdownLinks
} from "../../scripts/check-repository-content.mjs";

test("Markdown validation accepts inline, HTML, and reference links and ignores fenced examples", () => {
  const root = mkdtempSync(join(tmpdir(), "multaiplayer-doc-links-"));
  mkdirSync(join(root, "docs"));
  const index = join(root, "README.md");
  const guide = join(root, "docs/guide.md");
  writeFileSync(
    index,
    '[Guide](docs/guide.md#getting-started)\n<a href="docs/guide.md">Guide</a>\n[More][guide]\n[guide]: docs/guide.md\n```md\n[Example](missing.md)\n```\n'
  );
  writeFileSync(guide, "# Getting <em>started</em>\n");
  assert.doesNotThrow(() => validateMarkdownLinks(root, [index, guide]));
});

test("Markdown validation rejects missing local files and headings", () => {
  const root = mkdtempSync(join(tmpdir(), "multaiplayer-doc-links-"));
  const index = join(root, "README.md");
  writeFileSync(index, "[Missing](missing.md)\n[Heading](README.md#absent)\n");
  assert.throws(
    () => validateMarkdownLinks(root, [index]),
    /missing local link target: missing\.md[\s\S]*missing Markdown heading: README\.md#absent/
  );
});

test("issue-template YAML is parsed with a real YAML parser", () => {
  const root = mkdtempSync(join(tmpdir(), "multaiplayer-issue-yaml-"));
  const valid = join(root, "valid.yml");
  const invalid = join(root, "invalid.yml");
  writeFileSync(valid, "name: Bug report\nbody:\n  - type: textarea\n");
  writeFileSync(invalid, "name: [unterminated\n");
  assert.equal(parseYamlFiles([valid])[valid].name, "Bug report");
  assert.throws(() => parseYamlFiles([invalid]), /Invalid GitHub issue-template YAML/);
});

test("issue forms require their basic GitHub top-level shape", () => {
  const valid = {
    name: "Bug report",
    description: "Report a reproducible problem",
    body: [
      { type: "markdown", attributes: { value: "Please redact secrets." } },
      {
        type: "checkboxes",
        id: "privacy",
        attributes: { label: "Privacy", options: [{ label: "I redacted secrets." }] },
        validations: { required: true }
      }
    ]
  };
  assert.doesNotThrow(() => validateIssueTemplate("bug.yml", valid));
  assert.throws(() => validateIssueTemplate("bug.yml", { ...valid, body: ["not a field"] }), /must be a mapping/);
});

test("issue chooser config uses the expected basic types", () => {
  assert.doesNotThrow(() =>
    validateIssueTemplate("config.yml", {
      blank_issues_enabled: false,
      contact_links: [{ name: "Security", url: "https://example.com/security", about: "Report privately" }]
    })
  );
  assert.throws(
    () =>
      validateIssueTemplate("config.yml", {
        blank_issues_enabled: "false",
        contact_links: []
      }),
    /blank_issues_enabled must be true or false/
  );
});
