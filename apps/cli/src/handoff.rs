use multaiplayer_protocol::{
    CommitEffect, HostHandoffAcceptedPlaintextPayload, HostHandoffPlaintextPayload,
    HostHandoffRequestPlaintextPayload, HostHandoffStatus, MlsMessageType, MlsRelayMessage,
};
use serde::{Deserialize, Serialize};

pub const MAX_HANDOFFS: usize = 32;

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HandoffState {
    pub offers: Vec<HostHandoffPlaintextPayload>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CandidateBinding {
    pub user_id: String,
    pub device_id: String,
    pub leaf: u64,
}

impl CandidateBinding {
    fn key(&self) -> (&str, &str, u64) {
        (&self.user_id, &self.device_id, self.leaf)
    }
}

impl HandoffState {
    pub fn offer(&self, id: &str) -> Option<&HostHandoffPlaintextPayload> {
        self.offers.iter().find(|offer| offer.id == id)
    }

    pub fn remember_offer(&mut self, mut offer: HostHandoffPlaintextPayload) {
        offer.status = HostHandoffStatus::Available;
        if self.offer(&offer.id).is_some() {
            return;
        }
        self.offers.push(offer);
        if self.offers.len() > MAX_HANDOFFS {
            self.offers.remove(0);
        }
    }

    pub fn request_candidate(&mut self, request: &HostHandoffRequestPlaintextPayload) -> bool {
        let Some(offer) = self
            .offers
            .iter_mut()
            .find(|offer| offer.id == request.offer_id)
        else {
            return false;
        };
        if !matches!(
            offer.status,
            HostHandoffStatus::Available | HostHandoffStatus::Requested
        ) {
            return false;
        }
        let proposed = CandidateBinding {
            user_id: request.candidate_user_id.clone(),
            device_id: request.candidate_device_id.clone(),
            leaf: request.candidate_leaf,
        };
        let current = match (
            offer.candidate_user_id.as_ref(),
            offer.candidate_device_id.as_ref(),
            offer.candidate_leaf,
        ) {
            (Some(user_id), Some(device_id), Some(leaf)) => Some(CandidateBinding {
                user_id: user_id.clone(),
                device_id: device_id.clone(),
                leaf,
            }),
            _ => None,
        };
        if current
            .as_ref()
            .is_some_and(|current| current.key() <= proposed.key())
        {
            return true;
        }
        offer.candidate_user_id = Some(proposed.user_id);
        offer.candidate_device_id = Some(proposed.device_id);
        offer.candidate_leaf = Some(proposed.leaf);
        offer.status = HostHandoffStatus::Requested;
        true
    }

    pub fn accept_informational(
        &mut self,
        accepted: &HostHandoffAcceptedPlaintextPayload,
        sender_user_id: &str,
        created_at: &str,
    ) -> bool {
        let Some(offer) = self
            .offers
            .iter_mut()
            .find(|offer| offer.id == accepted.offer_id)
        else {
            return false;
        };
        if offer.from_user_id != sender_user_id
            || !matches!(
                offer.status,
                HostHandoffStatus::Requested | HostHandoffStatus::Accepted
            )
            || offer.candidate_user_id.as_deref() != Some(accepted.host_user_id.as_str())
            || offer.candidate_device_id.as_deref() != Some(accepted.host_device_id.as_str())
            || offer.candidate_leaf != Some(accepted.host_leaf)
        {
            return false;
        }
        offer.status = HostHandoffStatus::Accepted;
        offer.accepted_by_user_id = Some(accepted.host_user_id.clone());
        offer.accepted_at = Some(created_at.to_owned());
        true
    }

    /// The MLS commit is authoritative; the encrypted accepted event is only a live hint.
    pub fn accept_committed(&mut self, envelope: &MlsRelayMessage) -> bool {
        let Some(auth) = envelope.host_transfer_authorization.as_ref() else {
            return false;
        };
        let Some(offer) = self
            .offers
            .iter_mut()
            .find(|offer| offer.id == auth.transfer_id)
        else {
            return false;
        };
        if !matches!(
            offer.status,
            HostHandoffStatus::Requested | HostHandoffStatus::Accepted
        ) || envelope.message_type != MlsMessageType::Commit
            || envelope.commit_effect != Some(CommitEffect::HostHandoff)
            || offer.from_user_id != auth.outgoing_host_user_id
            || envelope.sender_user_id != auth.outgoing_host_user_id
            || envelope.sender_device_id != auth.outgoing_host_device_id
            || offer.candidate_user_id.as_deref() != Some(auth.next_host_user_id.as_str())
            || offer.candidate_device_id.as_deref() != Some(auth.next_host_device_id.as_str())
            || offer.candidate_leaf != Some(auth.next_host_leaf)
            || envelope.next_host_user_id.as_deref() != Some(auth.next_host_user_id.as_str())
            || envelope.next_host_device_id.as_deref() != Some(auth.next_host_device_id.as_str())
            || envelope.id != auth.commit_message_id
            || envelope.room_id != auth.room_id
            || envelope.epoch_hint != auth.parent_epoch
        {
            return false;
        }
        offer.status = HostHandoffStatus::Accepted;
        offer.accepted_by_user_id = Some(auth.next_host_user_id.clone());
        offer.accepted_at = Some(envelope.created_at.clone());
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use multaiplayer_protocol::{
        CatalogSelectionPolicy, CodexReasoningEffort, CodexSandboxLevel, CodexSpeed,
        HostHandoffReason,
    };

    fn offer() -> HostHandoffPlaintextPayload {
        HostHandoffPlaintextPayload {
            id: "offer-1".into(),
            from_host: "Host".into(),
            from_user_id: "user-host".into(),
            reason: HostHandoffReason::Manual,
            project_path: "/outgoing/project".into(),
            git_remote_url: None,
            git_repo_owner: None,
            git_repo_name: None,
            git_branch: None,
            git_dirty_files: None,
            git_patch: None,
            git_patch_truncated: None,
            codex_model: "gpt-5.5".into(),
            codex_model_policy: CatalogSelectionPolicy::Auto,
            codex_reasoning_effort: CodexReasoningEffort::Medium,
            codex_reasoning_effort_policy: CatalogSelectionPolicy::Auto,
            codex_raw_reasoning_enabled: false,
            codex_speed: CodexSpeed::Standard,
            codex_service_tier_policy: CatalogSelectionPolicy::Auto,
            codex_sandbox_level: CodexSandboxLevel::WorkspaceWrite,
            approval_policy: "ask_every_turn".into(),
            messages_since_last_codex: 0,
            queued_codex_turns: vec![],
            attachment_names: vec![],
            terminals: vec![],
            continuation_summary: None,
            created_at: "2026-07-20T00:00:00Z".into(),
            status: HostHandoffStatus::Available,
            candidate_user_id: None,
            candidate_device_id: None,
            candidate_leaf: None,
            accepted_by: None,
            accepted_by_user_id: None,
            accepted_at: None,
        }
    }

    #[test]
    fn candidate_selection_converges() {
        let a = HostHandoffRequestPlaintextPayload {
            phase: "candidate_request".into(),
            offer_id: "offer-1".into(),
            candidate_user_id: "user-a".into(),
            candidate_device_id: "device-a".into(),
            candidate_leaf: 2,
        };
        let b = HostHandoffRequestPlaintextPayload {
            candidate_user_id: "user-b".into(),
            candidate_device_id: "device-b".into(),
            candidate_leaf: 1,
            ..a.clone()
        };
        let mut left = HandoffState {
            offers: vec![offer()],
        };
        let mut right = left.clone();
        left.request_candidate(&a);
        left.request_candidate(&b);
        right.request_candidate(&b);
        right.request_candidate(&a);
        assert_eq!(left, right);
        assert_eq!(
            left.offer("offer-1").unwrap().candidate_user_id.as_deref(),
            Some("user-a")
        );
    }

    #[test]
    fn authoritative_commit_and_informational_event_are_idempotent_in_either_order() {
        let request = HostHandoffRequestPlaintextPayload {
            phase: "candidate_request".into(),
            offer_id: "offer-1".into(),
            candidate_user_id: "user-next".into(),
            candidate_device_id: "device-next".into(),
            candidate_leaf: 7,
        };
        let accepted = HostHandoffAcceptedPlaintextPayload {
            phase: "accepted".into(),
            offer_id: "offer-1".into(),
            host_user_id: "user-next".into(),
            host_device_id: "device-next".into(),
            host_leaf: 7,
            committed_epoch: 2,
        };
        let envelope: MlsRelayMessage = multaiplayer_protocol::from_json(
            r#"{"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","teamId":"team-1","roomId":"room-1","senderDeviceId":"device-host","senderUserId":"user-host","createdAt":"2026-07-20T00:01:00Z","messageType":"commit","epochHint":1,"mlsMessage":"AA==","commitEffect":"host_handoff","nextHostUserId":"user-next","nextHostDeviceId":"device-next","hostTransferAuthorization":{"version":2,"transferId":"offer-1","roomId":"room-1","commitMessageId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","parentEpoch":1,"outgoingHostUserId":"user-host","outgoingHostDeviceId":"device-host","nextHostUserId":"user-next","nextHostDeviceId":"device-next","nextHostLeaf":7,"signatureDer":"AA==","publicKeySpkiDer":"AA=="}}"#,
        )
        .unwrap();

        for informational_first in [false, true] {
            let mut state = HandoffState {
                offers: vec![offer()],
            };
            assert!(state.request_candidate(&request));
            if informational_first {
                assert!(state.accept_informational(&accepted, "user-host", "2026-07-20T00:01:01Z"));
            }
            assert!(state.accept_committed(&envelope));
            assert!(state.accept_informational(&accepted, "user-host", "2026-07-20T00:01:01Z"));
            assert_eq!(
                state.offer("offer-1").unwrap().status,
                HostHandoffStatus::Accepted
            );
        }
    }
}
