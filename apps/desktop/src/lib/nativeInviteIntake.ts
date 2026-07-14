import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface NativeInvitePayload {
  inviteId: string;
  encodedInvite: string;
}

type InviteHandler = (invite: NativeInvitePayload) => void | Promise<void>;
interface NativeInviteBindings {
  invoke: <T>(command: string) => Promise<T>;
  listen: (event: string, handler: () => void) => Promise<UnlistenFn>;
}

/**
 * Subscribe before draining the one-shot native slot so both cold-start and
 * already-running universal links converge on the same ephemeral callback.
 * The event carries no URL or capability.
 */
export async function installNativeInviteIntake(onInvite: InviteHandler): Promise<UnlistenFn> {
  return createNativeInviteIntake({ invoke, listen: (event, handler) => listen(event, handler) }, onInvite);
}

export async function createNativeInviteIntake(
  bindings: NativeInviteBindings,
  onInvite: InviteHandler
): Promise<UnlistenFn> {
  let disposed = false;
  let drainRequested = false;
  let draining = false;

  const drain = async () => {
    drainRequested = true;
    if (draining || disposed) return;
    draining = true;
    try {
      while (drainRequested && !disposed) {
        drainRequested = false;
        const invite = await bindings.invoke<NativeInvitePayload | null>("take_pending_native_invite");
        if (invite && !disposed) await onInvite(invite);
      }
    } finally {
      draining = false;
      if (drainRequested && !disposed) void drain();
    }
  };

  const unlisten = await bindings.listen("native-invite://available", () => void drain());
  await drain();
  return () => {
    disposed = true;
    unlisten();
  };
}
