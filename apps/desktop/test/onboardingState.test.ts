import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialOnboardingState,
  deriveOnboardingProgress,
  loadOnboardingState,
  onboardingRestartEvent,
  onboardingStorageKey,
  reduceOnboardingState,
  saveOnboardingState,
  type OnboardingEvent,
  type OnboardingState
} from "../src/lib/onboarding/onboardingState";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function apply(events: OnboardingEvent[]): OnboardingState {
  return events.reduce(reduceOnboardingState, createInitialOnboardingState());
}

test("fresh onboarding starts open without claiming progress", () => {
  const state = createInitialOnboardingState();
  assert.deepEqual(deriveOnboardingProgress(state), {
    status: "not_started",
    steps: [
      { id: "connect_codex", completed: false },
      { id: "create_or_join_room", completed: false },
      { id: "attach_project", completed: false },
      { id: "run_first_turn", completed: false },
      { id: "invite_teammate", completed: false }
    ],
    completedSteps: 0,
    totalSteps: 5,
    percent: 0,
    nextStep: "connect_codex",
    checklistComplete: false,
    assistantVisible: true,
    checklistVisible: true
  });
});

test("assistant completion remains distinct from the persistent five-step checklist", () => {
  const common: OnboardingEvent[] = [
    { type: "codex_connected" },
    { type: "room_ready", intent: "join", teamId: "team_alpha", roomId: "room_alpha" },
    { type: "project_attached", roomId: "room_alpha" },
    { type: "first_turn_completed", roomId: "room_alpha" }
  ];
  const joined = apply(common);
  assert.equal(deriveOnboardingProgress(joined).status, "completed");
  assert.equal(deriveOnboardingProgress(joined).totalSteps, 5);
  assert.equal(deriveOnboardingProgress(joined).checklistComplete, false);
  assert.equal(deriveOnboardingProgress(joined).checklistVisible, true);

  const created = apply([
    { type: "choose_intent", intent: "create" },
    ...common.slice(0, 1),
    {
      type: "room_ready",
      intent: "create",
      teamId: "team_alpha",
      roomId: "room_alpha"
    },
    ...common.slice(2)
  ]);
  assert.equal(deriveOnboardingProgress(created).status, "completed");
  assert.equal(deriveOnboardingProgress(created).nextStep, "invite_teammate");
  const deferred = reduceOnboardingState(created, { type: "teammate_deferred", teamId: "team_alpha" });
  assert.equal(deferred.markers.teammateJoined, false);
  assert.equal(deferred.markers.teammateDeferred, true);
  assert.equal(deriveOnboardingProgress(deferred).checklistComplete, true);
  assert.equal(deriveOnboardingProgress(deferred).percent, 100);

  const joinedLater = reduceOnboardingState(deferred, { type: "teammate_joined", teamId: "team_alpha" });
  assert.equal(joinedLater.markers.teammateJoined, true);
  assert.equal(joinedLater.markers.teammateDeferred, false);
});

test("room-scoped milestones reject unrelated and malformed identifiers", () => {
  const roomReady = apply([{ type: "room_ready", intent: "create", teamId: "team_alpha", roomId: "room_alpha" }]);
  const unrelated = [
    { type: "project_attached", roomId: "room_other" },
    { type: "first_turn_completed", roomId: "../room_alpha" },
    { type: "teammate_joined", teamId: "team_other" }
  ].reduce((state, event) => reduceOnboardingState(state, event as OnboardingEvent), roomReady);
  assert.deepEqual(unrelated, roomReady);

  const nextRoom = reduceOnboardingState(
    reduceOnboardingState(roomReady, { type: "project_attached", roomId: "room_alpha" }),
    { type: "room_ready", intent: "create", teamId: "team_alpha", roomId: "room_beta" }
  );
  assert.equal(nextRoom.markers.projectAttached, false);
  assert.equal(nextRoom.markers.firstTurnCompleted, false);
});

test("partial creator progress survives restart and is consumed only by the matching room", () => {
  const storage = new MemoryStorage();
  let state = reduceOnboardingState(createInitialOnboardingState(), {
    type: "workspace_created",
    teamId: "team_alpha"
  });
  saveOnboardingState(state, storage);
  state = loadOnboardingState(storage);
  assert.equal(state.intent, "create");
  assert.equal(state.markers.workspaceCreatedTeamId, "team_alpha");
  assert.equal(state.markers.membership, null);

  const mismatched = reduceOnboardingState(state, {
    type: "room_ready",
    intent: "create",
    teamId: "team_other",
    roomId: "room_other"
  });
  assert.deepEqual(mismatched, state);

  const completed = reduceOnboardingState(state, {
    type: "room_ready",
    intent: "create",
    teamId: "team_alpha",
    roomId: "room_alpha"
  });
  assert.equal(completed.markers.workspaceCreatedTeamId, null);
  assert.deepEqual(completed.markers.membership, { teamId: "team_alpha", roomId: "room_alpha" });
});

test("restarting setup preserves a partial team checkpoint instead of permitting a duplicate", () => {
  const fresh = createInitialOnboardingState();
  assert.deepEqual(onboardingRestartEvent(fresh), { type: "reset" });

  const partial = reduceOnboardingState(fresh, { type: "workspace_created", teamId: "team-partial" });
  assert.deepEqual(onboardingRestartEvent(partial), { type: "show_surface", surface: "workspace" });
  const resumed = reduceOnboardingState(partial, onboardingRestartEvent(partial));
  assert.equal(resumed.markers.workspaceCreatedTeamId, "team-partial");
});

