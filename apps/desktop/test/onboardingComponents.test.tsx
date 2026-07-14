import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import {
  OnboardingAssistant,
  type OnboardingAssistantProps,
  type OnboardingReadinessRow
} from "../src/components/OnboardingAssistant";
import { GuidedFirstTurn } from "../src/components/GuidedFirstTurn";
import { SetupChecklist } from "../src/components/SetupChecklist";
import {
  createInitialOnboardingState,
  deriveOnboardingProgress,
  reduceOnboardingState
} from "../src/lib/onboardingState";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:5173/" });
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Event: dom.window.Event,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  React
})) {
  Object.defineProperty(globalThis, key, { configurable: true, value });
}

afterEach(() => cleanup());

const noop = () => undefined;
const readiness: OnboardingReadinessRow[] = [
  { id: "relay", label: "Relay", status: "ready", text: "Connected.", blocking: false, warning: false, action: null },
  {
    id: "github",
    label: "GitHub",
    status: "warning",
    text: "Optional here.",
    blocking: false,
    warning: true,
    action: "sign_in_github"
  },
  { id: "codex", label: "Codex", status: "ready", text: "Installed.", blocking: false, warning: false, action: null },
  {
    id: "chatgpt",
    label: "ChatGPT account",
    status: "ready",
    text: "Connected.",
    blocking: false,
    warning: false,
    action: null
  },
  {
    id: "project",
    label: "Project access",
    status: "warning",
    text: "Choose during setup.",
    blocking: false,
    warning: true,
    action: "select_project_folder"
  }
];

function assistantProps(overrides: Partial<OnboardingAssistantProps> = {}): OnboardingAssistantProps {
  return {
    state: createInitialOnboardingState(),
    readiness,
    onChooseIntent: noop,
    onExplore: noop,
    onShowSurface: noop,
    onReadinessAction: noop,
    onSubmitCreate: noop,
    onRetryRoomCreation: noop,
    onSubmitJoin: noop,
    onChooseProjectFolder: async () => null,
    onContinueSafety: noop,
    onDismiss: noop,
    ...overrides
  };
}

test("welcome is keyboard-native, focuses its heading, and exposes equal create and join paths", () => {
  const intents: string[] = [];
  let explored = 0;
  const view = render(
    <OnboardingAssistant
      {...assistantProps({
        onChooseIntent: (intent) => intents.push(intent),
        onExplore: () => {
          explored += 1;
        }
      })}
    />
  );
  assert.equal(document.activeElement, view.getByRole("heading", { name: "Work with Codex together" }));
  fireEvent.click(view.getByRole("button", { name: /Create a workspace/ }));
  fireEvent.click(view.getByRole("button", { name: /Join with an invite/ }));
  fireEvent.click(view.getByRole("button", { name: "Explore the interface" }));
  assert.deepEqual(intents, ["create", "join"]);
  assert.equal(explored, 1);
});

test("readiness stays in canonical order, warnings are actionable, and blocked rows stop progress", () => {
  const actions: string[] = [];
  const state = reduceOnboardingState(createInitialOnboardingState(), { type: "choose_intent", intent: "create" });
  const blocked = readiness.map((row) =>
    row.id === "codex"
      ? {
          ...row,
          status: "blocked" as const,
          blocking: true,
          action: "update_codex" as const,
          text: "Update required."
        }
      : row
  );
  const view = render(
    <OnboardingAssistant
      {...assistantProps({ state, readiness: blocked.reverse(), onReadinessAction: (action) => actions.push(action) })}
    />
  );
  const rows = Array.from(view.container.querySelectorAll(".onboarding-readiness-row strong")).map(
    (node) => node.textContent
  );
  assert.deepEqual(rows, ["Relay", "GitHub", "Codex", "ChatGPT account", "Project access"]);
  assert.equal((view.getByRole("button", { name: /Continue/ }) as HTMLButtonElement).disabled, true);
  fireEvent.click(view.getByRole("button", { name: "Update Codex" }));
  assert.deepEqual(actions, ["update_codex"]);
  assert.match(view.container.querySelector(".onboarding-auth-explainer")?.textContent ?? "", /GitHub.*identifies/);
});

test("create form keeps folder selection local and retries only the room after partial team success", async () => {
  let selectedFrom = "unset";
  let retry: unknown;
  let state = reduceOnboardingState(createInitialOnboardingState(), { type: "choose_intent", intent: "create" });
  state = reduceOnboardingState(state, { type: "workspace_created", teamId: "team_alpha" });
  const view = render(
    <OnboardingAssistant
      {...assistantProps({
        state,
        onChooseProjectFolder: async (current) => {
          selectedFrom = current;
          return "/safe/project";
        },
        onRetryRoomCreation: (draft) => {
          retry = draft;
        }
      })}
    />
  );
  assert.equal(view.queryByLabelText("Workspace name"), null);
  assert.equal(view.queryByLabelText(/Invite teammates/), null);
  fireEvent.click(view.getByRole("button", { name: "Choose project folder" }));
  await act(async () => undefined);
  assert.equal(selectedFrom, "");
  assert.equal((view.getByLabelText("Project folder") as HTMLInputElement).value, "/safe/project");
  fireEvent.click(view.getByRole("button", { name: /Retry room setup/ }));
  assert.deepEqual(retry, { teamId: "team_alpha", roomName: "general", projectPath: "/safe/project" });
  assert.match(view.getByText(/secure invite link/).textContent ?? "", /secure invite link/);
});

