import React, { type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";

export function ApprovalItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="approval-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function InlineSecretWarning({
  risks,
  compact = false,
  detail
}: {
  risks: string[];
  compact?: boolean;
  detail?: string;
}) {
  return (
    <div className={`inline-secret-warning ${compact ? "compact" : ""}`}>
      <ShieldAlert size={compact ? 14 : 16} />
      <span>
        {Array.from(new Set(risks)).join(", ")} may expose secrets to everyone in this room.
        {detail ? ` ${detail}` : ""}
      </span>
    </div>
  );
}

export function StatusPill({
  icon,
  label,
  tone
}: {
  icon: ReactNode;
  label: string;
  tone: "green" | "blue" | "yellow" | "red" | "dark" | "muted";
}) {
  return (
    <span className={`status-pill ${tone}`}>
      {icon}
      {label}
    </span>
  );
}
