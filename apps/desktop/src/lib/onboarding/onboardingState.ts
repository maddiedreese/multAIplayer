import { maxRoomIdChars, maxTeamIdChars, relayIdPattern } from "@multaiplayer/protocol";
import { reportNonFatal } from "../core/nonFatalReporting";

export const onboardingStorageKey = "multaiplayer:onboarding";
export const onboardingStateVersion = 1 as const;

export type OnboardingIntent = "create" | "join";
export type OnboardingSurface = "welcome" | "readiness" | "workspace" | "safety" | "guided_turn";
export type OnboardingPresentation = "open" | "dismissed" | "skipped";
export type OnboardingStatus = "not_started" | "in_progress" | "dismissed" | "skipped" | "completed";
export type OnboardingChecklistStep =
  "connect_codex" | "create_or_join_room" | "attach_project" | "run_first_turn" | "invite_teammate";

export interface OnboardingMembershipMarker {
  teamId: string;
  roomId: string;
}

export interface OnboardingMarkers {
  codexConnected: boolean;
  workspaceCreatedTeamId: string | null;
  membership: OnboardingMembershipMarker | null;
  projectAttached: boolean;
  firstTurnCompleted: boolean;
  teammateJoined: boolean;
  teammateDeferred: boolean;
}

export interface OnboardingState {
  version: typeof onboardingStateVersion;
  intent: OnboardingIntent | null;
  surface: OnboardingSurface;
  presentation: OnboardingPresentation;
  assistantCompleted: boolean;
  checklistDismissed: boolean;
  markers: OnboardingMarkers;
}

export interface OnboardingProgress {
  status: OnboardingStatus;
  steps: ReadonlyArray<{ id: OnboardingChecklistStep; completed: boolean }>;
  completedSteps: number;
  totalSteps: number;
  percent: number;
  nextStep: OnboardingChecklistStep | null;
  checklistComplete: boolean;
  assistantVisible: boolean;
  checklistVisible: boolean;
}

export type OnboardingEvent =
  | { type: "choose_intent"; intent: OnboardingIntent }
  | { type: "show_surface"; surface: OnboardingSurface }
  | { type: "codex_connected" }
  | { type: "workspace_created"; teamId: string }
  | { type: "room_ready"; intent: OnboardingIntent; teamId: string; roomId: string }
  | { type: "project_attached"; roomId: string }
  | { type: "first_turn_completed"; roomId: string }
  | { type: "teammate_joined"; teamId: string }
  | { type: "teammate_deferred"; teamId: string }
  | { type: "dismiss_assistant" }
  | { type: "skip_assistant" }
  | { type: "reopen_assistant" }
  | { type: "dismiss_checklist" }
  | { type: "reopen_checklist" }
  | { type: "reset" };

interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

const surfaces: ReadonlySet<string> = new Set(["welcome", "readiness", "workspace", "safety", "guided_turn"]);
const presentations: ReadonlySet<string> = new Set(["open", "dismissed", "skipped"]);

export function createInitialOnboardingState(): OnboardingState {
  return {
    version: onboardingStateVersion,
    intent: null,
    surface: "welcome",
    presentation: "open",
    assistantCompleted: false,
    checklistDismissed: false,
    markers: {
      codexConnected: false,
      workspaceCreatedTeamId: null,
      membership: null,
      projectAttached: false,
      firstTurnCompleted: false,
      teammateJoined: false,
      teammateDeferred: false
    }
  };
}

export function deriveOnboardingProgress(state: OnboardingState): OnboardingProgress {
  const steps: Array<{ id: OnboardingChecklistStep; completed: boolean }> = [
    { id: "connect_codex", completed: state.markers.codexConnected },
    { id: "create_or_join_room", completed: state.markers.membership !== null },
    { id: "attach_project", completed: state.markers.projectAttached },
    { id: "run_first_turn", completed: state.markers.firstTurnCompleted },
    {
      id: "invite_teammate",
      completed: state.markers.teammateJoined || state.markers.teammateDeferred
    }
  ];

  const completedSteps = steps.filter((step) => step.completed).length;
  const checklistComplete = completedSteps === steps.length;
  const started = state.intent !== null || completedSteps > 0 || state.surface !== "welcome";
  const status: OnboardingStatus = state.assistantCompleted
    ? "completed"
    : state.presentation === "skipped"
      ? "skipped"
      : state.presentation === "dismissed"
        ? "dismissed"
        : started
          ? "in_progress"
          : "not_started";

  return {
    status,
    steps,
    completedSteps,
    totalSteps: steps.length,
    percent: Math.round((completedSteps / steps.length) * 100),
    nextStep: steps.find((step) => !step.completed)?.id ?? null,
    checklistComplete,
    assistantVisible: state.presentation === "open",
    checklistVisible: !state.checklistDismissed && !checklistComplete
  };
}

