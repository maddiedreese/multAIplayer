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
  const inviteId = new URLSearchParams(location.search).get("invite");
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
