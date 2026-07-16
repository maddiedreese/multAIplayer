import { open } from "@tauri-apps/plugin-dialog";

import { isTauriRuntime, requireNativeRuntime } from "./runtime";

export async function chooseProjectFolder(defaultPath: string): Promise<string | null> {
  if (!isTauriRuntime()) return requireNativeRuntime("Project folder selection");

  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath
  });
  return typeof selected === "string" ? selected : null;
}
