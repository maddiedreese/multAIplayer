import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { routeActivityMessage } from "../src/hooks/relay/routeActivityMessage";
import type { RoutedMlsMessage } from "../src/hooks/relay/mlsMessageRouteTypes";
import { defaultTestRoom } from "./support/workspaceFixtures";

const createdAt = "2026-07-20T00:00:00.000Z";
const room: ClientRoomRecord = {
  ...defaultTestRoom,
  id: "room-activity-binding",
  hostUserId: "github:host",
  activeHostDeviceId: "device-host",
  hostStatus: "active"
};

type ActivityStore = Parameters<typeof routeActivityMessage>[1];

function envelope(kind: string, senderUserId = "github:host", senderDeviceId = "device-host") {
  return {
    roomId: room.id,
    senderUserId,
    senderDeviceId,
    kind
  } as RoutedMlsMessage;
}

function recordingStore() {
  const calls: Record<string, number> = {};
  const record = (name: string) => () => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const store = {
    rooms: [room],
    appendTerminalLinesForRoom: record("terminal.result"),
    updateTerminalRequestStatus: record("terminal.status"),
    appendGitWorkflowEvent: record("git.event"),
    setGitWorkflowMessageForRoom: record("git.message"),
    applyGitHubActionsEventForRoom: record("github.actions"),
    appendCodexEvent: record("codex.event"),
    upsertCodexActivity: record("codex.activity"),
    updateBrowserRequestStatus: record("browser.event"),
    updateFileSaveRequestStatus: record("workspace.event"),
    appendTerminalRequest: record("terminal.request"),
    appendBrowserRequest: record("browser.request"),
    appendFileSaveRequest: record("workspace.request"),
    enqueueCodexApprovalForRoom: record("codex.queue"),
    setChatMessageForRoom: record("chat.message"),
    setHostMessageForRoom: record("host.message")
  } as unknown as ActivityStore;
  return { calls, store };
}

const authoritativeEvents = [
  {
    kind: "terminal.event",
    call: "terminal.result",
    payload: {
      eventType: "terminal.result",
      requestId: "terminal-1",
      command: "npm test",
      cwd: "/workspace",
      exitStatus: 0,
      stdout: "ok",
      stderr: "",
      ranBy: "Host",
      ranByUserId: "github:host",
      startedAt: createdAt,
      finishedAt: createdAt
    }
  },
  {
    kind: "terminal.event",
    call: "terminal.status",
    payload: {
      requestId: "terminal-1",
      status: "approved",
      decidedBy: "Host",
      decidedByUserId: "github:host",
      decidedAt: createdAt
    }
  },
  {
    kind: "git.event",
    call: "git.event",
    payload: {
      eventType: "git.workflow",
      status: "completed",
      branch: "main",
      push: false,
      message: "Checks passed",
      runner: "Host",
      runnerUserId: "github:host",
      createdAt
    }
  },
  {
    kind: "git.event",
    call: "github.actions",
    payload: {
      eventType: "github.actions",
      owner: "owner",
      repo: "repo",
      branch: "main",
      summary: { label: "Passing", detail: "All checks passed", tone: "green" },
      message: "All checks passed",
      checkedBy: "Host",
      checkedByUserId: "github:host",
      checkedAt: createdAt,
      runs: []
    }
  },
  {
    kind: "codex.event",
    call: "codex.event",
    payload: {
      eventType: "codex.turn",
      turnId: "turn-1",
      status: "completed",
      message: "Done",
      model: "gpt-5",
      host: "Host",
      hostUserId: "github:host",
      createdAt
    }
  },
  {
    kind: "codex.activity",
    call: "codex.activity",
    payload: {
      eventType: "codex.activity",
      activityId: "activity-1",
      turnId: "turn-1",
      itemId: "item-1",
      kind: "command",
      status: "completed",
      title: "Command",
      startedAt: createdAt,
      updatedAt: createdAt,
      host: "Host",
      hostUserId: "github:host"
    }
  },
  {
    kind: "browser.event",
    call: "browser.event",
    payload: {
      requestId: "browser-1",
      status: "approved",
      decidedBy: "Host",
      decidedByUserId: "github:host",
      decidedAt: createdAt
    }
  },
  {
    kind: "workspace.event",
    call: "workspace.event",
    payload: {
      requestId: "workspace-1",
      status: "denied",
      decidedBy: "Host",
      decidedByUserId: "github:host",
      decidedAt: createdAt
    }
  }
] as const;

test("authoritative activity requires both the active host user and device", async () => {
  for (const event of authoritativeEvents) {
    const rejected = recordingStore();
    assert.equal(
      await routeActivityMessage(
        envelope(event.kind, "github:host", "device-member"),
        rejected.store,
        async () => event.payload
      ),
      true
    );
    assert.equal(rejected.calls[event.call] ?? 0, 0, `${event.kind} accepted a non-host device`);

    const accepted = recordingStore();
    assert.equal(await routeActivityMessage(envelope(event.kind), accepted.store, async () => event.payload), true);
    assert.equal(accepted.calls[event.call] ?? 0, 1, `${event.kind} rejected the active host device`);
  }
});

const memberEvents = [
  {
    kind: "terminal.request",
    call: "terminal.request",
    payload: {
      id: "terminal-1",
      requester: "Member",
      requesterUserId: "github:member",
      command: "npm test",
      cwd: "/workspace",
      requestedAt: createdAt
    }
  },
  {
    kind: "browser.request",
    call: "browser.request",
    payload: {
      id: "browser-1",
      requester: "Member",
      requesterUserId: "github:member",
      url: "https://example.com",
      reason: "Inspect documentation",
      requestedAt: createdAt
    }
  },
  {
    kind: "workspace.request",
    call: "workspace.request",
    payload: {
      eventType: "workspace.file.save",
      id: "workspace-1",
      requester: "Member",
      requesterUserId: "github:member",
      path: "README.md",
      previousContent: "old",
      nextContent: "new",
      requestedAt: createdAt
    }
  },
  {
    kind: "codex.queue",
    call: "codex.queue",
    payload: {
      eventType: "codex.queue",
      queueEventId: "queue-1",
      turnId: "turn-1",
      action: "queued",
      requestedBy: "Member",
      requestedByUserId: "github:member",
      queuePosition: 1,
      queueSize: 1,
      createdAt
    }
  }
] as const;

test("member request and queue activity remains authorized by the envelope member", async () => {
  for (const event of memberEvents) {
    const recorded = recordingStore();
    assert.equal(
      await routeActivityMessage(
        envelope(event.kind, "github:member", "device-member"),
        recorded.store,
        async () => event.payload
      ),
      true
    );
    assert.equal(recorded.calls[event.call] ?? 0, 1, `${event.kind} did not retain member authorization`);
  }
});
