import assert from "node:assert/strict";
import test from "node:test";
import { projectStatusLabel } from "../src/lib/git/projectStatus";

test("project status uses a branch when the folder is a Git workspace", () => {
  assert.equal(projectStatusLabel("main"), "main");
});

test("project status describes attached non-Git folders without remaining in loading state", () => {
  assert.equal(projectStatusLabel(null), "Local folder");
  assert.equal(projectStatusLabel(""), "Local folder");
});
