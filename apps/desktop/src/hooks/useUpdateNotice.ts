import { useEffect, useState } from "react";
import { fetchUpdateNotice, type UpdateNotice } from "../lib/updateCheck";
import { recordDiagnosticEvent } from "../lib/diagnostics";

export function useUpdateNotice() {
  const [notice, setNotice] = useState<UpdateNotice | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchUpdateNotice()
      .then((nextNotice) => {
        if (!cancelled) setNotice(nextNotice);
      })
      .catch((error) => {
        recordDiagnosticEvent("warn", "Update check failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return notice;
}
