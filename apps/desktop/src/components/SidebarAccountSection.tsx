import { ExternalLink, Search, X } from "lucide-react";
import type { GitHubAuthConfig, GitHubDeviceStart, SignedInUser } from "../lib/identity/authClient";
import { GitHubIcon } from "./GitHubIcon";

const brandIcon = new URL("../assets/multaiplayer-icon.png", import.meta.url).href;

export interface SidebarAccountSectionProps {
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

export function SidebarAccountSection({
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
          {currentUser.avatarUrl ? <img src={currentUser.avatarUrl} alt="" /> : <GitHubIcon size={18} />}
          <div>
            <strong>{currentUser.name ?? currentUser.login}</strong>
            <span>@{currentUser.login}</span>
          </div>
          <button onClick={onSignOut}>Sign out</button>
        </div>
      ) : (
        <button className="github-button" onClick={onSignIn} disabled={authBusy || authConfig?.configured === false}>
          <GitHubIcon size={16} />
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
