import { useEffect, useState } from "react";
import { installNativeInviteIntake, type NativeInvitePayload } from "../lib/nativeInviteIntake";
import { reportExpectedFailure } from "../lib/nonFatalReporting";

type NativeInviteInstaller = (
  onInvite: (invite: NativeInvitePayload) => void | Promise<void>,
  signal?: AbortSignal
) => Promise<() => void>;

/** Keeps an OS-delivered invitation in React memory only. The onboarding flow
 * should clear it after delegating to the existing capability-bound MLS join.
 */
export function useNativeInviteIntake(installer: NativeInviteInstaller = installNativeInviteIntake): {
  invite: NativeInvitePayload | null;
  clearInvite: () => void;
} {
  const [invite, setInvite] = useState<NativeInvitePayload | null>(null);

  useEffect(() => {
    let disposed = false;
    let uninstall: (() => void) | undefined;
    const controller = new AbortController();
    void installer((next) => {
      if (!disposed) setInvite(next);
    }, controller.signal)
      .then((stop) => {
        if (disposed) stop();
        else uninstall = stop;
      })
      .catch(() => {
        if (!controller.signal.aborted) reportExpectedFailure("native invite intake was unavailable");
      });
    return () => {
      disposed = true;
      controller.abort();
      uninstall?.();
    };
  }, [installer]);

  return { invite, clearInvite: () => setInvite(null) };
}
