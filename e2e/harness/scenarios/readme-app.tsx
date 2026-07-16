import React from "react";
import { AppWorkspaceShell } from "../../../apps/desktop/src/components/AppWorkspaceShell";
import { CodexActivityTimelineView } from "../../../apps/desktop/src/components/CodexActivityTimeline";
import { RoomMainColumn } from "../../../apps/desktop/src/components/RoomMainColumn";
import { SidebarAccountSection } from "../../../apps/desktop/src/components/SidebarAccountSection";
import { SidebarTeamGroup, SidebarTeamsTitle } from "../../../apps/desktop/src/components/DesktopSidebarSections";
import { readmeActivities, readmeChatProps } from "./readme-chat";

export const description = "The production desktop shell shows a shared Codex room actively in use.";
export const mockedBoundaries = ["relay workspace", "Codex app-server", "native project tools"] as const;

const noop = () => undefined;

function ReadmeSidebar() {
  return (
    <aside className="sidebar">
      <SidebarAccountSection
        currentUser={{ id: "github:avery", login: "avery", name: "Avery" }}
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
          teamCreateOpen={false}
          onToggleArchived={noop}
          onToggleTeamCreate={noop}
        />
        <div className="team-list nested-team-list">
          <SidebarTeamGroup
            team={{ id: "northstar", name: "Northstar", meta: "3 members", active: true, archived: false }}
            rooms={[
              {
                id: "responsive-launch",
                teamId: "northstar",
                name: "Responsive launch",
                detail: "Avery hosting",
                active: true,
                attention: 0,
                unread: 0,
                archived: false
              },
              {
                id: "api-review",
                teamId: "northstar",
                name: "API review",
                detail: "Maya hosting",
                active: false,
                attention: 1,
                unread: 2,
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
          <SidebarTeamGroup
            team={{ id: "studio", name: "Design studio", meta: "2 members", active: false, archived: false }}
            rooms={[
              {
                id: "release-notes",
                teamId: "studio",
                name: "Release notes",
                detail: "Jordan hosting",
                active: false,
                attention: 0,
                unread: 0,
                archived: false
              }
            ]}
            collapsed
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
              teams: [{ id: "northstar", name: "Northstar" }],
              selectedTeamId: "northstar",
              roomName: "Responsive launch",
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
            chatProps={readmeChatProps}
          />
        }
        inspector={
          <aside className="inspector readme-app-inspector" aria-label="Room context">
            <div className="inspector-context">
              <span>Shared work</span>
              <strong>Live with 3 teammates</strong>
            </div>
            <CodexActivityTimelineView activities={readmeActivities} />
            <section className="panel readme-project-summary">
              <span>Project</span>
              <strong>northstar-web</strong>
              <small>2 files changed · checks passed</small>
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
