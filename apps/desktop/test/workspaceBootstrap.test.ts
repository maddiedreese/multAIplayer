import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { useWorkspaceBootstrap } from "../src/hooks/useWorkspaceBootstrap";
import { useAppStore } from "../src/store/appStore";
import { seededRooms } from "./support/workspaceFixtures";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:1420/"
});

Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });
Object.assign(globalThis, { Element: dom.window.Element, HTMLElement: dom.window.HTMLElement });

const originalFetch = globalThis.fetch;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    "multaiplayer:app-config",
    JSON.stringify({ relayHttpUrl: "http://127.0.0.1:4322", relayWsUrl: "ws://127.0.0.1:4322/rooms" })
  );
  useAppStore.getState().resetAppStore();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function useStoreBackedWorkspaceBootstrap(authenticatedUserId: string | null = null) {
  const relayHttpUrl = useAppStore((state) => state.appConfig.relayHttpUrl);
  const bootstrapAttempt = useAppStore((state) => state.workspaceBootstrapAttempt);
  const store = useAppStore.getState();
  useWorkspaceBootstrap({
    relayHttpUrl,
    authenticatedUserId,
    bootstrapAttempt,
    replaceTeams: store.replaceTeams,
    replaceRooms: store.replaceRooms,
    selectExistingTeamOrFirst: store.selectExistingTeamOrFirst,
    selectExistingRoomOrFirst: store.selectExistingRoomOrFirst,
    setWorkspaceStatusError: store.setWorkspaceStatusError,
    beginWorkspaceBootstrap: store.beginWorkspaceBootstrap,
    completeWorkspaceBootstrap: store.completeWorkspaceBootstrap,
    failWorkspaceBootstrap: store.failWorkspaceBootstrap
  });
}

test("HTTP workspace bootstrap reports ready before any room WebSocket exists", async () => {
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "http://127.0.0.1:4322/teams");
    return Response.json({ teams: [], rooms: [] });
  };

  renderHook(() => useStoreBackedWorkspaceBootstrap());

  await waitFor(() => assert.equal(useAppStore.getState().workspaceBootstrapStatus, "ready"));
  const state = useAppStore.getState();
  assert.equal(state.workspaceBootstrapError, null);
  assert.equal(state.workspaceError, null);
  assert.equal(state.relayStatus, "closed");
});

test("workspace rebootstrap preserves the host's MLS-only room configuration", async () => {
  const configured = {
    ...seededRooms[0]!,
    projectPath: "/private/host/project",
    codexModel: "gpt-5.4",
    configRevision: 7,
    configEpoch: 3,
    configPending: false
  };
  useAppStore.getState().replaceRooms([configured]);
  const {
    projectPath: _projectPath,
    codexModel: _codexModel,
    codexModelPolicy: _codexModelPolicy,
    codexReasoningEffort: _codexReasoningEffort,
    codexReasoningEffortPolicy: _codexReasoningEffortPolicy,
    codexRawReasoningEnabled: _codexRawReasoningEnabled,
    codexSpeed: _codexSpeed,
    codexServiceTierPolicy: _codexServiceTierPolicy,
    codexSandboxLevel: _codexSandboxLevel,
    configRevision: _configRevision,
    configEpoch: _configEpoch,
    configPending: _configPending,
    ...relayRoom
  } = configured;
  globalThis.fetch = async () =>
    Response.json({ teams: [{ id: configured.teamId, name: "Team", members: 1 }], rooms: [relayRoom] });

  renderHook(() => useStoreBackedWorkspaceBootstrap());

  await waitFor(() => assert.equal(useAppStore.getState().workspaceBootstrapStatus, "ready"));
  const room = useAppStore.getState().rooms[0]!;
  assert.equal(room.projectPath, "/private/host/project");
  assert.equal(room.codexModel, "gpt-5.4");
  assert.equal(room.configRevision, 7);
  assert.equal(room.configEpoch, 3);
  assert.equal(room.configPending, false);
});

test("HTTP workspace bootstrap exposes an error and retries through the same load path", async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return requests === 1
      ? Response.json({ error: "relay unavailable" }, { status: 503 })
      : Response.json({
          teams: [{ id: "team-recovered", name: "Recovered", members: 1, role: "owner" }],
          rooms: []
        });
  };

  renderHook(() => useStoreBackedWorkspaceBootstrap());

  await waitFor(() => assert.equal(useAppStore.getState().workspaceBootstrapStatus, "error"));
  let state = useAppStore.getState();
  assert.match(state.workspaceBootstrapError ?? "", /relay unavailable/);
  assert.equal(state.workspaceBootstrapError, state.workspaceError);

  act(() => useAppStore.getState().retryWorkspaceBootstrap());
  assert.equal(useAppStore.getState().workspaceBootstrapStatus, "loading");

  await waitFor(() => assert.equal(useAppStore.getState().workspaceBootstrapStatus, "ready"));
  state = useAppStore.getState();
  assert.equal(requests, 2);
  assert.equal(state.workspaceBootstrapAttempt, 1);
  assert.equal(state.workspaceBootstrapError, null);
  assert.equal(state.workspaceError, null);
  assert.equal(state.teams[0]?.id, "team-recovered");
  assert.equal(state.relayStatus, "closed");
});

test("auth-required bootstrap reruns once when GitHub Device Flow resolves an authenticated identity", async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return requests === 1
      ? Response.json(
          { error: "Sign in before reading the workspace.", code: "authentication_required" },
          { status: 401 }
        )
      : Response.json({
          teams: [{ id: "team-member", name: "Member workspace", members: 1, role: "member" }],
          rooms: []
        });
  };

  const { rerender } = renderHook(
    ({ authenticatedUserId }: { authenticatedUserId: string | null }) =>
      useStoreBackedWorkspaceBootstrap(authenticatedUserId),
    { initialProps: { authenticatedUserId: null as string | null } }
  );

  await waitFor(() => assert.equal(useAppStore.getState().workspaceBootstrapStatus, "error"));
  assert.equal(requests, 1);

  rerender({ authenticatedUserId: "github:new-member" });
  await waitFor(() => assert.equal(useAppStore.getState().workspaceBootstrapStatus, "ready"));
  assert.equal(requests, 2, "the authenticated transition should trigger exactly one fresh bootstrap");
  assert.equal(useAppStore.getState().teams[0]?.id, "team-member");

  rerender({ authenticatedUserId: "github:new-member" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests, 2, "stable authenticated renders must not create a retry loop");
});
