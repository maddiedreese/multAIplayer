import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readlink } from "node:fs/promises";
import { join, posix } from "node:path";

export const runtimeExcludedPaths = new Set([
  "/.dockerenv",
  "/dev",
  "/etc/hostname",
  "/etc/hosts",
  "/etc/resolv.conf",
  "/proc",
  "/sys"
]);

export async function createRuntimeFilesystemManifest(rootDirectory = "/") {
  const entries = [];
  await visit(rootDirectory, "/", entries);
  return entries;
}

export function isRuntimeExcluded(path) {
  for (const excluded of runtimeExcludedPaths) {
    if (path === excluded || path.startsWith(`${excluded}/`)) {
      return true;
    }
  }
  return false;
}

async function visit(rootDirectory, relativePath, entries) {
  if (isRuntimeExcluded(relativePath)) {
    return;
  }
  const absolutePath = relativePath === "/" ? rootDirectory : join(rootDirectory, ...relativePath.slice(1).split("/"));
  const stat = await lstat(absolutePath);
  const entry = {
    path: relativePath,
    type: filesystemEntryType(stat, relativePath),
    mode: (stat.mode & 0o7777).toString(8).padStart(4, "0"),
    uid: stat.uid,
    gid: stat.gid
  };
  if (stat.isFile()) {
    const { content, openedStat } = await readRegularFile(absolutePath, stat);
    entry.size = openedStat.size;
    entry.sha256 = createHash("sha256").update(content).digest("hex");
  } else if (stat.isSymbolicLink()) {
    entry.target = await readlink(absolutePath);
  }
  entries.push(entry);
  if (!stat.isDirectory()) {
    return;
  }
  const children = (await readdir(absolutePath)).sort();
  for (const child of children) {
    await visit(rootDirectory, posix.join(relativePath, child), entries);
  }
}

async function readRegularFile(path, directoryEntryStat) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const openedStat = await handle.stat();
    if (
      !openedStat.isFile() ||
      openedStat.dev !== directoryEntryStat.dev ||
      openedStat.ino !== directoryEntryStat.ino
    ) {
      throw new Error(`Filesystem entry changed while building runtime manifest: ${path}`);
    }
    return { content: await handle.readFile(), openedStat };
  } finally {
    await handle.close();
  }
}

export function filesystemEntryType(stat, path) {
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  if (stat.isSymbolicLink()) return "symlink";
  throw new Error(`Unexpected special filesystem entry outside runtime exclusions: ${path}`);
}

if (process.argv.includes("--walk-root")) {
  process.stdout.write(`${JSON.stringify(await createRuntimeFilesystemManifest())}\n`);
}
