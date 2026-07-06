import { useState } from "react";
import type {
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload
} from "@multaiplayer/protocol";
import type { InspectorTab } from "../components/RoomInspectorPanel";
import type { HostHandoffRecord, RoomPresence } from "../types";

export function useRoomRuntimeState() {
  const [inspectorTabsByRoom, setInspectorTabsByRoom] = useState<Record<string, InspectorTab>>({});
  const [forgottenRoomIds, setForgottenRoomIds] = useState<Set<string>>(() => new Set());
  const [revokedRoomIds, setRevokedRoomIds] = useState<Set<string>>(() => new Set());
  const [revokedTeamIds, setRevokedTeamIds] = useState<Set<string>>(() => new Set());
  const [presenceByRoom, setPresenceByRoom] = useState<Record<string, Record<string, RoomPresence>>>({});
  const [hostHandoffsByRoom, setHostHandoffsByRoom] = useState<Record<string, HostHandoffRecord[]>>({});
  const [codexContinuationByRoom, setCodexContinuationByRoom] = useState<Record<string, HostHandoffRecord>>({});
  const [gitWorkflowEventsByRoom, setGitWorkflowEventsByRoom] = useState<Record<string, GitWorkflowEventPlaintextPayload[]>>({});
  const [githubActionsEventsByRoom, setGitHubActionsEventsByRoom] = useState<Record<string, GitHubActionsEventPlaintextPayload[]>>({});

  return {
    inspectorTabsByRoom,
    setInspectorTabsByRoom,
    forgottenRoomIds,
    setForgottenRoomIds,
    revokedRoomIds,
    setRevokedRoomIds,
    revokedTeamIds,
    setRevokedTeamIds,
    presenceByRoom,
    setPresenceByRoom,
    hostHandoffsByRoom,
    setHostHandoffsByRoom,
    codexContinuationByRoom,
    setCodexContinuationByRoom,
    gitWorkflowEventsByRoom,
    setGitWorkflowEventsByRoom,
    githubActionsEventsByRoom,
    setGitHubActionsEventsByRoom
  };
}
