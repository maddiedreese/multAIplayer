import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { digestProof, normalizeRuntimeConfig, runtimeWalkerArguments } from "./verify-relay-runtime-equivalence.mjs";
import {
  createRuntimeFilesystemManifest,
  filesystemEntryType,
  isRuntimeExcluded,
  runtimeExcludedPaths
} from "./relay-runtime-filesystem-manifest.mjs";

test("runtime configuration normalization ignores object key order but preserves runtime values", () => {
  const first = normalizeRuntimeConfig({
    Architecture: "arm64",
    Config: { WorkingDir: "/app", Env: ["B=2", "A=1"], ExposedPorts: { "4321/tcp": {} } },
    Os: "linux"
  });
  const second = normalizeRuntimeConfig({
    Os: "linux",
    Config: { ExposedPorts: { "4321/tcp": {} }, Env: ["B=2", "A=1"], WorkingDir: "/app" },
    Architecture: "arm64"
  });
  assert.deepEqual(first, second);
  const changed = normalizeRuntimeConfig({
    Architecture: "arm64",
    Config: { ...first.config, User: "root" },
    Os: "linux"
  });
  assert.notEqual(digestProof(first), digestProof(changed));
});

test("runtime filesystem manifest records content, types, modes, and symlink targets without timestamps", async () => {
  const first = await fixture("relay-proof-first-");
  const second = await fixture("relay-proof-second-");
  try {
    await utimes(join(second, "app", "server.js"), new Date(1_000), new Date(2_000));
    const firstManifest = await createRuntimeFilesystemManifest(first);
    assert.deepEqual(firstManifest, await createRuntimeFilesystemManifest(second));

    const file = firstManifest.find((entry) => entry.path === "/app/server.js");
    const link = firstManifest.find((entry) => entry.path === "/app/entrypoint");
    assert.deepEqual({ type: file.type, mode: file.mode, size: file.size }, { type: "file", mode: "0750", size: 22 });
    assert.ok(Number.isInteger(file.uid) && Number.isInteger(file.gid));
    assert.deepEqual({ type: link.type, target: link.target }, { type: "symlink", target: "server.js" });

    await chmod(join(second, "app", "server.js"), 0o700);
    assert.notDeepEqual(firstManifest, await createRuntimeFilesystemManifest(second));
    await chmod(join(second, "app", "server.js"), 0o750);

    await unlink(join(second, "app", "entrypoint"));
    await symlink("missing.js", join(second, "app", "entrypoint"));
    assert.notDeepEqual(firstManifest, await createRuntimeFilesystemManifest(second));
    await unlink(join(second, "app", "entrypoint"));
    await symlink("server.js", join(second, "app", "entrypoint"));

    await writeFile(join(second, "app", "server.js"), "different\n");
    assert.notDeepEqual(firstManifest, await createRuntimeFilesystemManifest(second));
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});

test("runtime filesystem manifest excludes only the declared Docker-injected runtime paths", async () => {
  const root = await fixture("relay-proof-exclusions-");
  try {
    for (const path of [
      ".dockerenv",
      "data/state.db",
      "dev/null",
      "proc/mounts",
      "sys/kernel",
      "etc/hosts",
      "etc/hostname",
      "etc/resolv.conf"
    ]) {
      const absolutePath = join(root, path);
      await mkdir(join(absolutePath, ".."), { recursive: true });
      await writeFile(absolutePath, path);
    }
    const paths = (await createRuntimeFilesystemManifest(root)).map((entry) => entry.path);
    assert.deepEqual(paths, [...paths].sort(), "manifest paths must use deterministic POSIX ordering");
    assert.ok(paths.includes("/app/server.js"));
    assert.ok(paths.every((path) => !path.startsWith("/proc/")));
    assert.ok(!paths.includes("/.dockerenv"));
    assert.ok(!paths.includes("/etc/hosts"));
    assert.ok(paths.includes("/data/state.db"), "/data is created by the image and remains part of the proof");
    assert.equal(isRuntimeExcluded("/database"), false, "exclusions must not expand by prefix accident");
    assert.equal(isRuntimeExcluded("/procfile"), false, "tree exclusions must stop at path boundaries");
    assert.equal(isRuntimeExcluded("/etc/hosts.allow"), false, "injected-file exclusions must be exact");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime filesystem manifest rejects unexpected special entries", () => {
  const special = {
    isFile: () => false,
    isDirectory: () => false,
    isSymbolicLink: () => false
  };
  assert.throws(() => filesystemEntryType(special, "/run/unexpected.sock"), /Unexpected special filesystem entry/);
});

test("runtime exclusions and walker confinement remain explicit", () => {
  assert.deepEqual(
    [...runtimeExcludedPaths].sort(),
    ["/.dockerenv", "/dev", "/etc/hostname", "/etc/hosts", "/etc/resolv.conf", "/proc", "/sys"].sort()
  );
  const args = runtimeWalkerArguments("relay:test");
  assert.deepEqual(args.slice(0, 13), [
    "run",
    "--rm",
    "--network",
    "none",
    "--no-healthcheck",
    "--read-only",
    "--user",
    "0:0",
    "--entrypoint",
    "node",
    "relay:test",
    "--input-type=module",
    "-"
  ]);
  assert.ok(!args.includes("apps/relay/dist/index.js"), "proof must not start the relay entrypoint");
});

async function fixture(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, "app"), { recursive: true });
  await writeFile(join(root, "app", "server.js"), "console.log('relay');\n");
  await chmod(join(root, "app", "server.js"), 0o750);
  await symlink("server.js", join(root, "app", "entrypoint"));
  return root;
}
