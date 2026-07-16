import { useEffect, useRef } from "react";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { shutdownCodexRoom } from "../lib/platform/localBackend";
import { createHandoffSettingsPatch } from "../lib/handoff/hostHandoff";
import { updateRoomSettings } from "../application/workspace/workspaceClient";
import { useAppStore } from "../store/appStore";
import type { HostHandoffRecord } from "../types";
import { buildAcceptedHandoffMessage, resolveHandoffProject } from "../application/handoff/hostHandoffProject";

interface Options {
  room: ClientRoomRecord | null;
  handoffs: HostHandoffRecord[];
  localUserId: string;
  deviceId: string;
  roomSettingsActor: () => { requesterName: string; requesterUserId: string };
  replaceRoom: (room: ClientRoomRecord) => void;
  setHostMessage: (roomId: string, message: string) => void;
  setSettingsMessage: (roomId: string, message: string) => void;
  setProjectPathDraft: (roomId: string, path: string) => void;
  setCustomCodexModel: (roomId: string, model: string) => void;
  resetFileContext: (roomId: string) => void;
  resetCodexApproval: (roomId: string) => void;
  publishConfig: (room: ClientRoomRecord) => Promise<void>;
}

export function useFinalizeIncomingHostHandoff(options: Options): void {
  const finalized = useRef(new Set<string>());
  const latest = useRef(options);
  latest.current = options;
  const setContinuation = useAppStore((state) => state.setCodexContinuationForRoom);
  const authorityVersion = options.room
    ? `${options.room.id}:${options.room.hostStatus}:${options.room.hostUserId ?? ""}:${options.room.activeHostDeviceId ?? ""}:${options.localUserId}:${options.deviceId}`
    : "no-room";
  const handoffVersion = options.handoffs.map((handoff) => `${handoff.id}:${handoff.status}`).join("|");

  useEffect(() => {
    void authorityVersion;
    void handoffVersion;
    const current = latest.current;
    const { room } = current;
    if (!room) return;
    if (
      room.hostStatus !== "active" ||
      room.hostUserId !== current.localUserId ||
      room.activeHostDeviceId !== current.deviceId
    )
      return;
    const handoff = [...current.handoffs]
      .reverse()
      .find((candidate) => candidate.status === "accepted" && candidate.acceptedByUserId === current.localUserId);
    if (!handoff || finalized.current.has(handoff.id)) return;
    finalized.current.add(handoff.id);
    void finalize(current, handoff, setContinuation).catch((error) => {
      finalized.current.delete(handoff.id);
      current.setHostMessage(room.id, `Host authority transferred, but local context setup failed: ${String(error)}`);
    });
  }, [authorityVersion, handoffVersion, setContinuation]);
}

async function finalize(
  options: Options,
  handoff: HostHandoffRecord,
  setContinuation: (roomId: string, handoff: HostHandoffRecord | null) => void
): Promise<void> {
  if (!options.room) return;
  const patch = createHandoffSettingsPatch(handoff);
  const project = await resolveHandoffProject(handoff, options.room.projectPath);
  const updated = await updateRoomSettings(options.room.id, {
    ...options.roomSettingsActor(),
    ...patch,
    projectPath: project.path
  });
  void shutdownCodexRoom(options.room.id);
  options.replaceRoom(updated);
  await options.publishConfig(updated);
  setContinuation(
    options.room.id,
    handoff.reason === "usage_limit" || (handoff.gitPatch && !handoff.patchAppliedLocally) ? handoff : null
  );
  options.resetFileContext(options.room.id);
  options.resetCodexApproval(options.room.id);
  options.setProjectPathDraft(options.room.id, project.path);
  options.setCustomCodexModel(options.room.id, patch.codexModel);
  options.setSettingsMessage(options.room.id, buildAcceptedHandoffMessage(handoff, project, patch.codexModel));
  options.setHostMessage(
    options.room.id,
    handoff.gitPatch && !handoff.patchAppliedLocally
      ? `You are now hosting ${updated.name}. The previous host's patch is staged for explicit review and approval.`
      : `You are now hosting ${updated.name} from ${handoff.fromHost}'s handoff.`
  );
}
