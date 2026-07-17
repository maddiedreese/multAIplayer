#!/usr/bin/env node

import { accessSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseDocument } from "yaml";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const ignoredDirectories = new Set([".git", "build", "dist", "node_modules", "reports", "target", "test-results"]);

export function validateRepositoryContent(root = defaultRoot) {
  const markdownFiles = walkFiles(root, (path) => path.endsWith(".md"));
  validateMarkdownLinks(root, markdownFiles);

  const templateRoot = resolve(root, ".github/ISSUE_TEMPLATE");
  const yamlFiles = existsSync(templateRoot) ? walkFiles(templateRoot, (path) => /\.ya?ml$/.test(path)) : [];
  const documents = parseYamlFiles(yamlFiles);
  for (const path of yamlFiles) {
    const name = relative(templateRoot, path);
    validateIssueTemplate(name, documents[path]);
  }
}

export function validateMarkdownLinks(root, markdownFiles) {
  const errors = [];

  for (const sourcePath of markdownFiles) {
    const source = readFileSync(sourcePath, "utf8");
    let inFence = false;
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;

      for (const rawDestination of markdownLinkDestinations(line)) {
        const destination = markdownDestination(rawDestination);
        if (!destination || /^[a-z][a-z0-9+.-]*:/i.test(destination)) continue;

        const [rawPath, rawFragment] = destination.split("#", 2);
        let linkPath;
        let fragment;
        try {
          linkPath = decodeURIComponent(rawPath);
          fragment = rawFragment === undefined ? undefined : decodeURIComponent(rawFragment);
        } catch {
          errors.push(`${relative(root, sourcePath)}:${index + 1}: malformed URL encoding in ${destination}`);
          continue;
        }

        const targetPath = linkPath ? resolve(dirname(sourcePath), linkPath) : sourcePath;
        const relativeTarget = relative(root, targetPath);
        if (relativeTarget === ".." || relativeTarget.startsWith(`..${sep}`)) {
          errors.push(`${relative(root, sourcePath)}:${index + 1}: local link leaves the repository: ${destination}`);
          continue;
        }
        let targetMarkdown;
        try {
          if (fragment && targetPath.endsWith(".md")) {
            targetMarkdown = readFileSync(targetPath, "utf8");
          } else {
            accessSync(targetPath);
          }
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            (error.code === "ENOENT" || error.code === "ENOTDIR")
          ) {
            errors.push(`${relative(root, sourcePath)}:${index + 1}: missing local link target: ${destination}`);
            continue;
          }
          throw error;
        }
        if (targetMarkdown !== undefined) {
          if (!markdownAnchors(targetMarkdown).has(fragment)) {
            errors.push(`${relative(root, sourcePath)}:${index + 1}: missing Markdown heading: ${destination}`);
          }
        }
      }
    }
  }

  if (errors.length > 0) throw new Error(`Repository documentation has invalid local links:\n${errors.join("\n")}`);
}

export function parseYamlFiles(paths) {
  const documents = {};
  const errors = [];
  for (const path of paths) {
    const document = parseDocument(readFileSync(path, "utf8"), { prettyErrors: true, uniqueKeys: true });
    if (document.errors.length > 0) {
      errors.push(...document.errors.map((error) => `${path}: ${error.message}`));
      continue;
    }
    documents[path] = document.toJS({ maxAliasCount: 0 });
  }
  if (errors.length > 0) throw new Error(`Invalid GitHub issue-template YAML:\n${errors.join("\n")}`);
  return documents;
}

export function validateIssueTemplate(name, document) {
  if (!isObject(document)) throw new Error(`${name}: template must be a YAML mapping`);
  if (name === "config.yml" || name === "config.yaml") {
    if (document.blank_issues_enabled !== undefined && typeof document.blank_issues_enabled !== "boolean") {
      throw new Error(`${name}: blank_issues_enabled must be true or false`);
    }
    if (document.contact_links !== undefined && !Array.isArray(document.contact_links)) {
      throw new Error(`${name}: contact_links must be a list`);
    }
    return;
  }

  requireNonemptyString(document.name, `${name}: name`);
  requireNonemptyString(document.description, `${name}: description`);
  if (!Array.isArray(document.body) || document.body.length === 0)
    throw new Error(`${name}: body must be a nonempty list`);

  document.body.forEach((field, index) => {
    const location = `${name}: body[${index}]`;
    if (!isObject(field)) throw new Error(`${location} must be a mapping`);
    requireNonemptyString(field.type, `${location}.type`);
    if (!isObject(field.attributes)) throw new Error(`${location}.attributes must be a mapping`);
  });
}

function markdownLinkDestinations(line) {
  const reference = line.match(/^\s*\[[^\]]+\]:\s*(\S+)/)?.[1];
  return [
    ...Array.from(line.matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/g), (match) => match[1]),
    ...Array.from(line.matchAll(/<(?:a|img)\b[^>]*(?:href|src)=["']([^"']+)["']/gi), (match) => match[1]),
    ...(reference ? [reference] : [])
  ];
}

function markdownDestination(raw) {
  const value = raw.trim();
  if (value.startsWith("<")) return value.slice(1, value.indexOf(">"));
  return value.split(/\s+(?=["'])/, 1)[0];
}

function markdownAnchors(source) {
  const anchors = new Set();
  const occurrences = new Map();
  let inFence = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (heading) {
      const base = plainHeadingText(heading)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s+/g, "-");
      const count = occurrences.get(base) ?? 0;
      occurrences.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${count}`);
    }
    for (const match of line.matchAll(/<a\s+(?:name|id)=["']([^"']+)["']/gi)) anchors.add(match[1]);
  }
  return anchors;
}

function plainHeadingText(heading) {
  let text = "";
  let insideTag = false;
  for (const character of heading) {
    if (character === "<") {
      insideTag = true;
    } else if (character === ">" && insideTag) {
      insideTag = false;
    } else if (!insideTag) {
      text += character;
    }
  }
  return text;
}

function walkFiles(directory, include) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(path, include);
    return entry.isFile() && include(path) ? [path] : [];
  });
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonemptyString(value, location) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${location} must be a nonempty string`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateRepositoryContent();
}
