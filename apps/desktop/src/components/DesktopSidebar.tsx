import {
  Archive,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  FolderGit2,
  Github,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UsersRound,
  X
} from "lucide-react";
import React, { useState } from "react";
import type { GitHubAuthConfig, GitHubDeviceStart, SignedInUser } from "../lib/authClient";
import { useThemeMode } from "../hooks/useThemeMode";

const brandIcon = new URL("../assets/multaiplayer-icon.png", import.meta.url).href;

export type SidebarPanelName = "profile" | "settings" | null;
export type ThemeMode = "light" | "dark";

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

interface SidebarAccountSectionProps {
  currentUser: SignedInUser | null;
  authBusy: boolean;
  authConfig: GitHubAuthConfig | null;
  authError: string | null;
  deviceFlow: GitHubDeviceStart | null;
  sidebarQuery: string;
  workspaceError: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onSidebarQueryChange: (query: string) => void;
  onClearSidebarQuery: () => void;
}

function SidebarAccountSection({
  currentUser,
  authBusy,
  authConfig,
  authError,
  deviceFlow,
  sidebarQuery,
  workspaceError,
  onSignIn,
  onSignOut,
  onSidebarQueryChange,
  onClearSidebarQuery
}: SidebarAccountSectionProps) {
  return (
    <>
      <div className="brand">
        <img className="brand-mark" src={brandIcon} alt="" />
        <div>
          <strong>multAIplayer</strong>
          <span>group chat for Codex</span>
        </div>
      </div>
      {currentUser ? (
        <div className="profile-card">
          {currentUser.avatarUrl ? <img src={currentUser.avatarUrl} alt="" /> : <Github size={18} />}
          <div>
            <strong>{currentUser.name ?? currentUser.login}</strong>
            <span>@{currentUser.login}</span>
          </div>
          <button onClick={onSignOut}>Sign out</button>
        </div>
      ) : (
        <button className="github-button" onClick={onSignIn} disabled={authBusy || authConfig?.configured === false}>
          <Github size={16} />
          {authConfig?.configured === false
            ? "GitHub sign-in not configured"
            : authBusy
              ? "Waiting for GitHub"
              : "Sign in with GitHub"}
        </button>
      )}
      {deviceFlow && (
        <div className="device-flow">
          <span>Enter this code on GitHub</span>
          <strong>{deviceFlow.user_code}</strong>
          <a href={deviceFlow.verification_uri} target="_blank" rel="noreferrer">
            Open GitHub <ExternalLink size={13} />
          </a>
        </div>
      )}
      {authError && <div className="auth-error">{authError}</div>}
      <label className="search-box">
        <Search size={16} />
        <input
          placeholder="Search rooms, projects, chats"
          value={sidebarQuery}
          onChange={(event) => onSidebarQueryChange(event.target.value)}
        />
        {sidebarQuery && (
          <button onClick={onClearSidebarQuery} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </label>
      {workspaceError && <div className="workspace-error">{workspaceError}</div>}
    </>
  );
}

interface SidebarTeamGroupProps {
  team: SidebarTeamDisplay;
  rooms: SidebarRoomDisplay[];
  collapsed: boolean;
  showArchived: boolean;
  searchActive: boolean;
  onToggleCollapsed: () => void;
  onSelectTeam: (teamId: string) => void;
  onSelectRoom: (roomId: string, teamId?: string) => void;
  onSetTeamLifecycle: DesktopSidebarProps["onSetTeamLifecycle"];
  onSetRoomLifecycle: DesktopSidebarProps["onSetRoomLifecycle"];
}

function SidebarTeamGroup({
  team,
  rooms,
  collapsed,
  showArchived,
  searchActive,
  onToggleCollapsed,
  onSelectTeam,
  onSelectRoom,
  onSetTeamLifecycle,
  onSetRoomLifecycle
}: SidebarTeamGroupProps) {
  const confirmDelete = (kind: "team" | "room", name: string) =>
    window.confirm(
      `Delete ${name}?\n\nThis removes the ${kind} ${kind === "team" ? "and its rooms " : ""}from the workspace. It does not erase local copies or ciphertext already received by devices.`
    );
  return (
    <div className="team-group">
      <div className={`team-button ${team.active ? "active" : ""}`}>
        <button
          type="button"
          className="team-disclosure"
          aria-label={collapsed ? `Expand ${team.name}` : `Collapse ${team.name}`}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <button
          type="button"
          className="team-select"
          title={`${team.name} · ${team.meta}`}
          onClick={() => onSelectTeam(team.id)}
        >
          <UsersRound size={16} />
          <span>
            {team.name}
            {team.archived ? " (archived)" : ""}
          </span>
          <small>{team.meta}</small>
        </button>
        <div className="sidebar-row-actions">
          <button
            type="button"
            className="icon-only"
            aria-label={team.archived ? `Restore ${team.name}` : `Archive ${team.name}`}
            title={team.archived ? "Restore team" : "Archive team"}
            onClick={() => onSetTeamLifecycle(team.id, team.archived ? "restore" : "archive")}
          >
            {team.archived ? <RotateCcw size={13} /> : <Archive size={13} />}
          </button>
          <button
            type="button"
            className="icon-only"
            aria-label={`Delete ${team.name}`}
            title="Delete team"
            onClick={() => confirmDelete("team", team.name) && onSetTeamLifecycle(team.id, "delete")}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="nested-room-list">
          {rooms.map((room) => (
            <button
              key={room.id}
              className={`room-button nested ${room.active ? "active" : ""}`}
              onClick={() => onSelectRoom(room.id, room.teamId)}
              title={`${room.name} · ${room.detail}`}
            >
              <div>
                <strong>
                  {room.name}
                  {room.archived ? " (archived)" : ""}
                </strong>
                <span>{room.detail}</span>
              </div>
              <div className="room-indicators">
                {room.attention > 0 && <b className="attention">{room.attention}</b>}
                {room.unread > 0 ? <b>{room.unread}</b> : room.attention === 0 ? <Circle size={8} /> : null}
              </div>
              <span className="sidebar-row-actions">
                <span
                  role="button"
                  tabIndex={0}
                  className="icon-only"
                  aria-label={room.archived ? `Restore ${room.name}` : `Archive ${room.name}`}
                  title={room.archived ? "Restore room" : "Archive room"}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSetRoomLifecycle(room.id, room.archived ? "restore" : "archive");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onSetRoomLifecycle(room.id, room.archived ? "restore" : "archive");
                    }
                  }}
                >
                  {room.archived ? <RotateCcw size={13} /> : <Archive size={13} />}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className="icon-only"
                  aria-label={`Delete ${room.name}`}
                  title="Delete room"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (confirmDelete("room", room.name)) onSetRoomLifecycle(room.id, "delete");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      if (confirmDelete("room", room.name)) onSetRoomLifecycle(room.id, "delete");
                    }
                  }}
                >
                  <Trash2 size={13} />
                </span>
              </span>
            </button>
          ))}
          {rooms.length === 0 && (
            <div className="sidebar-empty nested-empty">
              {showArchived
                ? "No archived rooms in this team."
                : team.active && !searchActive
                  ? "No rooms yet. Create one for this team."
                  : "No visible rooms."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SidebarFooter({
  activeSidebarPanel,
  onSelectSidebarPanel
}: Pick<DesktopSidebarProps, "activeSidebarPanel" | "onSelectSidebarPanel">) {
  const { themeMode, toggleThemeMode } = useThemeMode();
  return (
    <div className="sidebar-footer">
      <button onClick={toggleThemeMode}>{themeMode === "dark" ? "Light" : "Dark"}</button>
      <button
        className={activeSidebarPanel === "settings" ? "active" : ""}
        onClick={() => onSelectSidebarPanel(activeSidebarPanel === "settings" ? null : "settings")}
      >
        Settings
      </button>
      <button
        className={activeSidebarPanel === "profile" ? "active" : ""}
        onClick={() => onSelectSidebarPanel(activeSidebarPanel === "profile" ? null : "profile")}
      >
        Profile
      </button>
    </div>
  );
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
  selectedTeam: boolean;
  teams: SidebarTeamDisplay[];
  rooms: SidebarRoomDisplay[];
  messageHits: SidebarMessageHitDisplay[];
  historySearchBusy: boolean;
  activeSidebarPanel: SidebarPanelName;
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
  selectedTeam,
  teams,
  rooms,
  messageHits,
  historySearchBusy,
  activeSidebarPanel,
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
  const [roomCreateOpen, setRoomCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [collapsedTeams, setCollapsedTeams] = useState<Record<string, boolean>>({});

  const teamFormVisible = !searchActive && !showArchived && teamCreateOpen;
  const roomFormVisible = !searchActive && !showArchived && roomCreateOpen;
  const visibleTeams = showArchived
    ? teams.filter((team) => team.archived || rooms.some((room) => room.teamId === team.id && room.archived))
    : teams.filter((team) => !team.archived);
  const sectionLabel = searchActive ? "Matching teams" : showArchived ? "Archived" : "Teams";
  const archivedCount = teams.filter((team) => team.archived).length + rooms.filter((room) => room.archived).length;
  const roomsForTeam = (team: SidebarTeamDisplay) =>
    rooms.filter(
      (room) =>
        room.teamId === team.id && (showArchived ? room.archived || team.archived : !room.archived && !team.archived)
    );

  return (
    <aside className="sidebar">
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
        <div className="section-title">
          <span>{sectionLabel}</span>
          {!searchActive && (
            <div className="section-title-actions">
              <button
                onClick={() => {
                  setShowArchived((current) => !current);
                  setTeamCreateOpen(false);
                  setRoomCreateOpen(false);
                }}
                aria-label={showArchived ? "Show active teams" : "Show archived teams and rooms"}
                aria-pressed={showArchived}
                title={showArchived ? "Show active teams" : "Show archived"}
              >
                {showArchived ? <UsersRound size={14} /> : <Archive size={14} />}
              </button>
              {!showArchived && (
                <button
                  onClick={() => setTeamCreateOpen((open) => !open)}
                  aria-label={teamCreateOpen ? "Hide team form" : "New team"}
                  aria-expanded={teamCreateOpen}
                >
                  {teamCreateOpen ? <X size={14} /> : <Plus size={15} />}
                </button>
              )}
            </div>
          )}
        </div>
        {teamFormVisible && (
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
        <div className="team-list nested-team-list">
          {visibleTeams.map((team) => (
            <SidebarTeamGroup
              key={team.id}
              team={team}
              rooms={roomsForTeam(team)}
              collapsed={Boolean(collapsedTeams[team.id])}
              showArchived={showArchived}
              searchActive={searchActive}
              onToggleCollapsed={() => setCollapsedTeams((current) => ({ ...current, [team.id]: !current[team.id] }))}
              onSelectTeam={(teamId) => {
                onSelectTeam(teamId);
                setCollapsedTeams((current) => ({ ...current, [teamId]: false }));
              }}
              onSelectRoom={onSelectRoom}
              onSetTeamLifecycle={onSetTeamLifecycle}
              onSetRoomLifecycle={onSetRoomLifecycle}
            />
          ))}
          {visibleTeams.length === 0 && (
            <div className="sidebar-empty">
              {searchActive
                ? "No teams found."
                : showArchived
                  ? archivedCount === 0
                    ? "No archived teams or rooms."
                    : "No archived teams found."
                  : "No teams yet. Create one to start."}
            </div>
          )}
        </div>
      </section>

      {!showArchived && (
        <section className="sidebar-section rooms room-create-section">
          <div className="section-title">
            <span>New room</span>
            {!searchActive && (
              <button
                onClick={() => setRoomCreateOpen((open) => !open)}
                aria-label={roomCreateOpen ? "Hide room form" : "New room"}
                aria-expanded={roomCreateOpen}
                disabled={!selectedTeam}
              >
                {roomCreateOpen ? <X size={14} /> : <Plus size={15} />}
              </button>
            )}
          </div>
          {roomFormVisible && (
            <div className="sidebar-create-form room-create-form">
              <input
                value={newRoomName}
                onChange={(event) => onNewRoomNameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && newRoomName.trim() && newRoomProjectPath.trim()) {
                    event.preventDefault();
                    onCreateRoom();
                  }
                }}
                placeholder="Room name"
                disabled={!selectedTeam}
              />
              <div className="path-create-row">
                <input
                  value={newRoomProjectPath}
                  onChange={(event) => onNewRoomProjectPathChange(event.target.value)}
                  placeholder={defaultProjectPath}
                  disabled={!selectedTeam}
                />
                <button
                  onClick={onChooseNewRoomProjectPath}
                  disabled={!selectedTeam}
                  aria-label="Choose project folder"
                >
                  <FolderGit2 size={14} />
                </button>
              </div>
              <button
                onClick={onCreateRoom}
                disabled={!selectedTeam || !newRoomName.trim() || !newRoomProjectPath.trim()}
              >
                Create room
              </button>
            </div>
          )}
          {!roomFormVisible && !searchActive && (
            <div className="sidebar-empty">
              {selectedTeam ? "Create a room inside the selected team." : "Create a team before adding rooms."}
            </div>
          )}
        </section>
      )}

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

      <SidebarFooter activeSidebarPanel={activeSidebarPanel} onSelectSidebarPanel={onSelectSidebarPanel} />
    </aside>
  );
}
