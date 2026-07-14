import { useEffect, useState } from "react";
import { installNativeInviteIntake, type NativeInvitePayload } from "../lib/nativeInviteIntake";
import { reportExpectedFailure } from "../lib/nonFatalReporting";

/** Keeps an OS-delivered invitation in React memory only. The onboarding flow
 * should clear it after delegating to the existing capability-bound MLS join.
 */
export function useNativeInviteIntake(): {
  invite: NativeInvitePayload | null;
  clearInvite: () => void;
} {
  const [invite, setInvite] = useState<NativeInvitePayload | null>(null);

  useEffect(() => {
    let disposed = false;
    let uninstall: (() => void) | undefined;
    void installNativeInviteIntake((next) => {
      if (!disposed) setInvite(next);
    })
      .then((stop) => {
        if (disposed) stop();
        else uninstall = stop;
      })
      .catch(() => reportExpectedFailure("native invite intake was unavailable"));
    return () => {
      disposed = true;
      uninstall?.();
    };
  }, []);

  return { invite, clearInvite: () => setInvite(null) };
}
