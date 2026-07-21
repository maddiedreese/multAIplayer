import React from "react";
import { AppWorkspaceShell } from "../../../apps/desktop/src/components/AppWorkspaceShell";
import { CodexActivityTimelineView } from "../../../apps/desktop/src/components/CodexActivityTimeline";
import { RoomMainColumn } from "../../../apps/desktop/src/components/RoomMainColumn";
import { SidebarAccountSection } from "../../../apps/desktop/src/components/SidebarAccountSection";
import { SidebarTeamGroup, SidebarTeamsTitle } from "../../../apps/desktop/src/components/DesktopSidebarSections";
import type { RoomChatMessageDisplay } from "../../../apps/desktop/src/components/RoomChatPanel";
import type { CodexActivity } from "../../../apps/desktop/src/types";
import { readmeChatProps } from "./readme-chat";

export const description = "The production desktop shell shows a shared Codex room actively in use.";
export const mockedBoundaries = ["relay workspace", "Codex app-server", "native project tools"] as const;

const noop = () => undefined;
const capturedAt = "2026-07-15T18:00:00.000Z";
const appMessages: RoomChatMessageDisplay[] = [
  {
    id: "handoff-request",
    author: "Maya",
    role: "human",
    body: "Ready to hand the project to Jordan after this pass?",
    time: "11:42",
    selected: false,
    attachments: [],
    reactions: [{ emoji: "👍", count: 2, reacted: true }]
  },
  {
    id: "handoff-result",
    author: "Codex via Avery",
    role: "codex",
    body: "Handoff checks are green. I added device verification and preserved the shared room history.",
    time: "11:44",
    selected: false,
    attachments: [],
    reactions: []
  }
];
const appActivities: CodexActivity[] = [
  {
    eventType: "codex.activity",
    activityId: "verified-handoff",
    turnId: "app-readme-turn",
    itemId: "verified-handoff",
    kind: "file_change",
    status: "completed",
    title: "Prepared verified host handoff",
    startedAt: capturedAt,
    updatedAt: capturedAt,
    host: "Avery",
    hostUserId: "github:avery"
  }
];
const appChatProps = {
  ...readmeChatProps,
  messages: appMessages,
  codexActivities: appActivities
};

function ReadmeSidebar() {
  return (
    <aside className="sidebar">
      <SidebarAccountSection
        currentUser={{ id: "github:av", login: "av", name: "Avery" }}
        authBusy={false}
        authConfig={null}
        authError={null}
        deviceFlow={null}
        sidebarQuery=""
        workspaceError={null}
        onSignIn={noop}
        onSignOut={noop}
        onSidebarQueryChange={noop}
        onClearSidebarQuery={noop}
      />
      <section className="sidebar-section">
        <SidebarTeamsTitle
          searchActive={false}
          showArchived={false}
          collapsed={false}
          teamCreateOpen={false}
          onToggleCollapsed={noop}
          onToggleArchived={noop}
          onToggleTeamCreate={noop}
        />
        <div className="team-list nested-team-list">
          <SidebarTeamGroup
            team={{ id: "studio", name: "Studio", meta: "3 members", active: true, archived: false }}
            rooms={[
              {
                id: "launch",
                teamId: "studio",
                name: "Launch",
                detail: "Avery",
                active: true,
                attention: 0,
                unread: 0,
                archived: false
              }
            ]}
            collapsed={false}
            showArchived={false}
            searchActive={false}
            onToggleCollapsed={noop}
            onSelectTeam={noop}
            onSelectRoom={noop}
            onSetTeamLifecycle={noop}
            onSetRoomLifecycle={noop}
          />
        </div>
      </section>
    </aside>
  );
}

export default function ReadmeAppScenario() {
  return (
    <section className="readme-app-surface" data-readme-capture aria-label="multAIplayer desktop app in use">
      <AppWorkspaceShell
        sidebarCollapsed={false}
        inspectorCollapsed={false}
        shellStyle={{}}
        sidebar={<ReadmeSidebar />}
        drawer={null}
        main={
          <RoomMainColumn
            headerProps={{
              teams: [{ id: "studio", name: "Studio" }],
              selectedTeamId: "studio",
              roomName: "Launch",
              hostStatus: "active",
              hostBusy: false,
              isActiveHost: true,
              roomLocked: false,
              hasRoom: true,
              selectedModel: "gpt-5.2-codex",
              modelLabel: "GPT-5.2 Codex",
              modelOptions: [{ id: "gpt-5.2-codex", label: "GPT-5.2 Codex" }],
              selectedReasoningEffort: "high",
              reasoningLabel: "High",
              reasoningOptions: [{ id: "high", label: "High" }],
              selectedSpeed: "standard",
              speedLabel: "Standard",
              speedOptions: [{ id: "standard", label: "Standard" }],
              settingsBusy: false,
              selectedCount: 0,
              markdownSelectionMode: false,
              activeInspectorTab: "room",
              onSetHost: noop,
              onSelectTeam: noop,
              onRenameRoom: noop,
              onSelectModel: noop,
              onSelectReasoningEffort: noop,
              onSelectSpeed: noop,
              onSelectInspectorTab: noop,
              onCopyRoomMarkdown: noop,
              onCopySelectedMarkdown: noop,
              onToggleMarkdownSelection: noop,
              onClearSelectedMessages: noop,
              onShareLocalPreview: noop
            }}
            statusProps={{
              notices: [],
              secretWarningVisible: false,
              lockedMessage: null,
              onAcknowledgeSecretWarning: noop
            }}
            markdownFallbackProps={null}
            chatProps={appChatProps}
          />
        }
        inspector={
          <aside className="inspector readme-app-inspector" aria-label="Room context">
            <div className="inspector-context">
              <span>Shared work</span>
              <strong>Live with 3 teammates</strong>
            </div>
            <CodexActivityTimelineView activities={appActivities} />
            <section className="panel readme-project-summary">
              <span>Project</span>
              <strong>launch-kit</strong>
              <small>3 files changed · checks passed</small>
            </section>
          </aside>
        }
        dialog={null}
        onBeginSidebarResize={noop}
        onBeginInspectorResize={noop}
        onToggleSidebarCollapsed={noop}
        onToggleInspectorCollapsed={noop}
      />
    </section>
  );
}
