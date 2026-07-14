use mls_core::{
    ApplicationAuthenticatedDataInput, CapabilityBinding, ExporterCiphertext,
    HostTransferAuthorizationPayload, OutboxMetadata, SealedPayload,
};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StoredMlsIdentity {
    pub(super) version: u8,
    pub(super) github_user_id: String,
    pub(super) device_id: String,
    pub(super) signing_secret: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct IdentityInitializeRequest {
    pub(super) github_user_id: String,
    pub(super) device_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IdentityPublic {
    pub(super) github_user_id: String,
    pub(super) device_id: String,
    pub(super) ciphersuite: u16,
    pub(super) signature_public_key: String,
    pub(super) signature_key_fingerprint: String,
    pub(super) hpke_public_key: String,
    pub(super) hpke_key_fingerprint: String,
    pub(super) requires_rejoin: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeyPackagePublish {
    pub(super) id: String,
    pub(super) key_package: String,
    pub(super) key_package_hash: String,
    pub(super) ciphersuite: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RosterPublic {
    pub(super) roster: Vec<RosterEntry>,
    pub(super) self_leaf: u32,
    pub(super) epoch: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RosterEntry {
    pub(super) leaf: u32,
    pub(super) github_user_id: String,
    pub(super) device_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapabilityIssueResponse {
    pub(super) capability_handle: String,
    pub(super) capability_url_value: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InviteRequestSealRequest {
    pub(super) recipient_hpke_public_key: String,
    pub(super) capability_handle: String,
    pub(super) capability_url_value: String,
    pub(super) binding: CapabilityBinding,
    pub(super) key_package: String,
    pub(super) key_package_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InviteRequestSealResponse {
    pub(super) key_package_hash: String,
    pub(super) sealed_request: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingInviteRequestPublic {
    pub(super) invite_id: String,
    pub(super) team_id: String,
    pub(super) room_id: String,
    pub(super) request_id: String,
    pub(super) requester_user_id: String,
    pub(super) requester_device_id: String,
    pub(super) key_package_id: String,
    pub(super) key_package_hash: String,
    pub(super) expires_at: String,
    pub(super) sealed_request: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InviteRequestOpenRequest {
    pub(super) binding: CapabilityBinding,
    pub(super) sealed_payload: SealedPayload,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InviteRequestPayload {
    pub(super) capability_handle: String,
    pub(super) binding: CapabilityBinding,
    pub(super) key_package: String,
    pub(super) mac: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InviteRequestOpenResponse {
    pub(super) capability_handle: String,
    pub(super) binding: CapabilityBinding,
    pub(super) key_package: String,
    pub(super) mac: String,
    pub(super) requester_signature_public_key: String,
    pub(super) requester_signature_key_fingerprint: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InviteApproveRequest {
    pub(super) capability_handle: String,
    pub(super) binding: CapabilityBinding,
    pub(super) mac: String,
    pub(super) key_package: String,
    pub(super) key_package_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InviteDenyRequest {
    pub(super) capability_handle: String,
    pub(super) binding: CapabilityBinding,
    pub(super) mac: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InviteDenyResponse {
    pub(super) outbox_id: String,
    pub(super) response_binding: CapabilityBinding,
    pub(super) response_mac: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InviteResponseAcceptRequest {
    pub(super) capability_url_value: String,
    pub(super) original_binding: CapabilityBinding,
    pub(super) response_binding: CapabilityBinding,
    pub(super) response_mac: String,
    pub(super) welcome: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PendingInviteResponseAcceptRequest {
    pub(super) request_id: String,
    pub(super) response_binding: CapabilityBinding,
    pub(super) response_mac: String,
    pub(super) welcome: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PendingInviteCompleteRequest {
    pub(super) request_id: String,
    pub(super) room_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InviteResponseAcceptResponse {
    pub(super) status: String,
    pub(super) epoch: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingJoinAdmissionPublic {
    pub(super) invite_id: String,
    pub(super) team_id: String,
    pub(super) room_id: String,
    pub(super) request_id: String,
    pub(super) requester_user_id: String,
    pub(super) requester_device_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct JoinAdmissionCompleteRequest {
    pub(super) room_id: String,
    pub(super) request_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InviteApproveResponse {
    pub(super) epoch: u64,
    pub(super) commit_outbox_id: String,
    pub(super) welcome_outbox_id: String,
    pub(super) response_binding: CapabilityBinding,
    pub(super) response_mac: String,
    pub(super) requester_signature_public_key: String,
    pub(super) requester_signature_key_fingerprint: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BlobEncryptRequest {
    pub(super) room_id: String,
    pub(super) blob_id: String,
    pub(super) plaintext: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BlobPrepareRequest {
    pub(super) room_id: String,
    pub(super) blob_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BlobDecryptRequest {
    pub(super) room_id: String,
    pub(super) blob_id: String,
    pub(super) value: ExporterCiphertext,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistorySaveRequest {
    pub(super) room_id: String,
    pub(super) plaintext: String,
    pub(super) retention_days: u16,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistoryRetentionRequest {
    pub(super) room_id: String,
    pub(super) retention_days: u16,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistoryEpochRequest {
    pub(super) room_id: String,
    pub(super) epoch: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeviceAuthRequest {
    pub(super) challenge: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceAuthResponse {
    pub(super) signature_der: String,
    pub(super) public_key_spki_der: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RoomRequest {
    pub(super) room_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PublishSucceededRequest {
    pub(super) room_id: String,
    pub(super) message_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClearPendingRequest {
    pub(super) room_id: String,
    pub(super) expected_message_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutboxPublic {
    pub(super) id: String,
    pub(super) room_id: String,
    pub(super) epoch: u64,
    pub(super) kind: String,
    pub(super) payload: String,
    pub(super) metadata: Option<OutboxMetadata>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct JoinRequest {
    pub(super) room_id: String,
    pub(super) welcome: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EncryptRequest {
    pub(super) room_id: String,
    pub(super) message_id: String,
    pub(super) payload: String,
    pub(super) authenticated_data: ApplicationAuthenticatedDataInput,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct IncomingRequest {
    pub(super) room_id: String,
    pub(super) message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IncomingApplication {
    pub(super) sender_leaf: u32,
    pub(super) epoch: u64,
    pub(super) authenticated_data: String,
    pub(super) payload: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutboundApplicationResponse {
    pub(super) message: String,
    pub(super) outbox_id: String,
    pub(super) epoch: u64,
    pub(super) authenticated_data: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutboundCommitResponse {
    pub(super) message: String,
    pub(super) outbox_id: String,
    pub(super) parent_epoch: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoveRequest {
    pub(super) room_id: String,
    pub(super) leaf: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TransferRequest {
    pub(super) room_id: String,
    pub(super) next_host_leaf: u32,
    pub(super) next_host_device_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HostTransferAuthorizationRequest {
    pub(super) room_id: String,
    pub(super) commit_message_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostTransferAuthorizationResponse {
    pub(super) authorization: HostTransferAuthorizationPayload,
    pub(super) signature_der: String,
    pub(super) public_key_spki_der: String,
}
