import type {
  ApprovalDelegationPolicy,
  ApprovalPolicy,
  RoomRecord,
  RoomSettingsPlaintextPayload
} from "@multaiplayer/protocol";
import { useAppStore } from "../store/appStore";
import { chooseProjectFolder, shutdownCodexRoom } from "./localBackend";
import { updateRoomSettings } from "./workspaceClient";
import {
  maxCodexModelChars,
  maxRoomProjectPathChars,
  normalizeCodexModel,
  normalizeCodexReasoningEffort,
  normalizeCodexSandboxLevel,
  normalizeCodexSpeed,
  normalizeProjectPath,
  normalizeRoomName
} from "./workspaceCreation";
import { roomLockMessage } from "./appRuntime";
import { shouldApplyRoomScopedUiUpdate } from "./roomScopedUi";
import { omitRecordKey } from "./setUtils";
import { formatCodexModel, formatCodexReasoningEffort, formatCodexSandboxLevel, formatCodexSpeed } from "./appFormatters";

type CurrentRef<T> = { current: T };
type BusyMap = Record<string, boolean>;

interface CreateRoomSettingsActionsOptions {
  hasSelectedRoom: boolean;
  isSelectedRoomLocked: boolean;
  isSelectedRoomRevoked: boolean;
  isActiveHost: boolean;
  selectedRoom: RoomRecord;
  selectedRoomIdRef: CurrentRef<string>;
  settingsBusyRef: CurrentRef<BusyMap>;
  selectedCodexModel: string;
  selectedCodexReasoningEffort: string;
  selectedCodexSpeed: string;
  selectedCodexSandboxLevel: string;
  projectPathDraft: string;
  approvalPolicyLabels: Record<string, string>;
  roomSettingsGateMessage: string;
  roomSettingsActor: () => { requesterName: string; requesterUserId: string };
  reportRoomSettingsMutationInFlight: (
    roomId: string,
    setMessage?: (roomId: string, message: string | null) => void
  ) => boolean;
  replaceRoom: (room: RoomRecord) => void;
  publishRoomSettingsEvent: (
    room: RoomRecord,
    event: Omit<RoomSettingsPlaintextPayload, "eventType" | "changedBy" | "changedByUserId">
  ) => Promise<void>;
}

