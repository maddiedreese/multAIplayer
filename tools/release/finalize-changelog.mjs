import { readFileSync, writeFileSync } from "node:fs";

export function finalizeChangelog(source, version, date) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid release date: ${date}`);
  }

  const marker = "## [Unreleased]";
  const versionMarker = `## [${version}]`;
  if (source.split(marker).length !== 2) {
    throw new Error("CHANGELOG.md must contain exactly one Unreleased section");
  }
  const unreleasedIndex = source.indexOf(marker);
  const existingVersionIndex = source.indexOf(versionMarker);
  if (existingVersionIndex > unreleasedIndex) {
    return source;
  }
  if (existingVersionIndex !== -1) {
    source = `${source.slice(0, existingVersionIndex)}${source.slice(unreleasedIndex)}`;
  }

  const [, unreleased] = source.split(marker);
  const nextSection = unreleased.indexOf("\n## ");
  const reviewedNotes = (nextSection === -1 ? unreleased : unreleased.slice(0, nextSection)).trim();
  if (!reviewedNotes || reviewedNotes === "_No changes recorded._") {
    throw new Error("The Unreleased section must contain reviewed release notes");
  }

  return source.replace(marker, `${marker}\n\n_No changes recorded._\n\n## [${version}] - ${date}`);
}

export function extractReleaseNotes(source, version) {
  const marker = `## [${version}]`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`CHANGELOG.md has no reviewed section for ${version}`);
  const bodyStart = source.indexOf("\n", start) + 1;
  const nextSection = source.indexOf("\n## ", bodyStart);
  const notes = source.slice(bodyStart, nextSection === -1 ? undefined : nextSection).trim();
  if (!notes) throw new Error(`CHANGELOG.md has no reviewed notes for ${version}`);
  return `${notes}\n`;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const changelogPath = "CHANGELOG.md";
  const source = readFileSync(changelogPath, "utf8");
  const extractArgument = process.argv.find((argument) => argument.startsWith("--extract="));
  if (extractArgument) {
    process.stdout.write(extractReleaseNotes(source, extractArgument.slice("--extract=".length)));
    process.exit(0);
  }
  const packageMetadata = JSON.parse(readFileSync("package.json", "utf8"));
  const dateArgument = process.argv.find((argument) => argument.startsWith("--date="));
  const date = dateArgument?.slice("--date=".length) ?? new Date().toISOString().slice(0, 10);
  const finalized = finalizeChangelog(source, packageMetadata.version, date);
  if (finalized !== source) writeFileSync(changelogPath, finalized);
}
