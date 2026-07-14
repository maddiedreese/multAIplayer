import { maxRoomIdChars, maxTeamIdChars, relayIdPattern } from "@multaiplayer/protocol";
import { reportNonFatal } from "./nonFatalReporting";

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
      if (!validTeamId(event.teamId)) return normalized;
      return {
        ...normalized,
        intent: "create",
        surface: "workspace",
        assistantCompleted: false,
        markers: {
          ...normalized.markers,
          workspaceCreatedTeamId: event.teamId,
          membership: null,
          projectAttached: false,
          firstTurnCompleted: false,
          teammateJoined: false,
          teammateDeferred: false
        }
      };
    case "room_ready": {
      if (!validTeamId(event.teamId) || !validRoomId(event.roomId)) return normalized;
      if (
        event.intent === "create" &&
        normalized.markers.workspaceCreatedTeamId !== null &&
        normalized.markers.workspaceCreatedTeamId !== event.teamId
      ) {
        return normalized;
      }
      const sameMembership =
        normalized.markers.membership?.teamId === event.teamId && normalized.markers.membership.roomId === event.roomId;
      return {
        ...normalized,
        intent: event.intent,
        surface: "safety",
        assistantCompleted: sameMembership && normalized.assistantCompleted,
        markers: {
          ...normalized.markers,
          workspaceCreatedTeamId: null,
          membership: { teamId: event.teamId, roomId: event.roomId },
          projectAttached: sameMembership && normalized.markers.projectAttached,
          firstTurnCompleted: sameMembership && normalized.markers.firstTurnCompleted,
          teammateJoined: normalized.markers.membership?.teamId === event.teamId && normalized.markers.teammateJoined,
          teammateDeferred:
            normalized.markers.membership?.teamId === event.teamId && normalized.markers.teammateDeferred
        }
      };
    }
    case "project_attached":
      if (!validRoomId(event.roomId) || normalized.markers.membership?.roomId !== event.roomId) return normalized;
      return { ...normalized, markers: { ...normalized.markers, projectAttached: true } };
    case "first_turn_completed":
      if (!validRoomId(event.roomId) || normalized.markers.membership?.roomId !== event.roomId) return normalized;
      return {
        ...normalized,
        surface: "guided_turn",
        assistantCompleted: true,
        markers: { ...normalized.markers, firstTurnCompleted: true }
      };
    case "teammate_joined":
      if (!validTeamId(event.teamId) || normalized.markers.membership?.teamId !== event.teamId) return normalized;
      return {
        ...normalized,
        markers: { ...normalized.markers, teammateJoined: true, teammateDeferred: false }
      };
    case "teammate_deferred":
      if (!validTeamId(event.teamId) || normalized.markers.membership?.teamId !== event.teamId) return normalized;
      if (normalized.markers.teammateJoined) return normalized;
      return {
        ...normalized,
        markers: { ...normalized.markers, teammateDeferred: true }
      };
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
  if (!validNullableIntent(value.intent) || !validSurface(value.surface) || !validPresentation(value.presentation)) {
    return null;
  }
  if (
    typeof value.assistantCompleted !== "boolean" ||
    typeof value.checklistDismissed !== "boolean" ||
    !isRecord(value.markers)
  ) {
    return null;
  }
  const markers = value.markers;
  if (
    typeof markers.codexConnected !== "boolean" ||
    typeof markers.projectAttached !== "boolean" ||
    typeof markers.firstTurnCompleted !== "boolean" ||
    typeof markers.teammateJoined !== "boolean" ||
    typeof markers.teammateDeferred !== "boolean"
  ) {
    return null;
  }
  const workspaceCreatedTeamId = markers.workspaceCreatedTeamId;
  if (workspaceCreatedTeamId !== null && !validTeamId(workspaceCreatedTeamId)) return null;
  const membership = normalizeMembership(markers.membership);
  if (markers.membership !== null && membership === null) return null;
  if (workspaceCreatedTeamId !== null && (value.intent !== "create" || membership !== null)) return null;
  if (membership !== null && value.intent === null) return null;
  if (
    membership === null &&
    (markers.projectAttached || markers.firstTurnCompleted || markers.teammateJoined || markers.teammateDeferred)
  ) {
    return null;
  }
  if (markers.teammateJoined && markers.teammateDeferred) return null;
  if (value.assistantCompleted !== markers.firstTurnCompleted) return null;

  return {
    version: onboardingStateVersion,
    intent: value.intent,
    surface: value.surface,
    presentation: value.presentation,
    assistantCompleted: value.assistantCompleted,
    checklistDismissed: value.checklistDismissed,
    markers: {
      codexConnected: markers.codexConnected,
      workspaceCreatedTeamId,
      membership,
      projectAttached: membership !== null && markers.projectAttached,
      firstTurnCompleted: membership !== null && markers.firstTurnCompleted,
      teammateJoined: membership !== null && markers.teammateJoined,
      teammateDeferred: membership !== null && markers.teammateDeferred
    }
  };
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
