export type CodexAccountReadinessStatus = "checking" | "native_required" | "unavailable" | "sign_in_required" | "ready";

export interface CodexAccountReadiness {
  status: CodexAccountReadinessStatus;
  ready: boolean;
  message: string;
}
