import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { normalizeSignedUpdate, type UpdateNotice } from "../core/updateCheck";

interface UpdaterResource {
  version: string;
  currentVersion: string;
  body?: string;
  downloadAndInstall(): Promise<void>;
  close(): Promise<void>;
}

export interface SignedUpdateHandle {
  notice: UpdateNotice;
  install(): Promise<void>;
  close(): Promise<void>;
}

type CheckForUpdate = () => Promise<UpdaterResource | null>;

export async function checkForSignedUpdate(
  checkForUpdate: CheckForUpdate = check,
  restartApplication: () => Promise<void> = relaunch
): Promise<SignedUpdateHandle | null> {
  const update = await checkForUpdate();
  if (!update) return null;

  const notice = normalizeSignedUpdate(update);
  if (!notice) {
    await update.close();
    return null;
  }

  return {
    notice,
    async install() {
      await update.downloadAndInstall();
      await restartApplication();
    },
    close: () => update.close()
  };
}
