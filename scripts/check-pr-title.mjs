#!/usr/bin/env node

const title = process.argv.slice(2).join(" ").trim();
const conventionalTitle = /^(feat|fix|docs|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9][a-z0-9._/-]*\))?!?: \S/;

if (!conventionalTitle.test(title)) {
  console.error(
    "PR titles must be Conventional Commits, for example `fix(relay): preserve workspace runtime dependencies`. " +
      "The squash commit title becomes release history."
  );
  process.exit(1);
}

console.log(`PR title is suitable for the squash commit: ${title}`);
