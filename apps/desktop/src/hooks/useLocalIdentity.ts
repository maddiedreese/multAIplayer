import { useMemo } from "react";
import type { SignedInUser } from "../lib/authClient";
import { loadOrCreateDeviceId } from "../lib/appRuntime";
import { fallbackUser } from "../seedData";

export function useLocalIdentity(currentUser: SignedInUser | null) {
  const deviceId = useMemo(() => loadOrCreateDeviceId(), []);
  const localUser = useMemo(
    () => ({
      id: currentUser?.id ?? fallbackUser.id,
      name: currentUser?.name ?? currentUser?.login ?? fallbackUser.name,
      avatarUrl: currentUser?.avatarUrl
    }),
    [currentUser]
  );

  return { deviceId, localUser };
}
