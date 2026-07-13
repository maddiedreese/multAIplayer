import { spawnSync } from "node:child_process";

export interface RustToolchainProbe {
  command: string;
  missing: boolean;
}

export function probeRustToolchain(command = "cargo"): RustToolchainProbe {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return { command, missing: result.error?.code === "ENOENT" };
}