test("join verification is announced and cannot be submitted again while pending", () => {
  let submissions = 0;
  const state = reduceOnboardingState(createInitialOnboardingState(), { type: "choose_intent", intent: "join" });
  const view = render(
    <OnboardingAssistant
      {...assistantProps({
        state: { ...state, surface: "workspace" },
        joinState: { phase: "verification_required", message: "Confirm this device with the room host." },
        onSubmitJoin: () => {
          submissions += 1;
        }
      })}
    />
  );
  assert.ok(view.getByRole("status").textContent?.includes("Device verification required"));
  const submit = view.getByRole("button", { name: /Waiting/ }) as HTMLButtonElement;
  assert.equal(submit.disabled, true);
  fireEvent.click(submit);
  assert.equal(submissions, 0);
});

test("safety step states the fixed defaults and requires an explicit continue action", () => {
  const state = reduceOnboardingState(createInitialOnboardingState(), {
    type: "room_ready",
    intent: "create",
    teamId: "team_alpha",
    roomId: "room_alpha"
  });
  let continued = 0;
  const view = render(
    <OnboardingAssistant
      {...assistantProps({
        state,
        onContinueSafety: () => {
          continued += 1;
        }
      })}
    />
  );
  assert.ok(view.getByText("Ask before every Codex turn"));
  assert.ok(view.getByText("Raw reasoning sharing off"));
  assert.ok(view.getByText("Browser access restricted"));
  assert.equal(continued, 0);
  fireEvent.click(view.getByRole("button", { name: /Enter room/ }));
  assert.equal(continued, 1);
});

test("setup checklist supports continue, dismissal, and an explicit teammate Not now resolution", () => {
  let state = reduceOnboardingState(createInitialOnboardingState(), { type: "codex_connected" });
  state = reduceOnboardingState(state, {
    type: "room_ready",
    intent: "create",
    teamId: "team_alpha",
    roomId: "room_alpha"
  });
  state = reduceOnboardingState(state, { type: "project_attached", roomId: "room_alpha" });
  state = reduceOnboardingState(state, { type: "first_turn_completed", roomId: "room_alpha" });
  let continued = 0;
  let deferred = 0;
  let dismissed = 0;
  const view = render(
    <SetupChecklist
      progress={deriveOnboardingProgress(state)}
      teammateJoined={false}
      teammateDeferred={false}
      onContinue={() => {
        continued += 1;
      }}
      onDeferTeammate={() => {
        deferred += 1;
      }}
      onDismiss={() => {
        dismissed += 1;
      }}
    />
  );
  assert.equal(view.getByRole("progressbar").getAttribute("aria-valuenow"), "4");
  fireEvent.click(view.getByRole("button", { name: "Continue setup" }));
  fireEvent.click(view.getByRole("button", { name: "Not now" }));
  fireEvent.click(view.getByRole("button", { name: "Dismiss setup checklist" }));
  assert.deepEqual([continued, deferred, dismissed], [1, 1, 1]);
});

test("first-turn guide populates prompts without sending and explains approval and live work", () => {
  const prompts: string[] = [];
  const view = render(
    <GuidedFirstTurn
      phase="composer"
      isActiveHost
      onUseStarterPrompt={(prompt) => prompts.push(prompt)}
      onReviewApproval={noop}
      onDismiss={noop}
    />
  );
  fireEvent.click(view.getByRole("button", { name: "Explain the structure of this project." }));
  assert.deepEqual(prompts, ["Explain the structure of this project."]);
  assert.equal(view.queryByRole("button", { name: /Send|Approve/ }), null);

  view.rerender(
    <GuidedFirstTurn phase="approval" isActiveHost onUseStarterPrompt={noop} onReviewApproval={noop} onDismiss={noop} />
  );
  assert.match(view.getByText(/never approves automatically/).textContent ?? "", /never approves automatically/);
  view.rerender(
    <GuidedFirstTurn
      phase="activity"
      isActiveHost
      activityKinds={["thinking", "commands"]}
      onUseStarterPrompt={noop}
      onReviewApproval={noop}
      onDismiss={noop}
    />
  );
  assert.ok(view.getByText("Commands and output"));
  assert.equal(view.container.querySelectorAll('[data-active="true"]').length, 2);
});