/** Preserve a remotely-created team checkpoint so restarting cannot duplicate it. */
export function onboardingRestartEvent(state: OnboardingState): OnboardingEvent {
  return state.markers.workspaceCreatedTeamId ? { type: "show_surface", surface: "workspace" } : { type: "reset" };
}

export function reduceOnboardingState(state: OnboardingState, event: OnboardingEvent): OnboardingState {
  const normalized = normalizeVersionOne(state);
  if (!normalized) return createInitialOnboardingState();

  switch (event.type) {
    case "choose_intent":
      return {
        ...normalized,
        intent: event.intent,
        surface: "readiness",
        presentation: "open",
        markers: {
          ...normalized.markers,
          workspaceCreatedTeamId: event.intent === "join" ? null : normalized.markers.workspaceCreatedTeamId
        }
      };
    case "show_surface":
      return { ...normalized, surface: event.surface, presentation: "open" };
    case "codex_connected":
      return { ...normalized, markers: { ...normalized.markers, codexConnected: true } };
    case "workspace_created":
    case "room_ready":
      return reduceWorkspaceEvent(normalized, event);
    case "project_attached":
    case "first_turn_completed":
    case "teammate_joined":
    case "teammate_deferred":
      return reduceProgressEvent(normalized, event);
    case "dismiss_assistant":
      return { ...normalized, presentation: "dismissed" };
    case "skip_assistant":
      return { ...normalized, presentation: "skipped" };
    case "reopen_assistant":
      return { ...normalized, presentation: "open" };
    case "dismiss_checklist":
      return { ...normalized, checklistDismissed: true };
    case "reopen_checklist":
      return { ...normalized, checklistDismissed: false };
    case "reset":
      return createInitialOnboardingState();
  }
}

type WorkspaceEvent = Extract<OnboardingEvent, { type: "workspace_created" | "room_ready" }>;
type ProgressEvent = Extract<
  OnboardingEvent,
  { type: "project_attached" | "first_turn_completed" | "teammate_joined" | "teammate_deferred" }
>;

function reduceWorkspaceEvent(state: OnboardingState, event: WorkspaceEvent): OnboardingState {
  if (event.type === "workspace_created") {
    if (!validTeamId(event.teamId)) return state;
    return {
      ...state,
      intent: "create",
      surface: "workspace",
      assistantCompleted: false,
      markers: {
        ...state.markers,
        workspaceCreatedTeamId: event.teamId,
        membership: null,
        projectAttached: false,
        firstTurnCompleted: false,
        teammateJoined: false,
        teammateDeferred: false
      }
    };
  }
  if (!validTeamId(event.teamId) || !validRoomId(event.roomId)) return state;
  if (
    event.intent === "create" &&
    state.markers.workspaceCreatedTeamId !== null &&
    state.markers.workspaceCreatedTeamId !== event.teamId
  )
    return state;
  const sameMembership =
    state.markers.membership?.teamId === event.teamId && state.markers.membership.roomId === event.roomId;
  const sameTeam = state.markers.membership?.teamId === event.teamId;
  return {
    ...state,
    intent: event.intent,
    surface: "safety",
    assistantCompleted: sameMembership && state.assistantCompleted,
    markers: {
      ...state.markers,
      workspaceCreatedTeamId: null,
      membership: { teamId: event.teamId, roomId: event.roomId },
      projectAttached: sameMembership && state.markers.projectAttached,
      firstTurnCompleted: sameMembership && state.markers.firstTurnCompleted,
      teammateJoined: sameTeam && state.markers.teammateJoined,
      teammateDeferred: sameTeam && state.markers.teammateDeferred
    }
  };
}

