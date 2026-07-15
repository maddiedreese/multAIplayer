import { open } from "@tauri-apps/plugin-dialog";

import { isTauriRuntime } from "./runtime";

export async function chooseProjectFolder(defaultPath: string): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath
  });
  return typeof selected === "string" ? selected : null;
}
