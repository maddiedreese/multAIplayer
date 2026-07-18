import { useCallback, useMemo, useState } from "react";
import type { SignedInUser } from "../lib/identity/authClient";
import { loadOrCreateDeviceId, saveDeviceId } from "../application/runtime/appRuntime";
import { trustedAvatarUrl } from "../lib/core/avatarUrl";

export function useLocalIdentity(currentUser: SignedInUser | null) {
  const [deviceId, setDeviceId] = useState(loadOrCreateDeviceId);
  const replaceDeviceId = useCallback((nextDeviceId: string) => {
    saveDeviceId(nextDeviceId);
    setDeviceId(nextDeviceId);
  }, []);
  const localUser = useMemo(() => {
    const avatarUrl = trustedAvatarUrl(currentUser?.avatarUrl);
    return {
      id: currentUser?.id ?? `local:${deviceId}`,
      name: currentUser?.name ?? currentUser?.login ?? "Local user",
      ...(avatarUrl ? { avatarUrl } : {})
    };
  }, [currentUser, deviceId]);

  return { deviceId, localUser, replaceDeviceId };
}
