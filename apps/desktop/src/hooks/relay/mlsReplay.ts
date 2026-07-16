import type { MlsRelayMessage } from "@multaiplayer/protocol";

/**
 * A sender's persisted native MLS state already consumed its own ciphertext.
 * Replaying that ciphertext after a UI refresh is invalid, but authenticated
 * host-handoff projection still has local work to recover from a committed
 * self-authored envelope.
 */
export async function handleExactLocalMlsReplay(
  message: MlsRelayMessage,
  identity: { userId: string; deviceId: string },
  recoverHostHandoff: (message: MlsRelayMessage) => void | Promise<void>
): Promise<boolean> {
  if (message.senderUserId !== identity.userId || message.senderDeviceId !== identity.deviceId) return false;
  if (message.messageType === "commit" && message.commitEffect === "host_handoff") {
    await recoverHostHandoff(message);
  }
  return true;
}
