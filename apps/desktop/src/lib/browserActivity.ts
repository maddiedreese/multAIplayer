import type { RequestStatusPlaintextPayload } from "@multaiplayer/protocol";

export interface BrowserDecisionRequest {
  url: string;
  requester: string;
}

export function buildBrowserDecisionMessage(
  decision: RequestStatusPlaintextPayload,
  request: BrowserDecisionRequest | undefined,
  formatUrl: (url: string) => string
): string {
  const action = decision.status === "approved" ? "approved" : "denied";
  const target = request
    ? `${formatUrl(request.url)} for ${request.requester}`
    : "a browser access request";
  return `${decision.decidedBy} ${action} ${target}.`;
}

export function browserDecisionMessageId(decision: RequestStatusPlaintextPayload): string {
  return `browser:${decision.requestId}:${decision.status}:${decision.decidedAt}`;
}
