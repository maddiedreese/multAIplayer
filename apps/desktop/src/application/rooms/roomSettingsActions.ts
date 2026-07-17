import type { ClientRoomRecord, RoomSettingsPlaintextPayload } from "@multaiplayer/protocol";
import { useAppStore } from "../../store/appStore";
import { shutdownCodexRoom } from "../../lib/platform/localBackend";
import { updateRoomSettings } from "../workspace/workspaceClient";
import {
  maxCodexModelChars,
  normalizeCodexModel,
  normalizeCodexReasoningEffort,
  normalizeCodexSandboxLevel,
  normalizeCodexSpeed,
  normalizeRoomName
} from "../../lib/workspace/workspaceCreation";
import { roomLockMessage } from "../runtime/appRuntime";
import { shouldApplyRoomScopedUiUpdate } from "../../lib/room/roomScopedUi";
import {
  formatCodexModel,
  formatCodexReasoningEffort,
  formatCodexSandboxLevel,
  formatCodexSpeed
} from "../../lib/formatting/appFormatters";
import { currentSelectedRoom } from "../workspace/selectedWorkspace";
import { createRoomSettingsMutationContext } from "./roomSettingsMutationContext";
import { createRoomProjectSettingsActions } from "./roomProjectSettingsActions";
import { createRoomApprovalSettingsActions } from "./roomApprovalSettingsActions";
import { updateCodexRawReasoningSetting } from "./roomRawReasoningSettingsAction";
import { defaultCodexReasoningEffort, defaultCodexSandboxLevel, defaultCodexSpeed } from "@multaiplayer/protocol";

type CurrentRef<T> = { current: T };
type BusyMap = Record<string, boolean>;

export interface CreateRoomSettingsActionsOptions {
  selectedRoomIdRef: CurrentRef<string | null>;
  settingsBusyRef: CurrentRef<BusyMap>;
  approvalPolicyLabels: Record<string, string>;
  reportRoomSettingsMutationInFlight: (
    roomId: string,
    setMessage?: (roomId: string, message: string | null) => void
  ) => boolean;
  replaceRoom: (room: ClientRoomRecord) => void;
  publishRoomSettingsEvent: (
    room: ClientRoomRecord,
    event: Omit<RoomSettingsPlaintextPayload, "eventType" | "changedBy" | "changedByUserId">
  ) => Promise<void>;
}

