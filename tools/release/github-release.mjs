#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertChannelDoesNotRegress } from "./check-updater-channel-order.mjs";
import { checkReleaseAssets } from "./check-release-assets.mjs";
import { extractReleaseNotes } from "./finalize-changelog.mjs";
import { planReleasePublication } from "./plan-release-publication.mjs";
import { validateReleaseAssetDigests } from "./validate-release-asset-digests.mjs";

const tagPattern = /^v[0-9][0-9A-Za-z._-]*$/;

function command(commandName, args, options = {}) {
  const output = execFileSync(commandName, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options
  });
  return typeof output === "string" ? output.trim() : "";
}

function gh(args, options) {
  return command("gh", args, options);
}

function api(path, { optional = false } = {}) {
  const result = spawnSync("gh", ["api", path], { encoding: "utf8" });
  if (result.status === 0) return JSON.parse(result.stdout);
  if (optional && /HTTP 404/.test(result.stderr)) return null;
  throw new Error(result.stderr.trim() || `gh api ${path} failed`);
}

export function findReleaseByTag(releases, tag) {
  assert.ok(Array.isArray(releases), "GitHub releases response must be an array");
  const matches = releases.filter((release) => release?.tag_name === tag);
  assert.ok(matches.length <= 1, `GitHub returned multiple releases for ${tag}`);
  return matches[0] ?? null;
}

function releaseByTag(repository, tag, { optional = false } = {}) {
  const published = api(`repos/${repository}/releases/tags/${tag}`, { optional: true });
  if (published) return published;

  for (let page = 1; ; page += 1) {
    const releases = api(`repos/${repository}/releases?per_page=100&page=${page}`);
    const release = findReleaseByTag(releases, tag);
    if (release) return release;
    if (releases.length < 100) break;
  }

  if (optional) return null;
  throw new Error(`GitHub release ${tag} was not found`);
}

function tagCommit(repository, tag) {
  const metadata = api(`repos/${repository}/commits/${tag}`);
  assert.match(metadata.sha, /^[0-9a-f]{40}$/, "GitHub did not resolve the release tag to a commit");
  return metadata.sha;
}

export function isPrereleaseTag(tag) {
  assert.match(tag, tagPattern, `release tag is invalid: ${tag}`);
  return /-(?:alpha|beta|rc)(?:[.-]|$)/.test(tag);
}

export function planChannelUpdate(candidateBytes, currentBytes) {
  if (currentBytes === null) return "create";
  const candidate = JSON.parse(candidateBytes);
  const current = JSON.parse(currentBytes);
  assertChannelDoesNotRegress(candidate, current);
  return Buffer.compare(Buffer.from(candidateBytes), Buffer.from(currentBytes)) === 0 ? "unchanged" : "update";
}

function assertPrivateDraft(repository, tag) {
  const metadata = releaseByTag(repository, tag);
  assert.equal(metadata.draft, true, `refusing to mutate already-public release ${tag}`);
}

function authenticateAssets(directory, metadata, expectedNames) {
  const names = validateReleaseAssetDigests(directory, metadata, expectedNames);
  const namesPath = join(mkdtempSync(join(tmpdir(), "multaiplayer-release-names-")), "names.txt");
  writeFileSync(namesPath, `${names.join("\n")}\n`);
  checkReleaseAssets("published-list", namesPath);
  return names;
}

export function validateReleaseEvent({ eventName, eventRef, eventSha, tag, tagCommitSha }) {
  if (eventName === "push") {
    assert.equal(eventRef, `refs/tags/${tag}`, `release workflow ref must be refs/tags/${tag}; found ${eventRef}`);
    assert.equal(
      tagCommitSha,
      eventSha,
      `release event SHA does not match the resolved tag: event ${eventSha}, tag ${tagCommitSha}`
    );
    return;
  }
  assert.equal(eventName, "workflow_dispatch", `unsupported release event: ${eventName}`);
}

export function resolveReleaseSource({ tag, eventName, eventRef, eventSha, repository, outputPath }) {
  assert.match(tag, tagPattern, `release tag is invalid: ${tag}`);
  command("git", ["show-ref", "--verify", `refs/tags/${tag}`]);
  command("git", ["fetch", "--no-tags", "origin", "main:refs/remotes/origin/main"]);
  const commit = command("git", ["rev-parse", `refs/tags/${tag}^{commit}`]);
  validateReleaseEvent({ eventName, eventRef, eventSha, tag, tagCommitSha: commit });
  command("git", ["merge-base", "--is-ancestor", commit, "refs/remotes/origin/main"]);
  const existing = releaseByTag(repository, tag, { optional: true });
  assert.ok(existing === null || existing.draft, `release ${tag} is already public; refusing to rebuild or replace it`);
  appendFileSync(outputPath, `commit=${commit}\nprerelease=${isPrereleaseTag(tag)}\ntag=${tag}\n`);
}

