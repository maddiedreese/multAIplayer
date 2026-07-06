import {
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  FolderGit2,
  Github,
  Plus,
  Search,
  UsersRound,
  X
} from "lucide-react";
import { useState } from "react";
import brandIcon from "../assets/multaiplayer-icon.png";
import type { GitHubAuthConfig, GitHubDeviceStart, SignedInUser } from "../lib/authClient";

export type SidebarPanelName = "profile" | "settings" | null;
export type ThemeMode = "light" | "dark";

export interface SidebarTeamDisplay {
  id: string;
  name: string;
  meta: string;
  active: boolean;
}

export interface SidebarRoomDisplay {
  id: string;
  teamId: string;
  name: string;
  detail: string;
  active: boolean;
  attention: number;
  unread: number;
}

export interface SidebarMessageHitDisplay {
  key: string;
  roomId: string;
  teamId?: string;
  author: string;
  preview: string;
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
  themeMode,
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
  onSelectSidebarPanel,
  onToggleTheme
}: {
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
  themeMode: ThemeMode;
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
  onSelectSidebarPanel: (panel: SidebarPanelName) => void;
  onToggleTheme: () => void;
}) {
  const [teamCreateOpen, setTeamCreateOpen] = useState(false);
  const [roomCreateOpen, setRoomCreateOpen] = useState(false);
  const [collapsedTeams, setCollapsedTeams] = useState<Record<string, boolean>>({});

  const teamFormVisible = !searchActive && teamCreateOpen;
  const roomFormVisible = !searchActive && roomCreateOpen;

  return (
    <aside className="sidebar">
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
          {authConfig?.configured === false ? "GitHub sign-in not configured" : authBusy ? "Waiting for GitHub" : "Sign in with GitHub"}
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

      <section className="sidebar-section">
        <div className="section-title">
          <span>{searchActive ? "Matching teams" : "Teams"}</span>
          {!searchActive && (
            <button
              onClick={() => setTeamCreateOpen((open) => !open)}
              aria-label={teamCreateOpen ? "Hide team form" : "New team"}
              aria-expanded={teamCreateOpen}
            >
              {teamCreateOpen ? <X size={14} /> : <Plus size={15} />}
            </button>
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
          {teams.map((team) => (
            <div className="team-group" key={team.id}>
              <div className={`team-button ${team.active ? "active" : ""}`}>
                <button
                  type="button"
                  className="team-disclosure"
                  aria-label={collapsedTeams[team.id] ? `Expand ${team.name}` : `Collapse ${team.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setCollapsedTeams((current) => ({ ...current, [team.id]: !current[team.id] }));
                  }}
                >
                  {collapsedTeams[team.id] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
                <button
                  type="button"
                  className="team-select"
                  onClick={() => {
                    onSelectTeam(team.id);
                    setCollapsedTeams((current) => ({ ...current, [team.id]: false }));
                  }}
                >
                  <UsersRound size={16} />
                  <span>{team.name}</span>
                  <small>{team.meta}</small>
                </button>
              </div>
              {!collapsedTeams[team.id] && (
                <div className="nested-room-list">
                  {rooms.filter((room) => room.teamId === team.id).map((room) => (
                    <button
                      key={room.id}
                      className={`room-button nested ${room.active ? "active" : ""}`}
                      onClick={() => onSelectRoom(room.id, room.teamId)}
                    >
                      <div>
                        <strong>{room.name}</strong>
                        <span>{room.detail}</span>
                      </div>
                      <div className="room-indicators">
                        {room.attention > 0 && <b className="attention">{room.attention}</b>}
                        {room.unread > 0 ? <b>{room.unread}</b> : room.attention === 0 ? <Circle size={8} /> : null}
                      </div>
                    </button>
                  ))}
                  {rooms.filter((room) => room.teamId === team.id).length === 0 && (
                    <div className="sidebar-empty nested-empty">
                      {team.active && !searchActive ? "No rooms yet. Create one for this team." : "No visible rooms."}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {teams.length === 0 && (
            <div className="sidebar-empty">
              {searchActive ? "No teams found." : "No teams yet. Create one to start."}
            </div>
          )}
        </div>
      </section>

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
              <button onClick={onChooseNewRoomProjectPath} disabled={!selectedTeam} aria-label="Choose project folder">
                <FolderGit2 size={14} />
              </button>
            </div>
            <button onClick={onCreateRoom} disabled={!selectedTeam || !newRoomName.trim() || !newRoomProjectPath.trim()}>
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

      {searchActive && (
        <section className="sidebar-section">
          <div className="section-title">
            <span>Chat hits</span>
          </div>
          <div className="message-hit-list">
            {messageHits.map((hit) => (
              <button
                key={hit.key}
                onClick={() => onSelectRoom(hit.roomId, hit.teamId)}
              >
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

      <div className="sidebar-footer">
        <button onClick={onToggleTheme}>
          {themeMode === "dark" ? "Light" : "Dark"}
        </button>
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
    </aside>
  );
}
