import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHighPrivilegeLabels,
  buildProjectControlState,
  buildQueuedCodexTurnRows,
  buildRoomBrowserProps,
  resolveSidebarSettingsMessage
} from "../src/presentation/containers/containerPropBuilders";
import {
  selectRoomInspectorView,
  selectRoomMainColumnView,
  selectSidebarDrawerView,
  selectSidebarNavigationView
} from "../src/application/views/containerViewSelectors";
import { useAppStore } from "../src/store/appStore";

test.beforeEach(() => useAppStore.getState().resetAppStore());

test("container selectors represent an empty workspace without fabricating a room", () => {
  const state = useAppStore.getState();
  const inspector = selectRoomInspectorView(state);
  const main = selectRoomMainColumnView(state);
  const drawer = selectSidebarDrawerView(state);
  const navigation = selectSidebarNavigationView(state);

  assert.equal(inspector.selectedRoom, null);
  assert.equal(main.selectedRoom, null);
  assert.equal(drawer.selectedRoom, null);
  assert.equal(inspector.hasSelectedRoom, false);
  assert.equal(main.hasSelectedRoom, false);
  assert.equal(drawer.hasSelectedRoom, false);
  assert.equal(inspector.inspectorTab, "files");
  assert.deepEqual(main.messages, []);
  assert.equal(navigation.rooms, state.rooms);
  assert.equal(navigation.setSidebarQuery, state.setSidebarQuery);
});

test("project control builder applies host, lock, and unchanged-path gates", () => {
  const base = {
    hasSelectedRoom: true,
    roomLocked: false,
    settingsBusy: false,
    activeHost: true,
    projectPathDraft: "/repo",
    projectPath: "/old"
  };
  assert.deepEqual(buildProjectControlState(base), { disabled: false, attachDisabled: false });
  assert.equal(buildProjectControlState({ ...base, roomLocked: true }).attachDisabled, true);
  assert.equal(buildProjectControlState({ ...base, projectPathDraft: "/old" }).attachDisabled, true);
});

test("room main prop builders preserve privilege order and cancellation policy", () => {
  assert.deepEqual(
    buildHighPrivilegeLabels(
      { attachments: [{}], workspacePath: "/repo", git: null, browserAccess: [{}], terminals: [{}] },
      "danger_full_access"
    ),
    ["full-access Codex", "terminal context", "workspace/Git context", "browser context", "attachments"]
  );
  const turns = buildQueuedCodexTurnRows(
    [{ turnId: "turn-1", requestedBy: "Maddie", requestedByUserId: "user-1", queuedAt: "now" }],
    3,
    false,
    "user-1",
    "host-1"
  );
  assert.equal(turns[0]?.canCancel, true);
  assert.equal(turns[0]?.messagesSinceLastCodex, 3);
});

test("sidebar settings message keeps established precedence", () => {
  assert.equal(resolveSidebarSettingsMessage(null, "room", "history"), "room");
  assert.equal(resolveSidebarSettingsMessage(undefined, null), null);
});

test("browser prop builder scopes edits and tab actions to the selected room", () => {
  const calls: string[] = [];
  const props = buildRoomBrowserProps({
    roomId: "room-1",
    browser: { activeTabId: "tab-1", tabs: [{ id: "tab-1", url: "https://example.com", title: "Example" }] },
    defaultUrl: "https://openai.com",
    canHostBrowser: true,
    setUrl: (roomId, url) => calls.push(`url:${roomId}:${url}`),
    openNow: () => calls.push("open"),
    approveRequest: (request) => calls.push(`approve:${request.id}`),
    denyRequest: (requestId) => calls.push(`deny:${requestId}`),
    openApprovedRequest: (request) => calls.push(`approved-open:${request.id}`),
    selectTab: (roomId, tabId) => calls.push(`select:${roomId}:${tabId}`),
    closeTab: (roomId, tabId) => calls.push(`close:${roomId}:${tabId}`)
  });
  assert.equal(props.activeBrowserUrl, "https://example.com");
  props.onBrowserUrlChange("https://github.com");
  props.onSelectBrowserTab("tab-2");
  props.onCloseBrowserTab("tab-1");
  assert.deepEqual(calls, ["url:room-1:https://github.com", "select:room-1:tab-2", "close:room-1:tab-1"]);
});