function reduceProgressEvent(state: OnboardingState, event: ProgressEvent): OnboardingState {
  if (event.type === "project_attached" || event.type === "first_turn_completed") {
    if (!validRoomId(event.roomId) || state.markers.membership?.roomId !== event.roomId) return state;
    if (event.type === "project_attached") return { ...state, markers: { ...state.markers, projectAttached: true } };
    return {
      ...state,
      surface: "guided_turn",
      assistantCompleted: true,
      markers: { ...state.markers, firstTurnCompleted: true }
    };
  }
  if (!validTeamId(event.teamId) || state.markers.membership?.teamId !== event.teamId) return state;
  if (event.type === "teammate_joined")
    return { ...state, markers: { ...state.markers, teammateJoined: true, teammateDeferred: false } };
  if (state.markers.teammateJoined) return state;
  return { ...state, markers: { ...state.markers, teammateDeferred: true } };
}

export function loadOnboardingState(storage: StorageLike | undefined = browserStorage()): OnboardingState {
  if (!storage) return createInitialOnboardingState();
  let raw: string | null;
  try {
    raw = storage.getItem(onboardingStorageKey);
  } catch {
    reportNonFatal("read local onboarding state");
    return createInitialOnboardingState();
  }
  if (!raw) return createInitialOnboardingState();

  try {
    const decoded: unknown = JSON.parse(raw);
    const migrated = migrateOnboardingState(decoded);
    if (!migrated) throw new Error("Unsupported or invalid onboarding state");
    if (!isVersionOne(decoded)) safeWrite(storage, migrated);
    return migrated;
  } catch {
    reportNonFatal("discard corrupt local onboarding state");
    safeRemove(storage);
    return createInitialOnboardingState();
  }
}

export function saveOnboardingState(state: OnboardingState, storage: StorageLike | undefined = browserStorage()): void {
  if (!storage) return;
  const normalized = normalizeVersionOne(state);
  if (!normalized) {
    safeRemove(storage);
    return;
  }
  safeWrite(storage, normalized);
}

function migrateOnboardingState(value: unknown): OnboardingState | null {
  if (!isRecord(value)) return null;
  if (value.version === onboardingStateVersion) return normalizeVersionOne(value);
  if (value.version !== 0) return null;

  const progress = isRecord(value.progress) ? value.progress : {};
  const intent = validIntent(value.intent) ? value.intent : null;
  const membership =
    intent !== null && validTeamId(progress.teamId) && validRoomId(progress.roomId)
      ? { teamId: progress.teamId, roomId: progress.roomId }
      : null;
  const surface = validSurface(value.step) ? value.step : "welcome";
  const firstTurnCompleted = membership !== null && progress.firstTurnCompleted === true;
  return normalizeVersionOne({
    version: onboardingStateVersion,
    intent,
    surface,
    presentation: value.skipped === true ? "skipped" : value.dismissed === true ? "dismissed" : "open",
    assistantCompleted: firstTurnCompleted,
    checklistDismissed: value.checklistDismissed === true,
    markers: {
      codexConnected: progress.codexConnected === true,
      workspaceCreatedTeamId: null,
      membership,
      projectAttached: membership !== null && progress.projectAttached === true,
      firstTurnCompleted,
      // Version zero recorded an invitation, not observed membership. It cannot
      // safely satisfy the renamed teammate milestone.
      teammateJoined: false,
      teammateDeferred: false
    }
  });
}

function normalizeVersionOne(value: unknown): OnboardingState | null {
  if (!isRecord(value) || value.version !== onboardingStateVersion) return null;
  if (!hasValidOnboardingHeader(value)) return null;
  const markers = value.markers;
  if (!hasBooleanOnboardingMarkers(markers)) return null;
  const workspaceCreatedTeamId = markers.workspaceCreatedTeamId;
  if (workspaceCreatedTeamId !== null && !validTeamId(workspaceCreatedTeamId)) return null;
  const membership = normalizeMembership(markers.membership);
  if (markers.membership !== null && membership === null) return null;
  if (!validOnboardingMarkerRelationships(value, markers, workspaceCreatedTeamId, membership)) return null;

  return {
    version: onboardingStateVersion,
    intent: value.intent,
    surface: value.surface,
    presentation: value.presentation,
    assistantCompleted: value.assistantCompleted,
    checklistDismissed: value.checklistDismissed,
    markers: normalizedOnboardingMarkers(markers, workspaceCreatedTeamId, membership)
  };
}

