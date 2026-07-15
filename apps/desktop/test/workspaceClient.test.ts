import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { readJsonResponse, RelayHttpError } from "../src/lib/core/httpResponse";
import {
  createRoom,
  loadAttachmentBlob,
  normalizeDirectedInviteResponse,
  updateTeamLifecycle,
  updateRoomSettings
} from "../src/application/workspace/workspaceClient";
import { useAppStore } from "../src/store/appStore";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) =>
      key === "multaiplayer:app-config"
        ? JSON.stringify({ relayHttpUrl: "https://relay.test", relayWsUrl: "wss://relay.test/rooms" })
        : null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 1
  }
});

test("readJsonResponse surfaces relay auth errors", async () => {
  const response = new Response(
    JSON.stringify({
      error: "Sign in with GitHub before reading workspace state.",
      code: "authentication_required"
    }),
    {
      status: 401,
      headers: { "content-type": "application/json" }
    }
  );

  const error = await readJsonResponse(response, "Failed to load workspace").catch((caught: unknown) => caught);
  assert.ok(error instanceof RelayHttpError);
  assert.equal(error.status, 401);
  assert.equal(error.code, "authentication_required");
  assert.match(error.message, /Sign in with GitHub/);
});

test("readJsonResponse includes HTTP status for non-json failures", async () => {
  const response = new Response("gateway down", { status: 502 });

  await assert.rejects(
    () => readJsonResponse(response, "Failed to load workspace"),
    /Failed to load workspace: HTTP 502/
  );
});

test("readJsonResponse returns typed JSON bodies", async () => {
  const response = new Response(JSON.stringify({ teams: [], rooms: [] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

  assert.deepEqual(await readJsonResponse<{ teams: unknown[]; rooms: unknown[] }>(response, "Failed"), {
    teams: [],
    rooms: []
  });
});

test("directed invite responses omit an absent Welcome after HTTP decoding", () => {
  const directed = normalizeDirectedInviteResponse({
    status: "denied",
    responseBinding: { version: 3 },
    responseMac: "response-mac",
    welcome: undefined
  });
  assert.equal(Object.hasOwn(directed, "welcome"), false);
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(directed)), "welcome"), false);
});

const workspaceRoom: ClientRoomRecord = {
  id: "room-workspace-client",
  teamId: "team-workspace-client",
  name: "Workspace client",
  projectPath: "/private/workspace/with-secrets",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: [],
  browserProfilePersistent: true,
  configRevision: 4,
  configEpoch: 2,
  configPending: false,
  unread: 0
};

test("room creation keeps local workspace and Codex execution settings off the relay", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        room: {
          ...workspaceRoom,
          projectPath: "",
          codexModel: "",
          configRevision: 0,
          configEpoch: 0
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  try {
    const created = await createRoom(workspaceRoom.teamId, "Injected\nroom name", workspaceRoom.projectPath, {
      codexModel: "gpt-5.4",
      codexSandboxLevel: "workspace-write",
      browserAllowedOrigins: ["https://example.test"]
    });

    assert.match(requestUrl, /\/rooms$/);
    assert.deepEqual(requestBody, {
      teamId: workspaceRoom.teamId,
      name: "Injected\nroom name",
      browserAllowedOrigins: ["https://example.test"]
    });
    assert.equal(JSON.stringify(requestBody).includes(workspaceRoom.projectPath), false);
    assert.equal(created.projectPath, workspaceRoom.projectPath);
    assert.equal(created.codexModel, "gpt-5.4");
    assert.equal(created.codexSandboxLevel, "workspace-write");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("attachment lookup encodes attacker-shaped identifiers as path and query data", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        blob: {
          id: "blob/../../rooms?admin=true",
          teamId: "team&other=stolen",
          roomId: "room#fragment",
          name: "safe.txt",
          type: "text/plain",
          size: 4,
          epoch: 1,
          sealedBlob: "sealed",
          createdAt: "2026-07-09T12:00:00.000Z"
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  try {
    await loadAttachmentBlob("blob/../../rooms?admin=true", "team&other=stolen", "room#fragment");

    const parsed = new URL(requestedUrl);
    assert.equal(parsed.pathname.endsWith("/attachment-blobs/blob%2F..%2F..%2Frooms%3Fadmin%3Dtrue"), true);
    assert.equal(parsed.searchParams.get("teamId"), "team&other=stolen");
    assert.equal(parsed.searchParams.get("roomId"), "room#fragment");
    assert.equal([...parsed.searchParams.keys()].sort().join(","), "roomId,teamId");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local-only room settings never perform a relay mutation", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("local settings must not reach the relay");
  };
  useAppStore.getState().resetAppStore();
  useAppStore.setState({ rooms: [workspaceRoom], selectedRoomId: workspaceRoom.id });
  try {
    const updated = await updateRoomSettings(workspaceRoom.id, {
      projectPath: "/private/new-local-path",
      codexSandboxLevel: "read-only",
      codexRawReasoningEnabled: true
    });

    assert.equal(fetchCalls, 0);
    assert.equal(updated.projectPath, "/private/new-local-path");
    assert.equal(updated.codexSandboxLevel, "read-only");
    assert.equal(updated.codexRawReasoningEnabled, true);
    assert.equal(updated.configRevision, workspaceRoom.configRevision + 1);
    assert.equal(updated.configEpoch, workspaceRoom.configEpoch);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("team lifecycle mutations encode attacker-shaped IDs and send only the explicit action", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const teamId = "team/../../admin?scope=all";
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return new Response(JSON.stringify({ team: { id: teamId, name: "Team", members: 1 }, rooms: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const result = await updateTeamLifecycle(teamId, "delete");

    assert.equal(
      new URL(requestedUrl).pathname.endsWith("/teams/team%2F..%2F..%2Fadmin%3Fscope%3Dall/lifecycle"),
      true
    );
    assert.equal(requestedInit?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(requestedInit?.body)), { action: "delete" });
    assert.deepEqual(result.rooms, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
