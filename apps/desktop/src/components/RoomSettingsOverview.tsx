import { FolderGit2 } from "lucide-react";
import { InfoRow } from "./common";

export type RoomPostureDisplay = {
  hostAccess: string;
  workspaceAccess: string;
  history: string;
  browserProfile: string;
  modes: string;
};

export function RoomSettingsOverview({
  relay,
  relayApi,
  codex,
  project,
  model,
  approval,
  roomKeys,
  posture,
  chooseProjectDisabled,
  onChooseProject
}: {
  relay: string;
  relayApi: string;
  codex: string;
  project: string;
  model: string;
  approval: string;
  roomKeys: string;
  posture: RoomPostureDisplay;
  chooseProjectDisabled: boolean;
  onChooseProject: () => void;
}) {
  return (
    <section className="drawer-section">
      <InfoRow label="Relay" value={relay} />
      <InfoRow label="Relay API" value={relayApi} />
      <InfoRow label="Codex" value={codex} />
      <InfoRow label="Project" value={project} />
      <InfoRow label="Model" value={model} />
      <InfoRow label="Approval" value={approval} />
      <InfoRow label="Room access" value={roomKeys} />
      <InfoRow label="Host access" value={posture.hostAccess} />
      <InfoRow label="Workspace" value={posture.workspaceAccess} />
      <InfoRow label="History" value={posture.history} />
      <InfoRow label="Browser" value={posture.browserProfile} />
      <InfoRow label="Modes" value={posture.modes} />
      <button className="ghost-wide" onClick={onChooseProject} disabled={chooseProjectDisabled}>
        <FolderGit2 size={15} />
        Choose project folder
      </button>
    </section>
  );
}
