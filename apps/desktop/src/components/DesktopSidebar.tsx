import React, { useState, type ReactNode } from "react";
import type { GitHubAuthConfig, GitHubDeviceStart, SignedInUser } from "../lib/identity/authClient";
import type { SidebarPanelName, ThemeMode } from "../lib/core/uiTypes";
import { SidebarAccountSection } from "./SidebarAccountSection";
import {
  SidebarFooter,
  SidebarTeamGroup,
  SidebarTeamsTitle,
  sidebarTeamEmptyMessage,
  visibleSidebarRooms,
  visibleSidebarTeams
} from "./DesktopSidebarSections";

export type { SidebarPanelName };
export type { ThemeMode };

export interface SidebarTeamDisplay {
  id: string;
  name: string;
  meta: string;
  active: boolean;
  archived: boolean;
}

export interface SidebarRoomDisplay {
  id: string;
  teamId: string;
  name: string;
  detail: string;
  active: boolean;
  attention: number;
  unread: number;
  archived: boolean;
}

export interface SidebarMessageHitDisplay {
  key: string;
  roomId: string;
  teamId?: string;
  author: string;
  preview: string;
}

export interface DesktopSidebarProps {
  currentUser: SignedInUser | null;
  authBusy: boolean;
  authConfig: GitHubAuthConfig | null;
  authError: string | null;
  deviceFlow: GitHubDeviceStart | null;
  sidebarQuery: string;
  searchActive: boolean;
  workspaceError: string | null;
  newTeamName: string;
  newRoomName: string;
  newRoomProjectPath: string;
  defaultProjectPath: string;
  teams: SidebarTeamDisplay[];
  rooms: SidebarRoomDisplay[];
  messageHits: SidebarMessageHitDisplay[];
  historySearchBusy: boolean;
  activeSidebarPanel: SidebarPanelName;
  setupChecklist?: ReactNode;
  onSignIn: () => void;
  onSignOut: () => void;
  onSidebarQueryChange: (query: string) => void;
  onClearSidebarQuery: () => void;
  onNewTeamNameChange: (name: string) => void;
  onCreateTeam: () => void;
  onSelectTeam: (teamId: string) => void;
  onNewRoomNameChange: (name: string) => void;
  onNewRoomProjectPathChange: (path: string) => void;
  onChooseNewRoomProjectPath: () => void;
  onCreateRoom: () => void;
  onSelectRoom: (roomId: string, teamId?: string) => void;
  onSetTeamLifecycle: (teamId: string, action: "archive" | "restore" | "delete") => void;
  onSetRoomLifecycle: (roomId: string, action: "archive" | "restore" | "delete") => void;
  onSelectSidebarPanel: (panel: SidebarPanelName) => void;
}

function visibleTeamsSection(collapsed: boolean, searchActive: boolean): boolean {
  return !collapsed || searchActive;
}

function visibleTeamForm(formVisible: boolean, teamsSectionVisible: boolean): boolean {
  return formVisible && teamsSectionVisible;
}

