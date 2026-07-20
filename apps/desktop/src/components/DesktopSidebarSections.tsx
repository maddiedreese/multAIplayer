import { Archive, ChevronDown, ChevronRight, Circle, Plus, RotateCcw, Trash2, UsersRound, X } from "lucide-react";
import { useThemeMode } from "../hooks/useThemeMode";
import type { SidebarPanelName } from "../lib/core/uiTypes";
import type { SidebarRoomDisplay, SidebarTeamDisplay } from "./DesktopSidebar";

type TeamLifecycle = (teamId: string, action: "archive" | "restore" | "delete") => void;
type RoomLifecycle = (roomId: string, action: "archive" | "restore" | "delete") => void;

export function SidebarTeamGroup({
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
}: {
  team: SidebarTeamDisplay;
  rooms: SidebarRoomDisplay[];
  collapsed: boolean;
  showArchived: boolean;
  searchActive: boolean;
  onToggleCollapsed: () => void;
  onSelectTeam: (teamId: string) => void;
  onSelectRoom: (roomId: string, teamId?: string) => void;
  onSetTeamLifecycle: TeamLifecycle;
  onSetRoomLifecycle: RoomLifecycle;
}) {
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
                <SidebarRoomAction
                  label={room.archived ? `Restore ${room.name}` : `Archive ${room.name}`}
                  title={room.archived ? "Restore room" : "Archive room"}
                  onActivate={() => onSetRoomLifecycle(room.id, room.archived ? "restore" : "archive")}
                >
                  {room.archived ? <RotateCcw size={13} /> : <Archive size={13} />}
                </SidebarRoomAction>
                <SidebarRoomAction
                  label={`Delete ${room.name}`}
                  title="Delete room"
                  onActivate={() => confirmDelete("room", room.name) && onSetRoomLifecycle(room.id, "delete")}
                >
                  <Trash2 size={13} />
                </SidebarRoomAction>
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

function SidebarRoomAction({
  label,
  title,
  onActivate,
  children
}: {
  label: string;
  title: string;
  onActivate: () => void;
  children: React.ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      className="icon-only"
      aria-label={label}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onActivate();
        }
      }}
    >
      {children}
    </span>
  );
}

export function SidebarFooter({
  activeSidebarPanel,
  onSelectSidebarPanel
}: {
  activeSidebarPanel: SidebarPanelName;
  onSelectSidebarPanel: (panel: SidebarPanelName) => void;
}) {
  const { themeMode, toggleThemeMode } = useThemeMode();
  return (
    <div className="sidebar-footer">
      <button onClick={toggleThemeMode}>{themeMode === "dark" ? "Light" : "Dark"}</button>
      {(["settings", "profile", "help"] as const).map((panel) => (
        <button
          key={panel}
          className={activeSidebarPanel === panel ? "active" : ""}
          onClick={() => onSelectSidebarPanel(activeSidebarPanel === panel ? null : panel)}
        >
          {panel[0]?.toUpperCase() + panel.slice(1)}
        </button>
      ))}
    </div>
  );
}

export function SidebarTeamsTitle({
  searchActive,
  showArchived,
  collapsed,
  teamCreateOpen,
  onToggleCollapsed,
  onToggleArchived,
  onToggleTeamCreate
}: {
  searchActive: boolean;
  showArchived: boolean;
  collapsed: boolean;
  teamCreateOpen: boolean;
  onToggleCollapsed: () => void;
  onToggleArchived: () => void;
  onToggleTeamCreate: () => void;
}) {
  const label = searchActive ? "Matching teams" : showArchived ? "Archived" : "Teams";
  return (
    <div className="section-title">
      <button
        type="button"
        className="section-disclosure"
        aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span>{label}</span>
      </button>
      {!searchActive && (
        <div className="section-title-actions">
          <button
            onClick={onToggleArchived}
            aria-label={showArchived ? "Show active teams" : "Show archived teams and rooms"}
            aria-pressed={showArchived}
            title={showArchived ? "Show active teams" : "Show archived"}
          >
            {showArchived ? <UsersRound size={14} /> : <Archive size={14} />}
          </button>
          {!showArchived && (
            <button
              onClick={onToggleTeamCreate}
              aria-label={teamCreateOpen ? "Hide team form" : "New team"}
              aria-expanded={teamCreateOpen}
            >
              {teamCreateOpen ? <X size={14} /> : <Plus size={15} />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function sidebarTeamEmptyMessage(searchActive: boolean, showArchived: boolean, archivedCount: number): string {
  if (searchActive) return "No teams found.";
  if (!showArchived) return "No teams yet. Create one to start.";
  return archivedCount === 0 ? "No archived teams or rooms." : "No archived teams found.";
}

export function visibleSidebarTeams(
  teams: SidebarTeamDisplay[],
  rooms: SidebarRoomDisplay[],
  showArchived: boolean
): SidebarTeamDisplay[] {
  if (!showArchived) return teams.filter((team) => !team.archived);
  return teams.filter((team) => team.archived || rooms.some((room) => room.teamId === team.id && room.archived));
}

export function visibleSidebarRooms(
  rooms: SidebarRoomDisplay[],
  team: SidebarTeamDisplay,
  showArchived: boolean
): SidebarRoomDisplay[] {
  return rooms.filter((room) => {
    if (room.teamId !== team.id) return false;
    return showArchived ? room.archived || team.archived : !room.archived && !team.archived;
  });
}
