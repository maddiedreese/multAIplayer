import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
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
type TakeUpdaterAuthFailure = () => Promise<boolean>;

export type SignedUpdateCheckResult =
  { status: "available"; handle: SignedUpdateHandle } | { status: "up-to-date" } | { status: "unverified" };

let updaterCheckQueue: Promise<void> = Promise.resolve();

export function checkForSignedUpdate(
  checkForUpdate: CheckForUpdate = check,
  restartApplication: () => Promise<void> = relaunch,
  takeAuthFailure: TakeUpdaterAuthFailure = () => invoke<boolean>("take_updater_auth_failure")
): Promise<SignedUpdateCheckResult> {
  const run: Promise<SignedUpdateCheckResult> = updaterCheckQueue.then(async () => {
    // The native comparator exposes one process-wide read-once signal. Keep the
    // clear/check/read sequence indivisible so a StrictMode remount or another
    // caller cannot consume a different check's authentication result.
    await takeAuthFailure();
    const update = await checkForUpdate();
    const authenticationFailed = await takeAuthFailure();
    if (!update) return { status: authenticationFailed ? "unverified" : "up-to-date" };

    const notice = normalizeSignedUpdate(update);
    if (!notice) {
      await update.close();
      return { status: "unverified" };
    }

    return {
      status: "available",
      handle: {
        notice,
        async install() {
          await update.downloadAndInstall();
          await restartApplication();
        },
        close: () => update.close()
      }
    };
  });
  updaterCheckQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
