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
import { currentSelectedRoom, currentSelectedRoomContext } from "./selectedWorkspace";
import { defaultCodexReasoningEffort, defaultCodexSandboxLevel, defaultCodexSpeed } from "@multaiplayer/protocol";

type CurrentRef<T> = { current: T };
type BusyMap = Record<string, boolean>;

interface CreateRoomSettingsActionsOptions {
  selectedRoomIdRef: CurrentRef<string>;
  settingsBusyRef: CurrentRef<BusyMap>;
  approvalPolicyLabels: Record<string, string>;
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
  selectedRoomIdRef,
  settingsBusyRef,
  approvalPolicyLabels,
  reportRoomSettingsMutationInFlight,
  replaceRoom,
  publishRoomSettingsEvent
}: CreateRoomSettingsActionsOptions) {
  const isCurrentUserActiveHost = () => currentSelectedRoomContext()?.isActiveHost ?? false;
  const currentRoomSettingsGateMessage = () => currentSelectedRoomContext()?.roomSettingsGateMessage ?? "Claim host before changing room host settings.";
  const currentRoomSettingsActor = () => {
    const localUser = currentSelectedRoomContext()?.localUser;
    return { requesterName: localUser?.name ?? "Local user", requesterUserId: localUser?.id ?? "local" };
  };
  const currentRoomAccess = (selectedRoom: RoomRecord) => {
    const store = useAppStore.getState();
    const revoked = store.revokedRoomIds.has(selectedRoom.id) || store.revokedTeamIds.has(selectedRoom.teamId);
    return {
      revoked,
      locked: selectedRoom.archivedAt != null || store.forgottenRoomIds.has(selectedRoom.id) || revoked
    };
  };
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
    useAppStore.getState().setProjectPathDraftForRoom(roomId, path, currentSelectedRoom()?.projectPath ?? "");
  const resetCodexApprovalForRoom = (roomId: string) =>
    useAppStore.getState().resetCodexApprovalForRoom(roomId);
  const resetFileContextForRoom = (roomId: string) =>
    useAppStore.getState().resetFileContextForRoom(roomId);
  async function setApprovalPolicy(approvalPolicy: ApprovalPolicy) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      setSelectedSettingsMessage("Create or join a room before changing room settings.");
      return;
    }
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
      const previousPolicy = selectedRoom.approvalPolicy;
      const room = await updateRoomSettings(roomId, { ...currentRoomSettingsActor(), approvalPolicy });
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
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      setSelectedSettingsMessage("Create or join a room before changing room settings.");
      return;
    }
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
      const previousPolicy = selectedRoom.approvalDelegationPolicy;
      const room = await updateRoomSettings(roomId, { ...currentRoomSettingsActor(), approvalDelegationPolicy });
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
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) return;
    const selectedCodexModel = useAppStore.getState().roomSettingsByRoom[selectedRoom.id]?.customCodexModel ?? selectedRoom.codexModel;
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
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
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
    if (
      nextReasoningEffort === selectedCodexReasoningEffort &&
      selectedRoom.codexReasoningEffortPolicy === "pinned"
    ) return;
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
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setSettingsMessageForRoom(roomId, String(error));
    } finally {
      setSettingsBusyForRoom(roomId, false);
    }
  }

  async function setBrowserProfilePersistence(browserProfilePersistent: boolean) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) return;
    if (currentRoomAccess(selectedRoom).locked) {
      setSelectedBrowserMessage(roomLockMessage(selectedRoom, currentRoomAccess(selectedRoom).revoked));
      return;
    }
    if (!isCurrentUserActiveHost()) {
      setSelectedBrowserMessage(currentRoomSettingsGateMessage());
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
        ...currentRoomSettingsActor(),
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
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) return;
    const projectPathDraft = useAppStore.getState().roomSettingsByRoom[selectedRoom.id]?.projectPathDraft ?? selectedRoom.projectPath;
    const nextProjectPath = normalizeProjectPath(projectPathDraft);
    if (!nextProjectPath) {
      setSelectedSettingsMessage(`Enter a local project folder up to ${maxRoomProjectPathChars} characters without control characters.`);
      return;
    }
    if (nextProjectPath === selectedRoom.projectPath) return;
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
      const previousProjectPath = selectedRoom.projectPath;
      const room = await updateRoomSettings(roomId, { ...currentRoomSettingsActor(), projectPath: nextProjectPath });
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
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) return;
    const projectPathDraft = useAppStore.getState().roomSettingsByRoom[selectedRoom.id]?.projectPathDraft ?? selectedRoom.projectPath;
    if (currentRoomAccess(selectedRoom).locked) {
      setSelectedSettingsMessage(roomLockMessage(selectedRoom, currentRoomAccess(selectedRoom).revoked));
      return;
    }
    if (!isCurrentUserActiveHost()) {
      setSelectedSettingsMessage(currentRoomSettingsGateMessage());
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
