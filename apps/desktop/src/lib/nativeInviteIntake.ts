import { invokeNative } from "./nativeCommandError";
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
export async function installNativeInviteIntake(onInvite: InviteHandler, signal?: AbortSignal): Promise<UnlistenFn> {
  return createNativeInviteIntake(
    { invoke: invokeNative, listen: (event, handler) => listen(event, handler) },
    onInvite,
    signal
  );
}

export async function createNativeInviteIntake(
  bindings: NativeInviteBindings,
  onInvite: InviteHandler,
  signal?: AbortSignal
): Promise<UnlistenFn> {
  let disposed = false;
  let drainRequested = false;
  let draining = false;
  const listener: { stop?: UnlistenFn } = {};

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    listener.stop?.();
  };
  signal?.addEventListener("abort", dispose, { once: true });

  const drain = async () => {
    drainRequested = true;
    if (draining || disposed || signal?.aborted) return;
    draining = true;
    try {
      while (drainRequested && !disposed && !signal?.aborted) {
        drainRequested = false;
        if (disposed || signal?.aborted) return;
        const invite = await bindings.invoke<NativeInvitePayload | null>("take_pending_native_invite");
        if (invite && !disposed && !signal?.aborted) await onInvite(invite);
      }
    } finally {
      draining = false;
      if (drainRequested && !disposed && !signal?.aborted) void drain();
    }
  };

  listener.stop = await bindings.listen("native-invite://available", () => void drain());
  if (disposed || signal?.aborted) {
    if (disposed) listener.stop();
    else dispose();
    return () => undefined;
  }
  await drain();
  return dispose;
}
