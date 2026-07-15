import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdateNotice } from "../lib/core/updateCheck";
import { recordDiagnosticEvent } from "../lib/platform/diagnostics";
import { checkForSignedUpdate, type SignedUpdateHandle } from "../lib/platform/signedUpdater";

export type UpdateInstallStatus = "idle" | "installing" | "failed";

export function useUpdateNotice() {
  const [notice, setNotice] = useState<UpdateNotice | null>(null);
  const [installStatus, setInstallStatus] = useState<UpdateInstallStatus>("idle");
  const handleRef = useRef<SignedUpdateHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkForSignedUpdate()
      .then(async (handle) => {
        if (cancelled) {
          await handle?.close();
          return;
        }
        handleRef.current = handle;
        setNotice(handle?.notice ?? null);
      })
      .catch((error) => {
        recordDiagnosticEvent("warn", "Update check failed", error);
      });
    return () => {
      cancelled = true;
      const handle = handleRef.current;
      handleRef.current = null;
      void handle?.close().catch((error) => {
        recordDiagnosticEvent("warn", "Updater resource cleanup failed", error);
      });
    };
  }, []);

  const install = useCallback(() => {
    const handle = handleRef.current;
    if (!handle || installStatus === "installing") return;
    setInstallStatus("installing");
    handle.install().catch((error) => {
      setInstallStatus("failed");
      recordDiagnosticEvent("error", "Signed update installation failed", error);
    });
  }, [installStatus]);

  return { notice, installStatus, install };
}
