import {
  defaultApprovalDelegationPolicy,
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  defaultCodexModelPolicy,
  defaultCodexRawReasoningEnabled,
  defaultCodexReasoningEffort,
  defaultCodexReasoningEffortPolicy,
  defaultCodexSandboxLevel,
  defaultCodexServiceTierPolicy,
  defaultCodexSpeed,
  type ClientRoomRecord,
  type TeamRecord
} from "@multaiplayer/protocol";
import type { LocalHistorySettings } from "./localHistory";
import { ensureRoomDefaults } from "./roomDefaults";
import { planRoomCreation, planTeamCreation, type RoomCreatePlan, type WorkspaceCreatePlan } from "./workspaceCreation";
import type { RoomCreationSettings } from "./workspaceClient";

export interface WorkspaceCreationRuntime {
  createTeam: (name: string) => Promise<TeamRecord>;
  createRoom: (
    teamId: string,
    name: string,
    projectPath: string,
    settings: RoomCreationSettings
  ) => Promise<ClientRoomRecord>;
  findTeam: (teamId: string) => TeamRecord | undefined;
  upsertTeam: (team: TeamRecord) => void;
  upsertRoom: (room: ClientRoomRecord) => void;
  selectTeam: (teamId: string) => void;
  selectRoom: (roomId: string) => void;
  restoreRoomAccess: (roomId: string) => void;
  restoreTeamAccess: (teamId: string) => void;
  restoreForgottenRoom: (roomId: string) => void;
  setInviteApprovalGate: (roomId: string, enabled: boolean) => void;
  loadTeamHistorySettings: (teamId: string) => LocalHistorySettings;
  seedNewRoomHistorySettings: (roomId: string, settings: LocalHistorySettings) => LocalHistorySettings;
  initializeMessages: (roomId: string) => void;
}

export interface LocalRoomCreationDefaults {
  inviteApprovalGate: boolean;
  historySettings: LocalHistorySettings;
}

export type RequestedRoomCreationSettings = Omit<
  Readonly<RoomCreationSettings>,
  "trustedApproverUserIds" | "browserAllowedOrigins"
> & {
  readonly trustedApproverUserIds?: readonly string[];
  readonly browserAllowedOrigins?: readonly string[];
};

export interface FirstWorkspaceCreationInput {
  workspaceName: string;
  roomName: string;
  projectPath: string;
  existingTeamId?: string;
}

export type FirstWorkspaceCreationResult =
  | { status: "success"; team: TeamRecord; room: ClientRoomRecord }
  | { status: "partial_team"; team: TeamRecord; existingTeamId: string; error: unknown };

export const firstWorkspaceSafeRoomSettings: RequestedRoomCreationSettings = Object.freeze({
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: defaultApprovalDelegationPolicy,
  trustedApproverUserIds: Object.freeze([]),
  codexModel: defaultCodexModel,
  codexModelPolicy: defaultCodexModelPolicy,
  codexReasoningEffort: defaultCodexReasoningEffort,
  codexReasoningEffortPolicy: defaultCodexReasoningEffortPolicy,
  codexRawReasoningEnabled: defaultCodexRawReasoningEnabled,
  codexSpeed: defaultCodexSpeed,
  codexServiceTierPolicy: defaultCodexServiceTierPolicy,
  codexSandboxLevel: defaultCodexSandboxLevel,
  browserAllowedOrigins: Object.freeze([...defaultBrowserAllowedOrigins]),
  browserProfilePersistent: defaultBrowserProfilePersistent
});

export async function createWorkspaceTeam(
  plan: WorkspaceCreatePlan,
  runtime: Pick<WorkspaceCreationRuntime, "createTeam" | "upsertTeam" | "selectTeam">
): Promise<TeamRecord> {
  const team = await runtime.createTeam(plan.name);
  runtime.upsertTeam(team);
  runtime.selectTeam(team.id);
  return team;
}

export async function createWorkspaceRoom(
  plan: RoomCreatePlan,
  settings: RequestedRoomCreationSettings,
  localDefaults: LocalRoomCreationDefaults,
  runtime: Omit<
    WorkspaceCreationRuntime,
    "createTeam" | "findTeam" | "upsertTeam" | "selectTeam" | "loadTeamHistorySettings"
  >
): Promise<ClientRoomRecord> {
  const created = await runtime.createRoom(plan.teamId, plan.name, plan.projectPath, copyRoomSettings(settings));
  const room = ensureRoomDefaults(created);
  runtime.upsertRoom(room);
  runtime.restoreRoomAccess(room.id);
  runtime.restoreTeamAccess(room.teamId);
  runtime.restoreForgottenRoom(room.id);
  runtime.setInviteApprovalGate(room.id, localDefaults.inviteApprovalGate);
  runtime.seedNewRoomHistorySettings(room.id, localDefaults.historySettings);
  runtime.initializeMessages(room.id);
  runtime.selectRoom(room.id);
  return room;
}

export function createFirstWorkspaceCreator(runtime: WorkspaceCreationRuntime) {
  return async function createFirstWorkspace(
    input: FirstWorkspaceCreationInput
  ): Promise<FirstWorkspaceCreationResult> {
    // Validate every user-provided field before the first remote mutation. The
    // provisional id is replaced by the newly-created or persisted team id.
    const teamPlan = planTeamCreation(input.workspaceName);
    const roomPlan = planRoomCreation(
      input.existingTeamId?.trim() || "pending-team",
      input.roomName,
      input.projectPath
    );

    const team = input.existingTeamId
      ? requireExistingTeam(input.existingTeamId, runtime)
      : await createWorkspaceTeam(teamPlan, runtime);

    try {
      const room = await createWorkspaceRoom(
        { ...roomPlan, teamId: team.id },
        firstWorkspaceSafeRoomSettings,
        {
          inviteApprovalGate: true,
          historySettings: runtime.loadTeamHistorySettings(team.id)
        },
        runtime
      );
      return { status: "success", team, room };
    } catch (error) {
      return { status: "partial_team", team, existingTeamId: team.id, error };
    }
  };
}

function requireExistingTeam(teamId: string, runtime: Pick<WorkspaceCreationRuntime, "findTeam" | "selectTeam">) {
  const normalizedTeamId = teamId.trim();
  const team = runtime.findTeam(normalizedTeamId);
  if (!team) throw new Error("The saved workspace no longer exists. Start workspace creation again.");
  runtime.selectTeam(team.id);
  return team;
}

function copyRoomSettings(settings: RequestedRoomCreationSettings): RoomCreationSettings {
  const { trustedApproverUserIds, browserAllowedOrigins, ...scalarSettings } = settings;
  return {
    ...scalarSettings,
    ...(trustedApproverUserIds ? { trustedApproverUserIds: [...trustedApproverUserIds] } : {}),
    ...(browserAllowedOrigins ? { browserAllowedOrigins: [...browserAllowedOrigins] } : {})
  };
}
