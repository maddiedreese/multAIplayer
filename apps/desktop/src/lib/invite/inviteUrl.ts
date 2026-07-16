/** Public website, native intake, and manual paste share this complete-link bound. */
export const maxInviteLinkChars = 12_288;

export type InviteUrlPayload = {
  kind: "join";
  encoded: string;
  inviteId: string | null;
  approvalRequested: boolean;
  cleanupPath: string;
};

export interface InviteUrlParts {
  hash: string;
  search: string;
  pathname: string;
}

export function readInviteUrlPayload(location: InviteUrlParts): InviteUrlPayload | null {
  if (location.search) return null;
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  const inviteId = fragment.get("invite");
  const approvalRequested = fragment.get("approval") === "request";
  const joinInvite = fragment.get("multaiplayerJoin");
  if (joinInvite) {
    return {
      kind: "join",
      encoded: joinInvite,
      inviteId,
      approvalRequested,
      cleanupPath: location.pathname
    };
  }
  return null;
}