export function createRoomSettingsActions({
  selectedRoomIdRef,
  settingsBusyRef,
  approvalPolicyLabels,
  reportRoomSettingsMutationInFlight,
  replaceRoom,
  publishRoomSettingsEvent
}: CreateRoomSettingsActionsOptions) {
  const mutationContext = createRoomSettingsMutationContext(selectedRoomIdRef, settingsBusyRef);
  const {
    isCurrentUserActiveHost,
    currentRoomSettingsGateMessage,
    currentRoomSettingsActor,
    currentRoomAccess,
    setSettingsBusyForRoom,
    setSelectedSettingsMessage,
    setSettingsMessageForRoom,
    resetCodexApprovalForRoom
  } = mutationContext;
  const { setApprovalPolicy } = createRoomApprovalSettingsActions({
    selectedRoomId: () => selectedRoomIdRef.current,
    approvalPolicyLabels,
    reportInFlight: reportRoomSettingsMutationInFlight,
    replaceRoom,
    publishEvent: publishRoomSettingsEvent,
    context: mutationContext
  });

  async function setCodexModel(codexModel: string) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) return;
    const selectedCodexModel =
      useAppStore.getState().roomSettingsByRoom[selectedRoom.id]?.customCodexModel ?? selectedRoom.codexModel;
    const nextModel = normalizeCodexModel(codexModel);
    if (!nextModel) {
      setSelectedSettingsMessage(`Use a known Codex model or a model-like id up to ${maxCodexModelChars} characters.`);
      return;
    }
    if (nextModel === selectedCodexModel && selectedRoom.codexModelPolicy === "pinned") return;
    if (currentRoomAccess(selectedRoom).locked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, currentRoomAccess(selectedRoom).revoked));
      return;
    }
    if (!isCurrentUserActiveHost()) {
      setSelectedSettingsMessage(currentRoomSettingsGateMessage());
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousModel = selectedCodexModel;
      const room = await updateRoomSettings(roomId, {
        ...currentRoomSettingsActor(),
        codexModel: nextModel,
        codexModelPolicy: "pinned"
      });
      void shutdownCodexRoom(roomId);
      replaceRoom(room);
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "codexModel",
        previousValue: previousModel,
        nextValue: nextModel,
        changedAt: new Date().toISOString()
      });
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSettingsMessageForRoom(roomId, `Codex model set to ${formatCodexModel(nextModel)}.`);
      }
      resetCodexApprovalForRoom(roomId);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId))
        setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function setCodexReasoningEffort(reasoningEffort: string) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) return;
    const selectedCodexReasoningEffort = selectedRoom.codexReasoningEffort ?? defaultCodexReasoningEffort;
    const nextReasoningEffort = normalizeCodexReasoningEffort(reasoningEffort);
    if (!nextReasoningEffort) {
      setSelectedSettingsMessage("Choose a supported Codex reasoning level.");
      return;
    }
    if (nextReasoningEffort === selectedCodexReasoningEffort && selectedRoom.codexReasoningEffortPolicy === "pinned")
      return;
    if (currentRoomAccess(selectedRoom).locked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, currentRoomAccess(selectedRoom).revoked));
      return;
    }
    if (!isCurrentUserActiveHost()) {
      setSelectedSettingsMessage(currentRoomSettingsGateMessage());
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousValue = selectedCodexReasoningEffort;
      const room = await updateRoomSettings(roomId, {
        ...currentRoomSettingsActor(),
        codexReasoningEffort: nextReasoningEffort as ClientRoomRecord["codexReasoningEffort"],
        codexReasoningEffortPolicy: "pinned"
      });
      void shutdownCodexRoom(roomId);
      replaceRoom(room);
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "codexReasoningEffort",
        previousValue,
        nextValue: nextReasoningEffort,
        changedAt: new Date().toISOString()
      });
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSettingsMessageForRoom(roomId, `Codex reasoning set to ${formatCodexReasoningEffort(nextReasoningEffort)}.`);
      }
      resetCodexApprovalForRoom(roomId);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId))
        setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function setCodexSpeed(speed: string) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) return;
    const selectedCodexSpeed = selectedRoom.codexSpeed ?? defaultCodexSpeed;
    const nextSpeed = normalizeCodexSpeed(speed);
    if (!nextSpeed) {
      setSelectedSettingsMessage("Choose a supported Codex speed.");
      return;
    }
    if (nextSpeed === selectedCodexSpeed && selectedRoom.codexServiceTierPolicy === "pinned") return;
    if (currentRoomAccess(selectedRoom).locked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, currentRoomAccess(selectedRoom).revoked));
      return;
    }
    if (!isCurrentUserActiveHost()) {
      setSelectedSettingsMessage(currentRoomSettingsGateMessage());
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousValue = selectedCodexSpeed;
      const room = await updateRoomSettings(roomId, {
        ...currentRoomSettingsActor(),
        codexSpeed: nextSpeed as ClientRoomRecord["codexSpeed"],
        codexServiceTierPolicy: "pinned"
      });
      void shutdownCodexRoom(roomId);
      replaceRoom(room);
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "codexSpeed",
        previousValue,
        nextValue: nextSpeed,
        changedAt: new Date().toISOString()
      });
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSettingsMessageForRoom(roomId, `Codex speed set to ${formatCodexSpeed(nextSpeed)}.`);
      }
      resetCodexApprovalForRoom(roomId);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId))
        setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  const setCodexRawReasoningEnabled = (enabled: boolean) =>
    updateCodexRawReasoningSetting(enabled, {
      selectedRoomId: () => selectedRoomIdRef.current,
      reportInFlight: reportRoomSettingsMutationInFlight,
      replaceRoom,
      publishEvent: publishRoomSettingsEvent,
      context: mutationContext
    });

  async function setCodexSandboxLevel(sandboxLevel: string) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) return;
    const selectedCodexSandboxLevel = selectedRoom.codexSandboxLevel ?? defaultCodexSandboxLevel;
    const nextSandboxLevel = normalizeCodexSandboxLevel(sandboxLevel);
    if (!nextSandboxLevel) {
      setSelectedSettingsMessage("Choose a supported Codex sandbox level.");
      return;
    }
    if (nextSandboxLevel === selectedCodexSandboxLevel) return;
    if (currentRoomAccess(selectedRoom).locked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, currentRoomAccess(selectedRoom).revoked));
      return;
    }
    if (!isCurrentUserActiveHost()) {
      setSelectedSettingsMessage(currentRoomSettingsGateMessage());
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousValue = selectedCodexSandboxLevel;
      const room = await updateRoomSettings(roomId, {
        ...currentRoomSettingsActor(),
        codexSandboxLevel: nextSandboxLevel as ClientRoomRecord["codexSandboxLevel"]
      });
      void shutdownCodexRoom(roomId);
      replaceRoom(room);
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "codexSandboxLevel",
        previousValue,
        nextValue: nextSandboxLevel,
        changedAt: new Date().toISOString()
      });
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSettingsMessageForRoom(roomId, `Codex sandbox set to ${formatCodexSandboxLevel(nextSandboxLevel)}.`);
      }
      resetCodexApprovalForRoom(roomId);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId))
        setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function renameRoom(name: string) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) return;
    const nextName = normalizeRoomName(name);
    if (!nextName) {
      setSelectedSettingsMessage("Use a room title up to 160 characters without control characters.");
      return;
    }
    if (nextName === selectedRoom.name) return;
    if (currentRoomAccess(selectedRoom).locked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, currentRoomAccess(selectedRoom).revoked));
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousName = selectedRoom.name;
      const room = await updateRoomSettings(roomId, { ...currentRoomSettingsActor(), name: nextName });
      replaceRoom(room);
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "roomName",
        previousValue: previousName,
        nextValue: nextName,
        changedAt: new Date().toISOString()
      });
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSettingsMessageForRoom(roomId, `Room title changed to ${nextName}.`);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId))
        setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  const { updateProjectPath, chooseProjectPath } = createRoomProjectSettingsActions({
    selectedRoomId: () => selectedRoomIdRef.current,
    reportInFlight: reportRoomSettingsMutationInFlight,
    replaceRoom,
    publishEvent: publishRoomSettingsEvent,
    context: mutationContext
  });

  return {
    setApprovalPolicy,
    setCodexModel,
    setCodexReasoningEffort,
    setCodexRawReasoningEnabled,
    setCodexSpeed,
    setCodexSandboxLevel,
    renameRoom,
    updateProjectPath,
    chooseProjectPath
  };
}
