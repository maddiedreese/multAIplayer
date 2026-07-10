import { detectSecretRisks } from "./secretRisks";

export interface AttachmentReviewDecision {
  risks: string[];
  requiresReview: boolean;
  reviewed: boolean;
  canAttach: boolean;
  actionLabel: "Attach" | "Review" | "Attach anyway";
  warningDetail: string | null;
}

export function decideAttachmentReview(
  content: string,
  path: string,
  reviewedPath: string | null
): AttachmentReviewDecision {
  const risks = detectSecretRisks(content, path);
  const requiresReview = risks.length > 0;
  const reviewed = requiresReview && reviewedPath === path;
  return {
    risks,
    requiresReview,
    reviewed,
    canAttach: !requiresReview || reviewed,
    actionLabel: requiresReview ? (reviewed ? "Attach anyway" : "Review") : "Attach",
    warningDetail: requiresReview
      ? reviewed
        ? "Click Attach anyway to share this file preview."
        : "Review is required before this file can be attached."
      : null
  };
}

export function attachmentReviewMessage(path: string, risks: string[]): string {
  return `Review warning before attaching ${path}. It may expose ${risks.join(", ").toLowerCase()} to everyone in this room and to Codex context.`;
}

export function attachmentReviewScopeKey(roomId: string, projectPath: string, path: string): string {
  return JSON.stringify([roomId, projectPath, path]);
}

export function reviewedAttachmentPathForScope(
  reviewKey: string | null,
  roomId: string,
  projectPath: string,
  path: string
): string | null {
  return reviewKey === attachmentReviewScopeKey(roomId, projectPath, path) ? path : null;
}
