import React from "react";
import { HostHandoffPanel, type HostHandoffDisplay } from "../../../apps/desktop/src/components/HostHandoffPanel";
import { RoomHeader } from "../../../apps/desktop/src/components/RoomHeader";

export const description =
  "Exercises the production host-handoff panel and room authority controls across offer, candidate request, explicit approval, and accepted states.";

export const mockedBoundaries = [
  "authenticated relay delivery",
  "native MLS host-transfer commit",
  "local Codex host backend"
] as const;

type HandoffPhase = "idle" | "available" | "requested" | "accepted";
type ClientRole = "initiator" | "successor";

const handoff: HostHandoffDisplay = {
  id: "e2e-host-handoff",
  status: "available",
  fromHost: "Maddie",
  reason: "manual",
  messagesSinceLastCodex: 4,
  queuedCodexTurns: [],
  attachmentNames: [],
  terminals: ["dev server"],
  projectPath: "/tmp/multaiplayer-e2e",
  gitRepoOwner: "maddiedreese",
  gitRepoName: "multAIplayer",
  gitBranch: "main",
  codexModel: "gpt-5.4"
};

const modelOptions = [{ id: "gpt-5.4", label: "GPT-5.4" }] as const;
const reasoningOptions = [{ id: "medium", label: "Medium" }] as const;
const speedOptions = [{ id: "standard", label: "Standard" }] as const;
const noop = () => undefined;

export default function HostHandoffScenario() {
  const [phase, setPhase] = React.useState<HandoffPhase>("idle");
  const [initiatorMessage, setInitiatorMessage] = React.useState("You are hosting Host handoff room.");
  const [successorMessage, setSuccessorMessage] = React.useState("Only the active host can change room authority.");
  const activeRole: ClientRole = phase === "accepted" ? "successor" : "initiator";

  const offerHandoff = () => {
    if (activeRole !== "initiator" || phase !== "idle") return;
    setPhase("available");
    setInitiatorMessage("Host handoff room is accepting verified host candidates.");
    setSuccessorMessage("A verified host handoff is available.");
  };

  const requestHandoff = () => {
    if (phase !== "available") return;
    setPhase("requested");
    setSuccessorMessage("Host authority request sent. The active host must explicitly approve it.");
    setInitiatorMessage(
      "A verified room member requested host authority. The active host must approve the MLS transfer."
    );
  };

  const approveHandoff = () => {
    if (phase !== "requested") return;
    setPhase("accepted");
    setInitiatorMessage("MLS host authority transfer committed. E2E Successor is now the active host.");
    setSuccessorMessage("You are now hosting Host handoff room from Maddie's handoff.");
  };

  return (
    <section aria-label="Host handoff UI contract">
      <ClientView
        role="initiator"
        label="Current host"
        phase={phase}
        isActiveHost={activeRole === "initiator"}
        message={initiatorMessage}
        onOffer={offerHandoff}
        onRequest={requestHandoff}
        onApprove={approveHandoff}
      />
      <ClientView
        role="successor"
        label="Successor member"
        phase={phase}
        isActiveHost={activeRole === "successor"}
        message={successorMessage}
        onOffer={offerHandoff}
        onRequest={requestHandoff}
        onApprove={approveHandoff}
      />
    </section>
  );
}

function ClientView({
  role,
  label,
  phase,
  isActiveHost,
  message,
  onOffer,
  onRequest,
  onApprove
}: {
  role: ClientRole;
  label: string;
  phase: HandoffPhase;
  isActiveHost: boolean;
  message: string;
  onOffer: () => void;
  onRequest: () => void;
  onApprove: () => void;
}) {
  const visibleHandoffs = handoffsForClient(role, phase);
  return (
    <article data-testid={`${role}-client`} style={{ margin: "0 auto 24px", maxWidth: 1120 }}>
      <h2>{label}</h2>
      <RoomHeader
        teams={[{ id: "team-e2e", name: "E2E team" }]}
        selectedTeamId="team-e2e"
        roomName="Host handoff room"
        hostStatus="active"
        hostBusy={false}
        isActiveHost={isActiveHost}
        roomLocked={false}
        hasRoom
        selectedModel="gpt-5.4"
        modelLabel="GPT-5.4"
        modelOptions={modelOptions}
        selectedReasoningEffort="medium"
        reasoningLabel="Medium"
        reasoningOptions={reasoningOptions}
        selectedSpeed="standard"
        speedLabel="Standard"
        speedOptions={speedOptions}
        settingsBusy={false}
        selectedCount={0}
        markdownSelectionMode={false}
        activeInspectorTab="room"
        onSetHost={(status) => {
          if (status === "handoff") onOffer();
        }}
        onSelectTeam={noop}
        onRenameRoom={noop}
        onSelectModel={noop}
        onSelectReasoningEffort={noop}
        onSelectSpeed={noop}
        onSelectInspectorTab={noop}
        onCopyRoomMarkdown={noop}
        onCopySelectedMarkdown={noop}
        onToggleMarkdownSelection={noop}
        onClearSelectedMessages={noop}
        onShareLocalPreview={noop}
      />
      <p role="status">{message}</p>
      <HostHandoffPanel
        handoffs={visibleHandoffs}
        acceptDisabled={phase === "requested" && role === "successor"}
        onAcceptHandoff={() => {
          if (role === "successor") onRequest();
          else onApprove();
        }}
        formatModel={(model) => model}
      />
    </article>
  );
}

function handoffsForClient(role: ClientRole, phase: HandoffPhase): HostHandoffDisplay[] {
  if (phase === "idle") return [];
  if (phase === "available") return role === "successor" ? [handoff] : [];
  if (phase === "requested") {
    return role === "initiator" ? [{ ...handoff, status: "requested", candidateDeviceId: "device-successor" }] : [];
  }
  return [{ ...handoff, status: "accepted", candidateDeviceId: "device-successor" }];
}
