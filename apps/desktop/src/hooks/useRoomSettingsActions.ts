import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  ApprovalDelegationPolicy,
  ApprovalPolicy,
  RoomMode,
  RoomRecord,
  RoomSettingsPlaintextPayload
} from "@multaiplayer/protocol";
import { chooseProjectFolder } from "../lib/localBackend";
import { updateRoomSettings } from "../lib/workspaceClient";
import { ensureRoomDefaults } from "../lib/roomDefaults";
import {
  maxCodexModelChars,
  maxRoomProjectPathChars,
  normalizeCodexModel,
  normalizeProjectPath,
  normalizeRoomName
} from "../lib/workspaceCreation";
import { shouldResetCodexApprovalForRoomModeChange } from "../lib/codexApproval";
import { roomLockMessage } from "../lib/appRuntime";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import { formatCodexModel } from "../lib/appFormatters";

interface UseRoomSettingsActionsOptions {
  hasSelectedRoom: boolean;
  isSelectedRoomLocked: boolean;
  isSelectedRoomRevoked: boolean;
  isActiveHost: boolean;
  selectedRoom: RoomRecord;
  selectedRoomIdRef: MutableRefObject<string>;
  selectedCodexModel: string;
  projectPathDraft: string;
  approvalPolicyLabels: Record<string, string>;
  roomModeLabels: Record<keyof RoomMode, string>;
  roomSettingsGateMessage: string;
  roomSettingsActor: () => { requesterName: string; requesterUserId: string };
  reportRoomSettingsMutationInFlight: (
    roomId: string,
    setMessage?: (roomId: string, message: string | null) => void
  ) => boolean;
  setSettingsBusyForRoom: (roomId: string, busy: boolean) => void;
  setSelectedSettingsMessage: (message: string | null) => void;
  setSettingsMessageForRoom: (roomId: string, message: string | null) => void;
  setSelectedBrowserMessage: (message: string | null) => void;
  setBrowserMessageForRoom: (roomId: string, message: string | null) => void;
  setRooms: Dispatch<SetStateAction<RoomRecord[]>>;
  clearBrowserStatusForRoom: (roomId: string) => void;
  setProjectPathDraftForRoom: (roomId: string, path: string) => void;
  resetCodexApprovalForRoom: (roomId: string) => void;
  resetFileContextForRoom: (roomId: string) => void;
  publishRoomSettingsEvent: (
    room: RoomRecord,
    event: Omit<RoomSettingsPlaintextPayload, "eventType" | "changedBy" | "changedByUserId">
  ) => Promise<void>;
}

export function useRoomSettingsActions({
  hasSelectedRoom,
  isSelectedRoomLocked,
  isSelectedRoomRevoked,
  isActiveHost,
  selectedRoom,
  selectedRoomIdRef,
  selectedCodexModel,
  projectPathDraft,
  approvalPolicyLabels,
  roomModeLabels,
  roomSettingsGateMessage,
  roomSettingsActor,
  reportRoomSettingsMutationInFlight,
  setSettingsBusyForRoom,
  setSelectedSettingsMessage,
  setSettingsMessageForRoom,
  setSelectedBrowserMessage,
  setBrowserMessageForRoom,
  setRooms,
  clearBrowserStatusForRoom,
  setProjectPathDraftForRoom,
  resetCodexApprovalForRoom,
  resetFileContextForRoom,
  publishRoomSettingsEvent
}: UseRoomSettingsActionsOptions) {
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
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
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
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
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

  async function toggleRoomMode(key: keyof RoomMode) {
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
      const nextMode: RoomMode = {
        ...selectedRoom.mode,
        [key]: !selectedRoom.mode[key]
      };
      const previousValue = `${key}:${selectedRoom.mode[key] ? "enabled" : "disabled"}`;
      const nextValue = `${key}:${nextMode[key] ? "enabled" : "disabled"}`;
      const room = await updateRoomSettings(roomId, { ...roomSettingsActor(), mode: nextMode });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
      await publishRoomSettingsEvent(room, {
        id: crypto.randomUUID(),
        setting: "roomMode",
        previousValue,
        nextValue,
        changedAt: new Date().toISOString()
      });
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setSettingsMessageForRoom(roomId, `${roomModeLabels[key]} mode ${nextMode[key] ? "enabled" : "disabled"}.`);
      }
      if (shouldResetCodexApprovalForRoomModeChange(key)) {
        resetCodexApprovalForRoom(roomId);
      }
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
    if (nextModel === selectedCodexModel) return;
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
      const room = await updateRoomSettings(roomId, { ...roomSettingsActor(), codexModel: nextModel });
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
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
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
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
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
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
      setRooms((current) => current.map((item) => (item.id === room.id ? ensureRoomDefaults(room) : item)));
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
    toggleRoomMode,
    setCodexModel,
    renameRoom,
    setBrowserProfilePersistence,
    updateProjectPath,
    chooseProjectPath
  };
}