function hasValidOnboardingHeader(value: Record<string, unknown>): value is Record<string, unknown> & {
  intent: OnboardingIntent | null;
  surface: OnboardingSurface;
  presentation: OnboardingPresentation;
  assistantCompleted: boolean;
  checklistDismissed: boolean;
  markers: Record<string, unknown>;
} {
  return (
    validNullableIntent(value.intent) &&
    validSurface(value.surface) &&
    validPresentation(value.presentation) &&
    typeof value.assistantCompleted === "boolean" &&
    typeof value.checklistDismissed === "boolean" &&
    isRecord(value.markers)
  );
}

function validOnboardingMarkerRelationships(
  value: { intent: OnboardingIntent | null; assistantCompleted: boolean },
  markers: BooleanOnboardingMarkers,
  workspaceCreatedTeamId: string | null,
  membership: OnboardingMembershipMarker | null
) {
  if (workspaceCreatedTeamId !== null && (value.intent !== "create" || membership !== null)) return false;
  if (membership !== null && value.intent === null) return false;
  if (membership === null && hasMembershipDependentProgress(markers)) return false;
  if (markers.teammateJoined && markers.teammateDeferred) return false;
  return value.assistantCompleted === markers.firstTurnCompleted;
}

type BooleanOnboardingMarkers = {
  codexConnected: boolean;
  projectAttached: boolean;
  firstTurnCompleted: boolean;
  teammateJoined: boolean;
  teammateDeferred: boolean;
};

function hasMembershipDependentProgress(markers: BooleanOnboardingMarkers) {
  return markers.projectAttached || markers.firstTurnCompleted || markers.teammateJoined || markers.teammateDeferred;
}

function normalizedOnboardingMarkers(
  markers: {
    codexConnected: boolean;
    projectAttached: boolean;
    firstTurnCompleted: boolean;
    teammateJoined: boolean;
    teammateDeferred: boolean;
  },
  workspaceCreatedTeamId: string | null,
  membership: OnboardingMembershipMarker | null
): OnboardingMarkers {
  const hasMembership = membership !== null;
  return {
    codexConnected: markers.codexConnected,
    workspaceCreatedTeamId,
    membership,
    projectAttached: hasMembership && markers.projectAttached,
    firstTurnCompleted: hasMembership && markers.firstTurnCompleted,
    teammateJoined: hasMembership && markers.teammateJoined,
    teammateDeferred: hasMembership && markers.teammateDeferred
  };
}

function hasBooleanOnboardingMarkers(markers: Record<string, unknown>): markers is Record<string, unknown> & {
  codexConnected: boolean;
  projectAttached: boolean;
  firstTurnCompleted: boolean;
  teammateJoined: boolean;
  teammateDeferred: boolean;
} {
  return (
    typeof markers.codexConnected === "boolean" &&
    typeof markers.projectAttached === "boolean" &&
    typeof markers.firstTurnCompleted === "boolean" &&
    typeof markers.teammateJoined === "boolean" &&
    typeof markers.teammateDeferred === "boolean"
  );
}

function normalizeMembership(value: unknown): OnboardingMembershipMarker | null {
  if (!isRecord(value) || !validTeamId(value.teamId) || !validRoomId(value.roomId)) return null;
  return { teamId: value.teamId, roomId: value.roomId };
}

function validIntent(value: unknown): value is OnboardingIntent {
  return value === "create" || value === "join";
}

function validNullableIntent(value: unknown): value is OnboardingIntent | null {
  return value === null || validIntent(value);
}

function validSurface(value: unknown): value is OnboardingSurface {
  return typeof value === "string" && surfaces.has(value);
}

function validPresentation(value: unknown): value is OnboardingPresentation {
  return typeof value === "string" && presentations.has(value);
}

function validTeamId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 3 && value.length <= maxTeamIdChars && relayIdPattern.test(value);
}

function validRoomId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 3 && value.length <= maxRoomIdChars && relayIdPattern.test(value);
}

function isVersionOne(value: unknown): boolean {
  return isRecord(value) && value.version === onboardingStateVersion;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function browserStorage(): StorageLike | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

function safeWrite(storage: StorageLike, state: OnboardingState): void {
  try {
    storage.setItem(onboardingStorageKey, JSON.stringify(state));
  } catch {
    reportNonFatal("persist local onboarding state");
  }
}

function safeRemove(storage: StorageLike): void {
  try {
    storage.removeItem(onboardingStorageKey);
  } catch {
    reportNonFatal("remove invalid local onboarding state");
  }
}