export function publishRelease({ assetsDirectory, expectedCommit, prerelease, repository, tag }) {
  checkReleaseAssets("published", assetsDirectory);
  let metadata = releaseByTag(repository, tag, { optional: true });
  const plan = planReleasePublication({
    releaseMetadata: metadata,
    expectedCommit,
    resolvedCommit: tagCommit(repository, tag)
  });

  if (plan === "verify-public") {
    const publishedDirectory = mkdtempSync(join(tmpdir(), "multaiplayer-public-release-"));
    gh(["release", "download", tag, "--dir", publishedDirectory, "--repo", repository], { stdio: "inherit" });
    checkReleaseAssets("published", publishedDirectory);
    authenticateAssets(publishedDirectory, metadata);
    authenticateAssets(assetsDirectory, metadata, readdirSync(assetsDirectory).sort());
    console.log(`Release ${tag} is already public with the retained authenticated build output.`);
    return "verified";
  }

  if (plan === "create-draft") {
    const notesPath = join(mkdtempSync(join(tmpdir(), "multaiplayer-release-notes-")), "notes.md");
    const notes = extractReleaseNotes(readFileSync("CHANGELOG.md", "utf8"), tag.slice(1));
    writeFileSync(notesPath, notes);
    const args = ["release", "create", tag, "--repo", repository, "--notes-file", notesPath, "--draft"];
    if (prerelease) args.push("--prerelease");
    gh(args, { stdio: "inherit" });
  }

  metadata = releaseByTag(repository, tag);
  for (const asset of metadata.assets) {
    assertPrivateDraft(repository, tag);
    gh(["release", "delete-asset", tag, asset.name, "--yes", "--repo", repository], { stdio: "inherit" });
  }
  assertPrivateDraft(repository, tag);
  const assetPaths = readdirSync(assetsDirectory)
    .sort()
    .map((name) => join(assetsDirectory, name));
  gh(["release", "upload", tag, ...assetPaths, "--repo", repository], { stdio: "inherit" });

  assertPrivateDraft(repository, tag);
  metadata = releaseByTag(repository, tag);
  authenticateAssets(assetsDirectory, metadata);
  if (prerelease) gh(["release", "edit", tag, "--prerelease", "--repo", repository], { stdio: "inherit" });
  assert.equal(tagCommit(repository, tag), expectedCommit, `release tag moved before publication`);
  assertPrivateDraft(repository, tag);
  gh(["release", "edit", tag, "--draft=false", "--repo", repository], { stdio: "inherit" });
  return "published";
}

export function advanceUpdaterChannel({ assetsDirectory, expectedCommit, repository, tag }) {
  assert.equal(tagCommit(repository, tag), expectedCommit, "release tag moved after source resolution");
  const metadata = api(`repos/${repository}/releases/tags/${tag}`);
  assert.equal(metadata.draft, false, `updater channel requires a public release: ${tag}`);
  authenticateAssets(assetsDirectory, metadata);

  const refPath = `repos/${repository}/git/ref/heads/update-channel`;
  if (api(refPath, { optional: true }) === null) {
    gh([
      "api",
      "--method",
      "POST",
      `repos/${repository}/git/refs`,
      "-f",
      "ref=refs/heads/update-channel",
      "-f",
      `sha=${expectedCommit}`
    ]);
  }
  const contentPath = `repos/${repository}/contents/releases/latest.json?ref=update-channel`;
  const existing = api(contentPath, { optional: true });
  const candidateBytes = readFileSync(join(assetsDirectory, "latest.json"));
  let existingSha;
  if (existing) {
    existingSha = existing.sha;
    const currentBytes = Buffer.from(existing.content.replace(/\n/g, ""), "base64");
    const disposition = planChannelUpdate(candidateBytes, currentBytes);
    if (disposition === "unchanged") {
      console.log(`Updater channel already points to ${tag}.`);
      return "unchanged";
    }
  }
  assert.equal(tagCommit(repository, tag), expectedCommit, "release tag moved before updater-channel advancement");
  const args = [
    "api",
    "--method",
    "PUT",
    `repos/${repository}/contents/releases/latest.json`,
    "-f",
    `message=chore: advance updater channel to ${tag}`,
    "-f",
    `content=${candidateBytes.toString("base64")}`,
    "-f",
    "branch=update-channel"
  ];
  if (existingSha) args.push("-f", `sha=${existingSha}`);
  gh(args);
  return existing ? "updated" : "created";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [subcommand] = process.argv.slice(2);
  const env = process.env;
  if (subcommand === "resolve") {
    resolveReleaseSource({
      tag: env.RELEASE_TAG,
      eventName: env.RELEASE_EVENT_NAME,
      eventRef: env.RELEASE_EVENT_REF,
      eventSha: env.RELEASE_EVENT_SHA,
      repository: env.GITHUB_REPOSITORY,
      outputPath: env.GITHUB_OUTPUT
    });
  } else if (subcommand === "publish") {
    publishRelease({
      assetsDirectory: env.RELEASE_ASSETS ?? "release-assets",
      expectedCommit: env.RELEASE_COMMIT,
      prerelease: env.RELEASE_PRERELEASE === "true",
      repository: env.GITHUB_REPOSITORY,
      tag: env.RELEASE_TAG
    });
  } else if (subcommand === "advance-channel") {
    advanceUpdaterChannel({
      assetsDirectory: env.RELEASE_ASSETS ?? "public-release-assets",
      expectedCommit: env.RELEASE_COMMIT,
      repository: env.GITHUB_REPOSITORY,
      tag: env.RELEASE_TAG
    });
  } else {
    throw new Error("expected resolve, publish, or advance-channel subcommand");
  }
}
