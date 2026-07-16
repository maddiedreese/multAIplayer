import { reportNonFatal } from "../core/nonFatalReporting";

interface CloseRequestedEventLike {
  preventDefault: () => void;
}

interface CloseDrainWindow {
  onCloseRequested: (handler: (event: CloseRequestedEventLike) => void | Promise<void>) => Promise<() => void>;
  close: () => Promise<void>;
}

interface InstallLocalHistoryCloseDrainOptions {
  appWindow: CloseDrainWindow;
  prepare: () => PreparedCloseSnapshot | Promise<PreparedCloseSnapshot>;
  flush: () => Promise<void>;
  reportFailure: (message: string) => void;
  timeoutMs?: number;
  abandonWindowMs?: number;
  now?: () => number;
}

interface PreparedCloseSnapshot {
  token: string;
  enqueue: () => void;
}

/** Snapshots current state and drains history before closing. One immediate unchanged retry may abandon failure. */
export function installLocalHistoryCloseDrain({
  appWindow,
  prepare,
  flush,
  reportFailure,
  timeoutMs = 5_000,
  abandonWindowMs = 15_000,
  now = Date.now
}: InstallLocalHistoryCloseDrainOptions): Promise<() => void> {
  let closingAfterDrain = false;
  let failedAttempt: { token: string; at: number } | null = null;
  let drainInProgress = false;
  return appWindow.onCloseRequested(async (event) => {
    if (closingAfterDrain) return;
    event.preventDefault();
    if (drainInProgress) return;
    drainInProgress = true;
    let token = "__prepare_failed__";
    try {
      const prepared = await prepare();
      token = prepared.token;
      if (failedAttempt && failedAttempt.token === token && now() - failedAttempt.at <= abandonWindowMs) {
        failedAttempt = null;
        await closeAfterSuccessfulDrain(appWindow, reportFailure, (closing) => {
          closingAfterDrain = closing;
        });
        return;
      }
      prepared.enqueue();
      await withTimeout(flush(), timeoutMs);
      failedAttempt = null;
    } catch (error) {
      failedAttempt = { token, at: now() };
      reportNonFatal("flush encrypted local history before closing", error);
      reportFailure(
        "The app could not finish saving encrypted local history. Close again promptly without making changes to quit without the latest local changes."
      );
      return;
    } finally {
      drainInProgress = false;
    }
    await closeAfterSuccessfulDrain(appWindow, reportFailure, (closing) => {
      closingAfterDrain = closing;
    });
  });
}

async function closeAfterSuccessfulDrain(
  appWindow: CloseDrainWindow,
  reportFailure: (message: string) => void,
  setClosing: (closing: boolean) => void
): Promise<void> {
  setClosing(true);
  try {
    await appWindow.close();
  } catch (error) {
    setClosing(false);
    reportNonFatal("close app window after encrypted local-history drain", error);
    reportFailure("Encrypted local history was saved, but the app window could not close. Try closing again.");
  }
}

async function withTimeout(operation: Promise<void>, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out draining encrypted local history.")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
