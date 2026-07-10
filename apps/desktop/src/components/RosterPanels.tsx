import { Copy } from "lucide-react";
import type { TeamMemberRecord } from "@multaiplayer/protocol";

export interface TeamMemberDisplay {
  member: TeamMemberRecord;
  initial: string;
  name: string;
  roleLabel: string;
  joinedLabel: string;
  canPromote: boolean;
  canDemote: boolean;
  canTransferOwnership: boolean;
  canRemove: boolean;
}

export interface RoomMemberDisplay {
  userId: string;
  deviceId: string;
  displayName: string;
  avatarUrl?: string;
  publicKeyFingerprint?: string;
  status: "online" | "offline";
  trusted: boolean;
  isHost: boolean;
  deviceLabel: string;
}

export function TeamRosterPanel({
  members,
  hasSelectedTeam,
  busy,
  message,
  onPromote,
  onDemote,
  onTransferOwnership,
  onRemove
}: {
  members: TeamMemberDisplay[];
  hasSelectedTeam: boolean;
  busy: boolean;
  message: string | null;
  onPromote: (member: TeamMemberRecord) => void;
  onDemote: (member: TeamMemberRecord) => void;
  onTransferOwnership: (member: TeamMemberRecord) => void;
  onRemove: (member: TeamMemberRecord) => void;
}) {
  return (
    <section className="panel members-panel">
      <div className="panel-title">
        <span>Team roster</span>
        <small className="panel-count">{members.length || 0}</small>
      </div>
      <div className="member-list">
        {members.map(({ member, initial, name, roleLabel, joinedLabel, canPromote, canDemote, canTransferOwnership, canRemove }) => (
          <div className="member-row team-member-row" key={`${member.teamId}:${member.userId}`}>
            <span>{initial}</span>
            <div>
              <strong title={name}>{name}</strong>
              <small title={member.userId}>{member.userId}</small>
            </div>
            <div className="member-badges">
              <b className={member.role === "owner" ? "trusted" : member.role === "admin" ? "verified" : ""}>
                {roleLabel}
              </b>
              {canPromote && (
                <button onClick={() => onPromote(member)} disabled={busy}>Promote</button>
              )}
              {canDemote && (
                <button onClick={() => onDemote(member)} disabled={busy}>Demote</button>
              )}
              {canTransferOwnership && (
                <button onClick={() => onTransferOwnership(member)} disabled={busy}>Make owner</button>
              )}
              {canRemove && (
                <button onClick={() => onRemove(member)} disabled={busy}>Remove</button>
              )}
            </div>
            <small title={joinedLabel}>{joinedLabel}</small>
          </div>
        ))}
      </div>
      {members.length === 0 && (
        <div className="sidebar-empty">
          {hasSelectedTeam ? "No team roster loaded yet." : "Select a team to view its roster."}
        </div>
      )}
      {message && <div className="workflow-message">{message}</div>}
    </section>
  );
}

export function RoomMembersPanel({
  members,
  localDeviceId,
  message,
  onCopyFingerprint,
  onTrust,
  onUntrust
}: {
  members: RoomMemberDisplay[];
  localDeviceId: string;
  message: string | null;
  onCopyFingerprint: (member: RoomMemberDisplay) => void;
  onTrust: (member: RoomMemberDisplay) => void;
  onUntrust: (member: RoomMemberDisplay) => void;
}) {
  return (
    <section className="panel members-panel">
      <div className="panel-title">
        <span>Members</span>
        <small className="panel-state available">{members.length || 1} online</small>
      </div>
      <div className="member-list">
        {members.map((member) => (
          <div className="member-row" key={member.deviceId}>
            {member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : <span>{member.displayName.slice(0, 1)}</span>}
            <div>
              <strong>{member.displayName}</strong>
              <small>{member.deviceLabel}</small>
            </div>
            <div className="member-badges">
              {member.isHost && <b>host</b>}
              <b className={member.publicKeyFingerprint ? member.trusted ? "trusted" : "verified" : "warning"}>
                {member.publicKeyFingerprint ? member.trusted ? "local trust" : "keyed" : "pending"}
              </b>
              {member.publicKeyFingerprint && member.deviceId !== localDeviceId && (
                <>
                  <button onClick={() => onCopyFingerprint(member)} title="Copy full device fingerprint">
                    <Copy size={12} />
                  </button>
                  {member.trusted ? (
                    <button onClick={() => onUntrust(member)}>Untrust</button>
                  ) : (
                    <button onClick={() => onTrust(member)}>Trust</button>
                  )}
                </>
              )}
            </div>
            <i />
          </div>
        ))}
      </div>
      {message && <div className="workflow-message">{message}</div>}
    </section>
  );
}
