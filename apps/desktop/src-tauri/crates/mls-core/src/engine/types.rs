use crate::BasicAppCredential;

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExporterCiphertext {
    pub version: u8,
    pub epoch: u64,
    #[serde(with = "canonical_base64")]
    pub nonce: Vec<u8>,
    #[serde(with = "canonical_base64")]
    pub ciphertext: Vec<u8>,
}

mod canonical_base64 {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde::{de::Error, Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &[u8], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&STANDARD.encode(value))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let encoded = String::deserialize(deserializer)?;
        let decoded = STANDARD.decode(&encoded).map_err(D::Error::custom)?;
        if STANDARD.encode(&decoded) != encoded {
            return Err(D::Error::custom("base64 is not canonical padded encoding"));
        }
        Ok(decoded)
    }
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AddMemberOutput {
    pub commit: Vec<u8>,
    pub welcome: Vec<u8>,
    pub epoch: u64,
    pub commit_outbox_id: String,
    pub welcome_outbox_id: String,
}
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WelcomeRetryMetadata {
    pub invite_id: String,
    pub request_id: String,
    pub requester_user_id: String,
    pub requester_device_id: String,
    pub key_package_id: String,
    pub key_package_hash: String,
    pub response_binding: crate::CapabilityBinding,
    pub response_mac: String,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JoinAdmissionMetadata {
    pub invite_id: String,
    pub team_id: String,
    pub room_id: String,
    pub request_id: String,
    pub requester_user_id: String,
    pub requester_device_id: String,
}
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum OutboxMetadata {
    Application {
        authenticated_data: Vec<u8>,
    },
    Commit {
        parent_epoch: u64,
    },
    Welcome(WelcomeRetryMetadata),
    HostTransfer(HostTransferAuthorizationPayload),
    InviteResponse {
        binding: crate::CapabilityBinding,
        mac: String,
    },
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ApplicationOutput {
    pub sender_leaf: u32,
    pub epoch: u64,
    pub authenticated_data: Vec<u8>,
    pub payload: Vec<u8>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutboundApplication {
    pub message: Vec<u8>,
    pub outbox_id: String,
    pub epoch: u64,
    pub authenticated_data: Vec<u8>,
}
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicationAuthenticatedDataInput {
    pub version: u8,
    pub message_id: String,
    pub team_id: String,
    pub room_id: String,
    pub kind: String,
    pub sender_user_id: String,
    pub sender_device_id: String,
    pub created_at: String,
}
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicationAuthenticatedData {
    pub version: u8,
    pub epoch: u64,
    pub message_id: String,
    pub team_id: String,
    pub room_id: String,
    pub kind: String,
    pub sender_user_id: String,
    pub sender_device_id: String,
    pub created_at: String,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutboundCommit {
    pub message: Vec<u8>,
    pub outbox_id: String,
    pub parent_epoch: u64,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RosterMember {
    pub leaf: u32,
    pub credential: BasicAppCredential,
}
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostTransferAuthorizationPayload {
    pub version: u8,
    pub transfer_id: String,
    pub room_id: String,
    pub commit_message_id: String,
    pub parent_epoch: u64,
    pub outgoing_host_user_id: String,
    pub outgoing_host_device_id: String,
    pub next_host_user_id: String,
    pub next_host_device_id: String,
    pub next_host_leaf: u32,
}
