/** Public website, native intake, and manual paste share this complete-link bound. */
export const maxInviteLinkChars = 12_288;

export type InviteUrlPayload =
  | {
      kind: "join";
      encoded: string;
      inviteId: string | null;
      approvalRequested: boolean;
      cleanupPath: string;
    }
  | {
      kind: "legacy-secret";
      cleanupPath: string;
    };

export interface InviteUrlParts {
  hash: string;
  search: string;
  pathname: string;
}

export function readInviteUrlPayload(location: InviteUrlParts): InviteUrlPayload | null {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  // Manual paste keeps one alpha-generation compatibility window for links
  // whose opaque relay id preceded the fragment. OS intake rejects query data.
  const inviteId = fragment.get("invite") ?? new URLSearchParams(location.search).get("invite");
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
  const secretInvite = fragment.get("multaiplayerInvite");
  if (secretInvite) {
    return {
      kind: "legacy-secret",
      cleanupPath: location.pathname
    };
  }
  return null;
}
