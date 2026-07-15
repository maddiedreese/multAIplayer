import { Check, KeyRound, RefreshCw, X } from "lucide-react";
import type { ApprovalPolicy } from "@multaiplayer/protocol";
import type { LocalHistorySettings } from "../lib/history/localHistory";
import { RoomSettingsOverview, type RoomPostureDisplay } from "./RoomSettingsOverview";
import type { ReactNode } from "react";

export interface CodexModelOptionDisplay {
  id: string;
  label: string;
}

const selectableApprovalPolicies: ApprovalPolicy[] = ["ask_every_turn", "never_host"];

export function RoomSettingsDrawerPanel({
  relaySummary,
  relayApi,
  codexSummary,
  projectPath,
  modelLabel,
  approvalLabel,
  roomKeysLabel,
  posture,
  chooseProjectDisabled,
  allowRelayConfiguration,
  relayHttpDraft,
  relayWsDraft,
  defaultRelayHttpUrl,
  defaultRelayWsUrl,
  saveRelayDisabled,
  showRoomSettingsGate,
  roomSettingsGateMessage,
  notificationsMuted,
  historySettings,
  teamHistorySettings,
  hasSelectedRoom,
  selectedTeam,
  settingsBusy,
  teamDefaultApprovalPolicy,
  approvalPolicyLabels,
  teamDefaultCodexModel,
  defaultCodexModel,
  codexModelOptions,
  teamDefaultBrowserProfilePersistent,
  message,
  archivePanel,
  onChooseProject,
  onRelayHttpDraftChange,
  onRelayWsDraftChange,
  onResetRelay,
  onSaveRelay,
  onNotificationsMutedChange,
  onHistoryEnabledChange,
  onHistoryRetentionDaysChange,
  onClearRoomHistory,
  onForgetRoomLocalData,
  onTeamHistoryEnabledChange,
  onTeamHistoryRetentionDaysChange,
  onTeamDefaultApprovalPolicyChange,
  onTeamDefaultCodexModelChange,
  onTeamDefaultBrowserProfilePersistentChange,
  onApplyTeamDefaultsToRoom
}: {
  relaySummary: string;
  relayApi: string;
  codexSummary: string;
  projectPath: string;
  modelLabel: string;
  approvalLabel: string;
  roomKeysLabel: string;
  posture: RoomPostureDisplay;
  chooseProjectDisabled: boolean;
  allowRelayConfiguration: boolean;
  relayHttpDraft: string;
  relayWsDraft: string;
  defaultRelayHttpUrl: string;
  defaultRelayWsUrl: string;
  saveRelayDisabled: boolean;
  showRoomSettingsGate: boolean;
  roomSettingsGateMessage: string;
  notificationsMuted: boolean;
  historySettings: LocalHistorySettings;
  teamHistorySettings: LocalHistorySettings;
  hasSelectedRoom: boolean;
  selectedTeam: boolean;
  settingsBusy: boolean;
  teamDefaultApprovalPolicy: ApprovalPolicy;
  approvalPolicyLabels: Record<ApprovalPolicy, string>;
  teamDefaultCodexModel: string;
  defaultCodexModel: string;
  codexModelOptions: readonly CodexModelOptionDisplay[];
  teamDefaultBrowserProfilePersistent: boolean;
  teamDefaultInviteApprovalGate: boolean;
  message: string | null;
  archivePanel?: ReactNode;
  onChooseProject: () => void;
  onRelayHttpDraftChange: (value: string) => void;
  onRelayWsDraftChange: (value: string) => void;
  onResetRelay: () => void;
  onSaveRelay: () => void;
  onNotificationsMutedChange: (muted: boolean) => void;
  onHistoryEnabledChange: (enabled: boolean) => void;
  onHistoryRetentionDaysChange: (days: number) => void;
  onClearRoomHistory: () => void;
  onForgetRoomLocalData: () => void;
  onTeamHistoryEnabledChange: (enabled: boolean) => void;
  onTeamHistoryRetentionDaysChange: (days: number) => void;
  onTeamDefaultApprovalPolicyChange: (policy: ApprovalPolicy) => void;
  onTeamDefaultCodexModelChange: (model: string) => void;
  onTeamDefaultBrowserProfilePersistentChange: (persistent: boolean) => void;
  onTeamDefaultInviteApprovalGateChange: (enabled: boolean) => void;
  onApplyTeamDefaultsToRoom: () => void;
}) {
  const selectedTeamDefaultModel = codexModelOptions.some((option) => option.id === teamDefaultCodexModel)
    ? teamDefaultCodexModel
    : defaultCodexModel;

  return (
    <div className="drawer-content">
      <RoomSettingsOverview
        relay={relaySummary}
        relayApi={relayApi}
        codex={codexSummary}
        project={projectPath}
        model={modelLabel}
        approval={approvalLabel}
        roomKeys={roomKeysLabel}
        posture={posture}
        chooseProjectDisabled={chooseProjectDisabled}
        onChooseProject={onChooseProject}
      />

      {allowRelayConfiguration && (
        <section className="drawer-section relay-config-section">
          <div className="drawer-section-title">App server / relay</div>
          <p className="drawer-help-text">
            Self-hosted builds can override their relay endpoints here. The app can connect only to origins allowed by
            its build-time content security policy.
          </p>
          <label>
            <span>HTTP API URL</span>
            <input
              value={relayHttpDraft}
              onChange={(event) => onRelayHttpDraftChange(event.target.value)}
              placeholder={defaultRelayHttpUrl}
            />
          </label>
          <label>
            <span>WebSocket rooms URL</span>
            <input
              value={relayWsDraft}
              onChange={(event) => onRelayWsDraftChange(event.target.value)}
              placeholder={defaultRelayWsUrl}
            />
          </label>
          <div className="drawer-button-row">
            <button className="ghost-wide" onClick={onResetRelay}>
              <RefreshCw size={15} />
              Defaults
            </button>
            <button className="primary-wide" onClick={onSaveRelay} disabled={saveRelayDisabled}>
              <Check size={15} />
              Save relay
            </button>
          </div>
        </section>
      )}

      {showRoomSettingsGate && <div className="workflow-message">{roomSettingsGateMessage}</div>}

      <section className="drawer-section">
        <div className="drawer-section-title">Local history</div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={notificationsMuted}
            disabled={!hasSelectedRoom}
            onChange={(event) => onNotificationsMutedChange(event.target.checked)}
          />
          <span>Mute notifications for this room</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={historySettings.enabled}
            disabled={!hasSelectedRoom}
            onChange={(event) => onHistoryEnabledChange(event.target.checked)}
          />
          <span>Save local history</span>
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

        <div className="drawer-section-title">Team default</div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={teamHistorySettings.enabled}
            disabled={!selectedTeam}
            onChange={(event) => onTeamHistoryEnabledChange(event.target.checked)}
          />
          <span>Save history in new team rooms</span>
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
            value={selectedTeamDefaultModel}
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
        <button className="ghost-wide" onClick={onApplyTeamDefaultsToRoom} disabled={!hasSelectedRoom || settingsBusy}>
          <Check size={15} />
          Apply team default to room
        </button>
      </section>

      {archivePanel}

      {message && <div className="workflow-message">{message}</div>}
    </div>
  );
}
