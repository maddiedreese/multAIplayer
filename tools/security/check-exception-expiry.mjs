import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const todayArgument = process.argv.find((argument) => argument.startsWith("--date="));
const today = parseDate(
  todayArgument ? todayArgument.slice("--date=".length) : new Date().toISOString().slice(0, 10),
  "current date"
);

const trivyPath = path.join(root, ".trivyignore.yaml");
const denyPath = path.join(root, "deny.toml");
const [trivySource, denySource] = await Promise.all([readFile(trivyPath, "utf8"), readFile(denyPath, "utf8")]);

const failures = [];
const trivyEntries = [...trivySource.matchAll(/^\s*- id:\s*(\S+)([\s\S]*?)(?=^\s*- id:|(?![\s\S]))/gm)];
if (trivyEntries.length === 0) {
  failures.push(".trivyignore.yaml contains no recognized vulnerability entries");
}
for (const [, id, body] of trivyEntries) {
  const expiry = body.match(/^\s*expired_at:\s*(\d{4}-\d{2}-\d{2})\s*$/m)?.[1];
  if (!expiry) {
    failures.push(`${id} has no expired_at date`);
    continue;
  }
  if (parseDate(expiry, `${id} expiry`) <= today) {
    failures.push(`${id} expired on ${expiry}`);
  }
}

const rustMarkers = [...denySource.matchAll(/^# exceptions-expire-at:\s*(\d{4}-\d{2}-\d{2})\s*$/gm)];
if (rustMarkers.length !== 1) {
  failures.push(`deny.toml must contain exactly one '# exceptions-expire-at: YYYY-MM-DD' marker`);
} else {
  const expiry = rustMarkers[0][1];
  if (parseDate(expiry, "Rust exception expiry") <= today) {
    failures.push(`Rust advisory exceptions expired on ${expiry}`);
  }
}

if (failures.length > 0) {
  console.error("Security exception review failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Security exception review passed (${trivyEntries.length} Trivy entries; Rust policy deadline ${rustMarkers[0][1]}).`
  );
}

function parseDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date`);
  }
  return date.valueOf();
}
