/** Public website, native intake, and manual paste share this complete-link bound. */
export const maxInviteLinkChars = 12_288;

export type InviteUrlPayload = {
  kind: "join";
  encoded: string;
  inviteId: string;
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
  const allowedKeys = new Set(["invite", "multaiplayerJoin", "approval"]);
  if (
    [...fragment.keys()].some((key) => !allowedKeys.has(key)) ||
    fragment.getAll("invite").length !== 1 ||
    fragment.getAll("multaiplayerJoin").length !== 1 ||
    fragment.getAll("approval").length !== 1 ||
    fragment.get("approval") !== "request"
  ) {
    return null;
  }
  const inviteId = fragment.get("invite");
  const joinInvite = fragment.get("multaiplayerJoin");
  if (joinInvite && inviteId) {
    return {
      kind: "join",
      encoded: joinInvite,
      inviteId,
      cleanupPath: location.pathname
    };
  }
  return null;
}
