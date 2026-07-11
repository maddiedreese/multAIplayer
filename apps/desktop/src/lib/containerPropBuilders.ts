import { defaultCodexSandboxLevel } from "@multaiplayer/protocol";
import type { ComponentProps } from "react";
import type { BrowserAccessPanel } from "../components/BrowserAccessPanel";
import type { RoomInspectorWorkPanel } from "../components/RoomInspectorWorkPanel";
import type { RoomMainColumn } from "../components/RoomMainColumn";

type InspectorWorkProps = Omit<ComponentProps<typeof RoomInspectorWorkPanel>, "activeTab">;
type BrowserPanelProps = ComponentProps<typeof BrowserAccessPanel>;
type RoomMainProps = ComponentProps<typeof RoomMainColumn>;

export function buildRoomMainHeaderProps(props: RoomMainProps["headerProps"]): RoomMainProps["headerProps"] {
  return props;
}

export function buildRoomMainChatProps(props: RoomMainProps["chatProps"]): RoomMainProps["chatProps"] {
  return props;
}

export function buildRoomInspectorWorkProps(props: InspectorWorkProps): InspectorWorkProps {
  return props;
}

export function buildRoomBrowserProps(input: {
  roomId: string;
  browser: {
    activeUrl?: string | null;
    activeTabId?: string | null;
    url?: string;
    tabs?: BrowserPanelProps["browserTabs"];
  };
  defaultUrl: string;
  canHostBrowser: boolean;
  setUrl: (roomId: string, url: string, fallbackUrl: string) => void;
  openNow: () => void;
  selectTab: (roomId: string, tabId: string) => void;
  closeTab: (roomId: string, tabId: string) => void;
}): BrowserPanelProps {
  return {
    hidden: false,
    activeBrowserUrl:
      input.browser.tabs?.find((tab) => tab.id === input.browser.activeTabId)?.url ?? input.browser.activeUrl ?? null,
    browserTabs: input.browser.tabs ?? [],
    activeBrowserTabId: input.browser.activeTabId ?? null,
    browserUrl: input.browser.url ?? input.defaultUrl,
    canHostBrowser: input.canHostBrowser,
    onBrowserUrlChange: (url) => input.setUrl(input.roomId, url, input.defaultUrl),
    onOpenBrowserNow: input.openNow,
    onSelectBrowserTab: (tabId) => input.selectTab(input.roomId, tabId),
    onCloseBrowserTab: (tabId) => input.closeTab(input.roomId, tabId)
  };
}

export function buildHighPrivilegeLabels(
  summary:
    | {
        attachments: unknown[];
        workspacePath: string | null;
        git: unknown | null;
        browserAccess: unknown[];
        terminals: unknown[];
      }
    | undefined,
  sandboxLevel: string | undefined
): string[] {
  if (!summary) return [];
  const labels: string[] = [];
  if ((sandboxLevel ?? defaultCodexSandboxLevel) === "danger_full_access") labels.push("full-access Codex");
  if (summary.terminals.length > 0) labels.push("terminal context");
  if (summary.workspacePath || summary.git) labels.push("workspace/Git context");
  if (summary.browserAccess.length > 0) labels.push("browser context");
  if (summary.attachments.length > 0) labels.push("attachments");
  return labels;
}

export function buildQueuedCodexTurnRows<
  T extends { turnId: string; requestedBy: string; requestedByUserId: string; queuedAt: string }
>(turns: T[], messagesSinceLastCodex: number, roomLocked: boolean, localUserId: string, hostUserId?: string) {
  return turns.map((turn) => ({
    turnId: turn.turnId,
    requestedBy: turn.requestedBy,
    requestedByUserId: turn.requestedByUserId,
    queuedAt: turn.queuedAt,
    messagesSinceLastCodex,
    canCancel: !roomLocked && (turn.requestedByUserId === localUserId || hostUserId === localUserId)
  }));
}

export function buildProjectControlState(input: {
  hasSelectedRoom: boolean;
  roomLocked: boolean;
  settingsBusy: boolean;
  activeHost: boolean;
  projectPathDraft: string;
  projectPath: string;
}) {
  const disabled = !input.hasSelectedRoom || input.roomLocked || input.settingsBusy || !input.activeHost;
  return {
    disabled,
    attachDisabled: disabled || !input.projectPathDraft.trim() || input.projectPathDraft.trim() === input.projectPath
  };
}

export function resolveSidebarSettingsMessage(...messages: Array<string | null | undefined>): string | null {
  return messages.find((message): message is string => message != null) ?? null;
}
