import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdateNotice } from "../lib/core/updateCheck";
import { recordDiagnosticEvent } from "../lib/platform/diagnostics";
import { checkForSignedUpdate, type SignedUpdateHandle } from "../lib/platform/signedUpdater";

export type UpdateInstallStatus = "idle" | "installing" | "failed";
export type UpdateCheckStatus = "checking" | "up-to-date" | "available" | "unverified";

export function useUpdateNotice() {
  const [notice, setNotice] = useState<UpdateNotice | null>(null);
  const [installStatus, setInstallStatus] = useState<UpdateInstallStatus>("idle");
  const [checkStatus, setCheckStatus] = useState<UpdateCheckStatus>("checking");
  const handleRef = useRef<SignedUpdateHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkForSignedUpdate()
      .then(async (result) => {
        if (cancelled) {
          if (result.status === "available") await result.handle.close();
          return;
        }
        if (result.status !== "available") {
          setCheckStatus(result.status);
          return;
        }
        const handle = result.handle;
        handleRef.current = handle;
        setNotice(handle.notice);
        setCheckStatus("available");
      })
      .catch((error) => {
        if (!cancelled) setCheckStatus("unverified");
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

  return { notice, checkStatus, installStatus, install };
}
