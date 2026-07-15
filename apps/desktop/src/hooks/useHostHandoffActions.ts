import { createHostHandoffActions } from "../application/handoff/hostHandoffActions";
import type { UseHostHandoffActionsOptions } from "../application/handoff/hostHandoffActionTypes";
import { publishRoomConfigSnapshot } from "../application/mls/roomConfigSnapshot";
import { useAppStore } from "../store/appStore";
import { useFinalizeIncomingHostHandoff } from "./useFinalizeIncomingHostHandoff";

/** Binds React-owned room state to the framework-independent host-transfer application service. */
export function useHostHandoffActions(options: UseHostHandoffActionsOptions) {
  const markHostHandoffAcceptedForRoom = useAppStore((state) => state.markHostHandoffAcceptedForRoom);
  const markLatestHostHandoffAcceptedForRoom = useAppStore((state) => state.markLatestHostHandoffAcceptedForRoom);
  const markHostHandoffPatchAppliedForRoom = useAppStore((state) => state.markHostHandoffPatchAppliedForRoom);
  const setCodexContinuationForRoom = useAppStore((state) => state.setCodexContinuationForRoom);

  useFinalizeIncomingHostHandoff({
    room: options.selectedRoom,
    handoffs: options.hostHandoffs,
    localUserId: options.localUser.id,
    deviceId: options.deviceId,
    roomSettingsActor: options.roomSettingsActor,
    replaceRoom: options.replaceRoom,
    setHostMessage: options.setHostMessageForRoom,
    setSettingsMessage: options.setSettingsMessageForRoom,
    setProjectPathDraft: options.setProjectPathDraftForRoom,
    setCustomCodexModel: options.setCustomCodexModelForRoom,
    resetFileContext: options.resetFileContextForRoom,
    resetCodexApproval: options.resetCodexApprovalForRoom,
    publishConfig: async (room) => {
      const client = options.relayRef.current;
      if (!client) throw new Error("Relay is unavailable for the encrypted room configuration snapshot.");
      await publishRoomConfigSnapshot({
        client,
        room,
        senderUserId: options.localUser.id,
        senderDeviceId: options.deviceId,
        seenEnvelopeIds: options.seenEnvelopeIds.current,
        incrementRevision: true
      });
    }
  });

  return createHostHandoffActions(options, {
    markHostHandoffAcceptedForRoom,
    markLatestHostHandoffAcceptedForRoom,
    markHostHandoffPatchAppliedForRoom,
    setCodexContinuationForRoom
  });
}