export function DesktopSidebar({
  currentUser,
  authBusy,
  authConfig,
  authError,
  deviceFlow,
  sidebarQuery,
  searchActive,
  workspaceError,
  newTeamName,
  newRoomName,
  newRoomProjectPath,
  defaultProjectPath,
  teams,
  rooms,
  messageHits,
  historySearchBusy,
  activeSidebarPanel,
  setupChecklist,
  onSignIn,
  onSignOut,
  onSidebarQueryChange,
  onClearSidebarQuery,
  onNewTeamNameChange,
  onCreateTeam,
  onSelectTeam,
  onNewRoomNameChange,
  onNewRoomProjectPathChange,
  onChooseNewRoomProjectPath,
  onCreateRoom,
  onSelectRoom,
  onSetTeamLifecycle,
  onSetRoomLifecycle,
  onSelectSidebarPanel
}: DesktopSidebarProps) {
  const [teamCreateOpen, setTeamCreateOpen] = useState(false);
  const [roomCreateTeamId, setRoomCreateTeamId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [teamsCollapsed, setTeamsCollapsed] = useState(false);
  const [collapsedTeams, setCollapsedTeams] = useState<Record<string, boolean>>({});

  const teamFormVisible = !searchActive && !showArchived && teamCreateOpen;
  const visibleTeams = visibleSidebarTeams(teams, rooms, showArchived);
  const teamsSectionVisible = visibleTeamsSection(teamsCollapsed, searchActive);
  const showTeamForm = visibleTeamForm(teamFormVisible, teamsSectionVisible);
  const archivedCount = teams.filter((team) => team.archived).length + rooms.filter((room) => room.archived).length;
  const roomsForTeam = (team: SidebarTeamDisplay) => visibleSidebarRooms(rooms, team, showArchived);

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <SidebarAccountSection
          currentUser={currentUser}
          authBusy={authBusy}
          authConfig={authConfig}
          authError={authError}
          deviceFlow={deviceFlow}
          sidebarQuery={sidebarQuery}
          workspaceError={workspaceError}
          onSignIn={onSignIn}
          onSignOut={onSignOut}
          onSidebarQueryChange={onSidebarQueryChange}
          onClearSidebarQuery={onClearSidebarQuery}
        />

        <section className="sidebar-section">
          <SidebarTeamsTitle
            searchActive={searchActive}
            showArchived={showArchived}
            collapsed={!teamsSectionVisible}
            teamCreateOpen={teamCreateOpen}
            onToggleCollapsed={() => setTeamsCollapsed((current) => !current)}
            onToggleArchived={() => {
              setShowArchived((current) => !current);
              setTeamCreateOpen(false);
              setRoomCreateTeamId(null);
            }}
            onToggleTeamCreate={() => {
              setTeamsCollapsed(false);
              setTeamCreateOpen((open) => !open);
            }}
          />
          {showTeamForm && (
            <div className="sidebar-create-form">
              <input
                value={newTeamName}
                onChange={(event) => onNewTeamNameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && newTeamName.trim()) {
                    event.preventDefault();
                    onCreateTeam();
                  }
                }}
                placeholder="Team name"
              />
              <button onClick={onCreateTeam} disabled={!newTeamName.trim()}>
                Create team
              </button>
            </div>
          )}
          <div className="team-list nested-team-list" hidden={!teamsSectionVisible}>
            {visibleTeams.map((team) => (
              <SidebarTeamGroup
                key={team.id}
                team={team}
                rooms={roomsForTeam(team)}
                collapsed={Boolean(collapsedTeams[team.id])}
                showArchived={showArchived}
                searchActive={searchActive}
                roomCreateOpen={roomCreateTeamId === team.id}
                newRoomName={newRoomName}
                newRoomProjectPath={newRoomProjectPath}
                defaultProjectPath={defaultProjectPath}
                onToggleCollapsed={() => setCollapsedTeams((current) => ({ ...current, [team.id]: !current[team.id] }))}
                onToggleRoomCreate={() => {
                  onSelectTeam(team.id);
                  setCollapsedTeams((current) => ({ ...current, [team.id]: false }));
                  setRoomCreateTeamId((current) => (current === team.id ? null : team.id));
                }}
                onSelectTeam={(teamId) => {
                  onSelectTeam(teamId);
                  setCollapsedTeams((current) => ({ ...current, [teamId]: false }));
                }}
                onNewRoomNameChange={onNewRoomNameChange}
                onNewRoomProjectPathChange={onNewRoomProjectPathChange}
                onChooseNewRoomProjectPath={onChooseNewRoomProjectPath}
                onCreateRoom={onCreateRoom}
                onSelectRoom={onSelectRoom}
                onSetTeamLifecycle={onSetTeamLifecycle}
                onSetRoomLifecycle={onSetRoomLifecycle}
              />
            ))}
            {visibleTeams.length === 0 && (
              <div className="sidebar-empty">{sidebarTeamEmptyMessage(searchActive, showArchived, archivedCount)}</div>
            )}
          </div>
        </section>

        {searchActive && (
          <section className="sidebar-section">
            <div className="section-title">
              <span>Chat hits</span>
            </div>
            <div className="message-hit-list">
              {messageHits.map((hit) => (
                <button key={hit.key} onClick={() => onSelectRoom(hit.roomId, hit.teamId)}>
                  <strong>{hit.author}</strong>
                  <span>{hit.preview}</span>
                </button>
              ))}
              {messageHits.length === 0 && (
                <div className="sidebar-empty">
                  {historySearchBusy ? "Searching encrypted local history..." : "No chat or local history matches."}
                </div>
              )}
            </div>
          </section>
        )}

        {setupChecklist}
      </div>
      <SidebarFooter activeSidebarPanel={activeSidebarPanel} onSelectSidebarPanel={onSelectSidebarPanel} />
    </aside>
  );
}