export function createRoomSettingsActions({
  hasSelectedRoom,
  isSelectedRoomLocked,
  isSelectedRoomRevoked,
  isActiveHost,
  selectedRoom,
  selectedRoomIdRef,
  settingsBusyRef,
  selectedCodexModel,
  selectedCodexReasoningEffort,
  selectedCodexSpeed,
  selectedCodexSandboxLevel,
  projectPathDraft,
  approvalPolicyLabels,
  roomSettingsGateMessage,
  roomSettingsActor,
  reportRoomSettingsMutationInFlight,
  replaceRoom,
  publishRoomSettingsEvent
}: CreateRoomSettingsActionsOptions) {
  const setSettingsBusyForRoom = (roomId: string, busy: boolean) => {
    if (busy) {
      settingsBusyRef.current = { ...settingsBusyRef.current, [roomId]: true };
    } else {
      settingsBusyRef.current = omitRecordKey(settingsBusyRef.current, roomId);
    }
    useAppStore.getState().setSettingsBusyForRoom(roomId, busy);
  };
  const setSelectedSettingsMessage = (message: string | null) =>
    useAppStore.getState().setSettingsMessageForRoom(selectedRoomIdRef.current, message);
  const setSettingsMessageForRoom = (roomId: string, message: string | null) =>
    useAppStore.getState().setSettingsMessageForRoom(roomId, message);
  const setSelectedBrowserMessage = (message: string | null) =>
    useAppStore.getState().setBrowserMessageForRoom(selectedRoomIdRef.current, message);
  const setBrowserMessageForRoom = (roomId: string, message: string | null) =>
    useAppStore.getState().setBrowserMessageForRoom(roomId, message);
  const clearBrowserStatusForRoom = (roomId: string) =>
    useAppStore.getState().clearBrowserStatusForRoom(roomId);
  const setProjectPathDraftForRoom = (roomId: string, path: string) =>
    useAppStore.getState().setProjectPathDraftForRoom(roomId, path, selectedRoom.projectPath);
  const resetCodexApprovalForRoom = (roomId: string) =>
    useAppStore.getState().resetCodexApprovalForRoom(roomId);
  const resetFileContextForRoom = (roomId: string) =>
    useAppStore.getState().resetFileContextForRoom(roomId);
  async function setApprovalPolicy(approvalPolicy: ApprovalPolicy) {
    if (!hasSelectedRoom) {
      setSelectedSettingsMessage("Create or join a room before changing room settings.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedSettingsMessage(roomSettingsGateMessage);
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousPolicy = selectedRoom.approvalPolicy;
      const room = await updateRoomSettings(roomId, { ...roomSettingsActor(), approvalPolicy });
      replaceRoom(room);
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "approvalPolicy",
        previousValue: previousPolicy,
        nextValue: approvalPolicy,
        changedAt: new Date().toISOString()
      });
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSettingsMessageForRoom(roomId, `Approval policy set to ${approvalPolicyLabels[approvalPolicy]}.`);
      }
      resetCodexApprovalForRoom(roomId);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function setApprovalDelegationPolicy(approvalDelegationPolicy: ApprovalDelegationPolicy) {
    if (!hasSelectedRoom) {
      setSelectedSettingsMessage("Create or join a room before changing room settings.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedSettingsMessage(roomSettingsGateMessage);
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousPolicy = selectedRoom.approvalDelegationPolicy;
      const room = await updateRoomSettings(roomId, { ...roomSettingsActor(), approvalDelegationPolicy });
      replaceRoom(room);
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "approvalDelegationPolicy",
        previousValue: previousPolicy,
        nextValue: approvalDelegationPolicy,
        changedAt: new Date().toISOString()
      });
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSettingsMessageForRoom(roomId, "Approval delegation updated.");
      }
      resetCodexApprovalForRoom(roomId);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function setCodexModel(codexModel: string) {
    const nextModel = normalizeCodexModel(codexModel);
    if (!nextModel) {
      setSelectedSettingsMessage(`Use a known Codex model or a model-like id up to ${maxCodexModelChars} characters.`);
      return;
    }
    if (nextModel === selectedCodexModel && selectedRoom.codexModelPolicy === "pinned") return;
    if (!hasSelectedRoom) {
      setSelectedSettingsMessage("Create or join a room before changing the Codex model.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedSettingsMessage(roomSettingsGateMessage);
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousModel = selectedCodexModel;
      const room = await updateRoomSettings(roomId, {
        ...roomSettingsActor(),
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
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function setCodexReasoningEffort(reasoningEffort: string) {
    const nextReasoningEffort = normalizeCodexReasoningEffort(reasoningEffort);
    if (!nextReasoningEffort) {
      setSelectedSettingsMessage("Choose a supported Codex reasoning level.");
      return;
    }
    if (
      nextReasoningEffort === selectedCodexReasoningEffort &&
      selectedRoom.codexReasoningEffortPolicy === "pinned"
    ) return;
    if (!hasSelectedRoom) {
      setSelectedSettingsMessage("Create or join a room before changing Codex reasoning.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedSettingsMessage(roomSettingsGateMessage);
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousValue = selectedCodexReasoningEffort;
      const room = await updateRoomSettings(roomId, {
        ...roomSettingsActor(),
        codexReasoningEffort: nextReasoningEffort as RoomRecord["codexReasoningEffort"],
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
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function setCodexSpeed(speed: string) {
    const nextSpeed = normalizeCodexSpeed(speed);
    if (!nextSpeed) {
      setSelectedSettingsMessage("Choose a supported Codex speed.");
      return;
    }
    if (nextSpeed === selectedCodexSpeed && selectedRoom.codexServiceTierPolicy === "pinned") return;
    if (!hasSelectedRoom) {
      setSelectedSettingsMessage("Create or join a room before changing Codex speed.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedSettingsMessage(roomSettingsGateMessage);
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousValue = selectedCodexSpeed;
      const room = await updateRoomSettings(roomId, {
        ...roomSettingsActor(),
        codexSpeed: nextSpeed as RoomRecord["codexSpeed"],
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
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function setCodexSandboxLevel(sandboxLevel: string) {
    const nextSandboxLevel = normalizeCodexSandboxLevel(sandboxLevel);
    if (!nextSandboxLevel) {
      setSelectedSettingsMessage("Choose a supported Codex sandbox level.");
      return;
    }
    if (nextSandboxLevel === selectedCodexSandboxLevel) return;
    if (!hasSelectedRoom) {
      setSelectedSettingsMessage("Create or join a room before changing the Codex sandbox.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedSettingsMessage(roomSettingsGateMessage);
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousValue = selectedCodexSandboxLevel;
      const room = await updateRoomSettings(roomId, {
        ...roomSettingsActor(),
        codexSandboxLevel: nextSandboxLevel as RoomRecord["codexSandboxLevel"]
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
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function renameRoom(name: string) {
    const nextName = normalizeRoomName(name);
    if (!nextName) {
      setSelectedSettingsMessage("Use a room title up to 160 characters without control characters.");
      return;
    }
    if (!hasSelectedRoom || nextName === selectedRoom.name) return;
    if (isSelectedRoomLocked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousName = selectedRoom.name;
      const room = await updateRoomSettings(roomId, { ...roomSettingsActor(), name: nextName });
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
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function setBrowserProfilePersistence(browserProfilePersistent: boolean) {
    if (!hasSelectedRoom) {
      setSelectedBrowserMessage("Create or join a room before changing browser profile persistence.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedBrowserMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedBrowserMessage(roomSettingsGateMessage);
      return;
    }
    if (browserProfilePersistent === selectedRoom.browserProfilePersistent) return;
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId, setBrowserMessageForRoom)) return;
    setSettingsBusyForRoom(roomId, true);
    setBrowserMessageForRoom(roomId, null);
    try {
      const previousPersistence = selectedRoom.browserProfilePersistent;
      const room = await updateRoomSettings(roomId, {
        ...roomSettingsActor(),
        browserProfilePersistent
      });
      replaceRoom(room);
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "browserProfilePersistent",
        previousValue: String(previousPersistence),
        nextValue: String(browserProfilePersistent),
        changedAt: new Date().toISOString()
      });
      if (!browserProfilePersistent) {
        clearBrowserStatusForRoom(roomId);
      }
      resetCodexApprovalForRoom(roomId);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setBrowserMessageForRoom(
          roomId,
          browserProfilePersistent
            ? "Browser profile persistence enabled for this room."
            : "Browser profile will refresh before each approved page opens."
        );
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setBrowserMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function updateProjectPath() {
    const nextProjectPath = normalizeProjectPath(projectPathDraft);
    if (!nextProjectPath) {
      setSelectedSettingsMessage(`Enter a local project folder up to ${maxRoomProjectPathChars} characters without control characters.`);
      return;
    }
    if (!hasSelectedRoom) {
      setSelectedSettingsMessage("Create or join a room before attaching a project folder.");
      return;
    }
    if (nextProjectPath === selectedRoom.projectPath) return;
    if (isSelectedRoomLocked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedSettingsMessage(roomSettingsGateMessage);
      return;
    }
    const roomId = selectedRoom.id;
    if (reportRoomSettingsMutationInFlight(roomId)) return;
    setSettingsBusyForRoom(roomId, true);
    setSettingsMessageForRoom(roomId, null);
    try {
      const previousProjectPath = selectedRoom.projectPath;
      const room = await updateRoomSettings(roomId, { ...roomSettingsActor(), projectPath: nextProjectPath });
      void shutdownCodexRoom(roomId);
      replaceRoom(room);
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "projectPath",
        previousValue: previousProjectPath,
        nextValue: nextProjectPath,
        changedAt: new Date().toISOString()
      });
      resetFileContextForRoom(roomId);
      resetCodexApprovalForRoom(roomId);
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSettingsMessageForRoom(roomId, `Project folder set to ${nextProjectPath}.`);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function chooseProjectPath() {
    if (!hasSelectedRoom) {
      setSelectedSettingsMessage("Create or join a room before choosing a project folder.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedSettingsMessage(roomSettingsGateMessage);
      return;
    }
    const roomId = selectedRoom.id;
    setSettingsMessageForRoom(roomId, null);
    try {
      const selectedPath = await chooseProjectFolder(projectPathDraft || selectedRoom.projectPath);
      if (!selectedPath) {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setSettingsMessageForRoom(roomId, "Native folder picker is available in the Tauri app. In web preview, paste a local folder path.");
        }
        return;
      }
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setProjectPathDraftForRoom(roomId, selectedPath);
        setSettingsMessageForRoom(roomId, `Selected project folder: ${selectedPath}`);
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    }
  }

  return {
    setApprovalPolicy,
    setApprovalDelegationPolicy,
    setCodexModel,
    setCodexReasoningEffort,
    setCodexSpeed,
    setCodexSandboxLevel,
    renameRoom,
    setBrowserProfilePersistence,
    updateProjectPath,
    chooseProjectPath
  };
}