test("dismiss, skip, reopen, resume, and checklist dismissal remain independent", () => {
  let state = reduceOnboardingState(createInitialOnboardingState(), { type: "choose_intent", intent: "join" });
  state = reduceOnboardingState(state, { type: "dismiss_assistant" });
  assert.equal(deriveOnboardingProgress(state).status, "dismissed");
  assert.equal(deriveOnboardingProgress(state).assistantVisible, false);
  assert.equal(deriveOnboardingProgress(state).checklistVisible, true);

  state = reduceOnboardingState(state, { type: "reopen_assistant" });
  assert.equal(deriveOnboardingProgress(state).status, "in_progress");
  assert.equal(state.surface, "readiness");
  state = reduceOnboardingState(state, { type: "skip_assistant" });
  assert.equal(deriveOnboardingProgress(state).status, "skipped");
  state = reduceOnboardingState(state, { type: "dismiss_checklist" });
  assert.equal(deriveOnboardingProgress(state).checklistVisible, false);
  state = reduceOnboardingState(state, { type: "reopen_checklist" });
  assert.equal(deriveOnboardingProgress(state).checklistVisible, true);
});

test("version zero migrates to the bounded version one shape without retaining extra data", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    onboardingStorageKey,
    JSON.stringify({
      version: 0,
      intent: "create",
      step: "guided_turn",
      dismissed: true,
      checklistDismissed: false,
      progress: {
        codexConnected: true,
        teamId: "team_alpha",
        roomId: "room_alpha",
        projectAttached: true,
        firstTurnCompleted: true,
        teammateInvited: true,
        prompt: "private prompt"
      },
      accessToken: "secret",
      githubDeviceCode: "github-device-secret",
      githubUserCode: "github-user-code",
      codexLoginId: "codex-login-secret",
      codexAuthorizationUrl: "https://auth.openai.com/secret-flow",
      inviteFragment: "protected-invite-fragment"
    })
  );

  const migrated = loadOnboardingState(storage);
  assert.equal(migrated.version, 1);
  assert.equal(migrated.presentation, "dismissed");
  assert.deepEqual(migrated.markers.membership, { teamId: "team_alpha", roomId: "room_alpha" });
  assert.equal(migrated.markers.teammateJoined, false);
  const persisted = storage.getItem(onboardingStorageKey) ?? "";
  assert.doesNotMatch(
    persisted,
    /private prompt|accessToken|secret|github-user-code|auth\.openai\.com|protected-invite-fragment/
  );
});

test("unsupported, malformed, and internally inconsistent persisted state fails closed", () => {
  const storage = new MemoryStorage();
  for (const value of [
    "not json",
    JSON.stringify({ version: 99, completed: true }),
    JSON.stringify({
      ...createInitialOnboardingState(),
      markers: { ...createInitialOnboardingState().markers, membership: { teamId: "bad/team", roomId: "room_ok" } }
    }),
    JSON.stringify({
      ...createInitialOnboardingState(),
      markers: { ...createInitialOnboardingState().markers, membership: null, projectAttached: true }
    })
  ]) {
    storage.setItem(onboardingStorageKey, value);
    assert.deepEqual(loadOnboardingState(storage), createInitialOnboardingState());
    assert.equal(storage.getItem(onboardingStorageKey), null);
  }
});

test("saving serializes the normalized allowlisted state and tolerates unavailable storage", () => {
  const storage = new MemoryStorage();
  const state = apply([
    { type: "codex_connected" },
    { type: "room_ready", intent: "join", teamId: "team_alpha", roomId: "room_alpha" }
  ]);
  saveOnboardingState({ ...state, untrustedPrompt: "do not persist" } as OnboardingState, storage);
  assert.deepEqual(JSON.parse(storage.getItem(onboardingStorageKey) ?? "null"), state);

  const unavailable = {
    getItem: () => {
      throw new Error("unavailable");
    },
    removeItem: () => {
      throw new Error("unavailable");
    },
    setItem: () => {
      throw new Error("unavailable");
    }
  };
  assert.deepEqual(loadOnboardingState(unavailable), createInitialOnboardingState());
  assert.doesNotThrow(() => saveOnboardingState(state, unavailable));
});

test("saving onboarding state cannot retain ephemeral authentication or invitation material", () => {
  const storage = new MemoryStorage();
  const contaminated = {
    ...createInitialOnboardingState(),
    githubDeviceCode: "github-device-code",
    githubUserCode: "github-user-code",
    githubVerificationUrl: "https://github.com/login/device?secret=one",
    codexLoginId: "codex-login-id",
    codexLoginUrl: "https://auth.openai.com/oauth?secret=two",
    codexUserCode: "codex-user-code",
    invite: "https://multaiplayer.com/?invite=three#protected-four"
  };

  saveOnboardingState(contaminated, storage);
  const persisted = storage.getItem(onboardingStorageKey) ?? "";
  assert.doesNotMatch(
    persisted,
    /github-device-code|github-user-code|github\.com|codex-login-id|auth\.openai\.com|codex-user-code|invite=three|protected-four/
  );
});

test("the app store persists events and can reload an interrupted journey", async () => {
  const storage = new MemoryStorage();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    const { useAppStore } = await import("../src/store/appStore");
    useAppStore.getState().applyOnboardingEvent({ type: "choose_intent", intent: "join" });
    useAppStore.getState().applyOnboardingEvent({ type: "dismiss_assistant" });

    assert.equal(JSON.parse(storage.getItem(onboardingStorageKey) ?? "null").presentation, "dismissed");
    useAppStore.setState({ onboarding: createInitialOnboardingState() });
    useAppStore.getState().reloadOnboarding();
    assert.equal(useAppStore.getState().onboarding.intent, "join");
    assert.equal(deriveOnboardingProgress(useAppStore.getState().onboarding).status, "dismissed");
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
