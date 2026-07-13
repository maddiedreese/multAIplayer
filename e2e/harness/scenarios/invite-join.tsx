import React from "react";
import { EncryptedInvitePanel } from "../../../apps/desktop/src/components/EncryptedInvitePanel";
import { RoomChatComposer } from "../../../apps/desktop/src/components/RoomChatComposer";
import { parseInviteInput } from "../../../apps/desktop/src/lib/inviteActionsHelpers";
import { decodeNoSecretRoomInvite, encodeNoSecretRoomInvite } from "../../../apps/desktop/src/lib/noSecretRoomInvite";
import type { InviteJoinRequest } from "../../../apps/desktop/src/types";

export const description =
  "Production invite and composer components exercise the explicit request/host-decision/unlock UI contract.";
export const mockedBoundaries = [
  "relay transport and persistence",
  "native MLS KeyPackage, HPKE, commit, and Welcome processing"
] as const;

const room = { id: "room-ui-contract", teamId: "team-ui-contract", name: "UI Contract Room" };
const hostDeviceId = "device-host";
const guestDeviceId = "device-guest";
const inviteId = "invite-ui-contract";
const joinPayload = encodeNoSecretRoomInvite({
  version: 4,
  teamId: room.teamId,
  roomId: room.id,
  roomName: room.name,
  capabilityHandle: "capability-ui-contract",
  capabilityUrlValue: "A".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
  hostUserId: "github:e2e-host",
  hostDeviceId,
  hostHpkePublicKey: "test-only-public-key",
  hostHpkeKeyFingerprint: "sha256:test-only"
});
const inviteUrl = `https://invite.invalid/?invite=${inviteId}#multaiplayerJoin=${joinPayload}&approval=request`;

function noop() {}

function GuestComposer({ unlocked }: { unlocked: boolean }) {
  const [draft, setDraft] = React.useState("");
  return (
    <RoomChatComposer
      roomGoal={null}
      pendingAttachments={[]}
      pendingAttachmentSummary=""
      roomLocked={!unlocked}
      lockedPlaceholder="Host approval is required before joining this MLS room"
      chatEnabled={unlocked}
      canUseChat={unlocked}
      canSendMessage={unlocked && draft.trim().length > 0}
      draft={draft}
      onPauseGoal={noop}
      onResumeGoal={noop}
      onEditGoal={noop}
      onDeleteGoal={noop}
      onInvokeCodex={noop}
      onOpenFileSelector={noop}
      onRemovePendingAttachment={noop}
      onCancelReply={noop}
      onDraftChange={setDraft}
      onSendMessage={() => setDraft("")}
    />
  );
}

export default function InviteJoinScenario() {
  const [guestInput, setGuestInput] = React.useState("");
  const [hostInviteLink, setHostInviteLink] = React.useState<string | null>(null);
  const [hostMessage, setHostMessage] = React.useState<string | null>(null);
  const [guestMessage, setGuestMessage] = React.useState<string | null>(null);
  const [request, setRequest] = React.useState<InviteJoinRequest | null>(null);
  const unlocked = request?.status === "approved";

  const importInvite = () => {
    try {
      const parsed = parseInviteInput(guestInput.trim());
      const invite = decodeNoSecretRoomInvite(parsed.joinInvite);
      if (parsed.inviteId !== inviteId || invite.roomId !== room.id) throw new Error("Invite target mismatch");
      setRequest({
        id: "request-ui-contract",
        inviteId,
        requester: "E2E Guest",
        requesterUserId: "github:e2e-guest",
        requesterDeviceId: guestDeviceId,
        keyPackageId: "key-package-ui-contract",
        keyPackageHash: "sha256:key-package-ui-contract",
        requesterSignatureKeyFingerprint: "sha256:guest-signature-key",
        requestedAt: "2026-07-13T00:00:00.000Z",
        note: `Requesting access to ${invite.roomName}.`,
        status: "pending"
      });
      setGuestMessage(`Requested access to ${invite.roomName}. The active host must approve this KeyPackage.`);
    } catch (error) {
      setGuestMessage(`Invite could not be imported: ${String(error)}`);
    }
  };

  const decide = (nextStatus: "approved" | "denied") => {
    setRequest((current) => (current ? { ...current, status: nextStatus } : current));
    if (nextStatus === "approved") {
      setHostMessage("Approved E2E Guest's MLS KeyPackage.");
      setGuestMessage(`The host approved this device. ${room.name} is now unlocked.`);
    } else {
      setHostMessage("Denied E2E Guest's join request.");
      setGuestMessage(`The host denied access to ${room.name}.`);
    }
  };

  return (
    <div className="e2e-invite-grid">
      <section aria-labelledby="host-client-heading">
        <h1 id="host-client-heading">Host client</h1>
        <EncryptedInvitePanel
          copyDisabled={false}
          inviteSecretInput=""
          inviteRequests={request ? [request] : []}
          localDeviceId={hostDeviceId}
          importDisabled
          approvalDisabled={false}
          inviteLink={hostInviteLink}
          inviteMessage={hostMessage}
          onCopyInvite={() => {
            setHostInviteLink(inviteUrl);
            setHostMessage("Copied invite link. The host will approve access when someone joins.");
          }}
          onInviteSecretInputChange={noop}
          onImportInvite={noop}
          onDecideInviteRequest={(_, status) => decide(status)}
        />
      </section>
      <section aria-labelledby="guest-client-heading">
        <h1 id="guest-client-heading">Guest client</h1>
        <EncryptedInvitePanel
          copyDisabled
          inviteSecretInput={guestInput}
          inviteRequests={request ? [request] : []}
          localDeviceId={guestDeviceId}
          importDisabled={!guestInput.trim()}
          approvalDisabled
          inviteLink={null}
          inviteMessage={guestMessage}
          onCopyInvite={noop}
          onInviteSecretInputChange={setGuestInput}
          onImportInvite={importInvite}
          onDecideInviteRequest={noop}
        />
        <GuestComposer unlocked={unlocked} />
      </section>
    </div>
  );
}
