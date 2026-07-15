import { useMemo } from "react";
import type { SignedInUser } from "../lib/identity/authClient";
import { loadOrCreateDeviceId } from "../application/runtime/appRuntime";
import { trustedAvatarUrl } from "../lib/core/avatarUrl";

export function useLocalIdentity(currentUser: SignedInUser | null) {
  const deviceId = useMemo(() => loadOrCreateDeviceId(), []);
  const localUser = useMemo(
    () => ({
      id: currentUser?.id ?? `local:${deviceId}`,
      name: currentUser?.name ?? currentUser?.login ?? "Local user",
      avatarUrl: trustedAvatarUrl(currentUser?.avatarUrl)
    }),
    [currentUser, deviceId]
  );

  return { deviceId, localUser };
}
