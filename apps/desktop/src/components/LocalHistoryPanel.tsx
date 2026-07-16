import { Check, KeyRound, X } from "lucide-react";
import type { ApprovalPolicy } from "@multaiplayer/protocol";

const selectableApprovalPolicies: ApprovalPolicy[] = ["ask_every_turn", "never_host"];

export interface HistorySettingsDisplay {
  enabled: boolean;
  retentionDays: number;
}

export interface CodexModelOptionDisplay {
  id: string;
  label: string;
}

export function LocalHistoryPanel({
  historySettings,
  teamHistorySettings,
  selectedTeam,
  hasSelectedRoom,
  settingsBusy,
  teamDefaultApprovalPolicy,
  approvalPolicyLabels,
  teamDefaultCodexModel,
  defaultCodexModel,
  codexModelOptions,
  teamDefaultBrowserProfilePersistent,
  message,
  hydrationStatus,
  onHistoryEnabledChange,
  onHistoryRetentionDaysChange,
  onClearRoomHistory,
  onForgetRoomLocalData,
  onApplyTeamDefaultsToRoom,
  onRetryHistoryHydration,
  onTeamHistoryEnabledChange,
  onTeamHistoryRetentionDaysChange,
  onTeamDefaultApprovalPolicyChange,
  onTeamDefaultCodexModelChange,
  onTeamDefaultBrowserProfilePersistentChange
}: {
  historySettings: HistorySettingsDisplay;
  teamHistorySettings: HistorySettingsDisplay;
  selectedTeam: boolean;
  hasSelectedRoom: boolean;
  settingsBusy: boolean;
  teamDefaultApprovalPolicy: ApprovalPolicy;
  approvalPolicyLabels: Record<ApprovalPolicy, string>;
  teamDefaultCodexModel: string;
  defaultCodexModel: string;
  codexModelOptions: readonly CodexModelOptionDisplay[];
  teamDefaultBrowserProfilePersistent: boolean;
  teamDefaultInviteApprovalGate: boolean;
  message: string | null;
  hydrationStatus: "loading" | "ready" | "failed" | null;
  onHistoryEnabledChange: (enabled: boolean) => void;
  onHistoryRetentionDaysChange: (retentionDays: number) => void;
  onClearRoomHistory: () => void;
  onForgetRoomLocalData: () => void;
  onApplyTeamDefaultsToRoom: () => void;
  onRetryHistoryHydration: () => void;
  onTeamHistoryEnabledChange: (enabled: boolean) => void;
  onTeamHistoryRetentionDaysChange: (retentionDays: number) => void;
  onTeamDefaultApprovalPolicyChange: (policy: ApprovalPolicy) => void;
  onTeamDefaultCodexModelChange: (model: string) => void;
  onTeamDefaultBrowserProfilePersistentChange: (persistent: boolean) => void;
  onTeamDefaultInviteApprovalGateChange: (enabled: boolean) => void;
}) {
  return (
    <section className="panel history-panel">
      <div className="panel-title">
        <span>Local history</span>
        <small className={historySettings.enabled ? "panel-state available" : "panel-state"}>
          {historySettings.enabled ? `${historySettings.retentionDays} days` : "Off"}
        </small>
      </div>
      {hydrationStatus === "failed" && (
        <button className="ghost-wide" onClick={onRetryHistoryHydration} disabled={!hasSelectedRoom}>
          Retry loading local history
        </button>
      )}
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={historySettings.enabled}
          disabled={!hasSelectedRoom}
          onChange={(event) => onHistoryEnabledChange(event.target.checked)}
        />
        <span>Save local room history</span>
      </label>
      <label className="history-retention">
        <span>Retention days</span>
        <input
          type="number"
          min={1}
          max={365}
          value={historySettings.retentionDays}
          disabled={!hasSelectedRoom || !historySettings.enabled}
          onChange={(event) => onHistoryRetentionDaysChange(Number(event.target.value))}
        />
      </label>
      <button className="ghost-wide" onClick={onClearRoomHistory} disabled={!hasSelectedRoom}>
        <X size={15} />
        Clear local history
      </button>
      <button className="ghost-wide danger" onClick={onForgetRoomLocalData} disabled={!hasSelectedRoom}>
        <KeyRound size={15} />
        Forget room on this device
      </button>
      <div className="history-defaults">
        <div>
          <strong>Team default</strong>
          <span>
            {teamHistorySettings.enabled
              ? `${teamHistorySettings.retentionDays} days for new rooms`
              : "off for new rooms"}
          </span>
        </div>
        <button className="ghost-wide" onClick={onApplyTeamDefaultsToRoom} disabled={!hasSelectedRoom || settingsBusy}>
          <Check size={15} />
          Apply defaults to room
        </button>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={teamHistorySettings.enabled}
          disabled={!selectedTeam}
          onChange={(event) => onTeamHistoryEnabledChange(event.target.checked)}
        />
        <span>Save history in new rooms for this team</span>
      </label>
      <label className="history-retention">
        <span>Team retention days</span>
        <input
          type="number"
          min={1}
          max={365}
          value={teamHistorySettings.retentionDays}
          disabled={!selectedTeam || !teamHistorySettings.enabled}
          onChange={(event) => onTeamHistoryRetentionDaysChange(Number(event.target.value))}
        />
      </label>
      <label className="history-retention">
        <span>New room approval</span>
        <select
          value={teamDefaultApprovalPolicy}
          disabled={!selectedTeam}
          onChange={(event) => onTeamDefaultApprovalPolicyChange(event.target.value as ApprovalPolicy)}
        >
          {selectableApprovalPolicies.map((policy) => (
            <option key={policy} value={policy}>
              {approvalPolicyLabels[policy]}
            </option>
          ))}
        </select>
      </label>
      <label className="history-retention">
        <span>New room model</span>
        <select
          value={
            codexModelOptions.some((option) => option.id === teamDefaultCodexModel)
              ? teamDefaultCodexModel
              : defaultCodexModel
          }
          disabled={!selectedTeam}
          onChange={(event) => onTeamDefaultCodexModelChange(event.target.value)}
        >
          {codexModelOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={teamDefaultBrowserProfilePersistent}
          disabled={!selectedTeam}
          onChange={(event) => onTeamDefaultBrowserProfilePersistentChange(event.target.checked)}
        />
        <span>Persist browser profiles in new team rooms</span>
      </label>
      {message && <div className="workflow-message">{message}</div>}
    </section>
  );
}
