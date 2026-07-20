use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{
    validation::{
        bounded, canonical_base64, date_parseable, datetime, deserialize_optional_non_null,
        device_id, fingerprint, relay_id, safe_u64, sha256_hash, user_id, ProtocolError, Validate,
        MAX_DISPLAY_NAME_CHARS, MAX_ENVELOPE_ID_CHARS, MAX_MEDIUM_TEXT_CHARS, MAX_URL_CHARS,
    },
    RoomRecord, TeamRecord,
};

pub const PINNED_MLS_CIPHERSUITE: u16 = 0x0002;

macro_rules! string_enum {
    ($name:ident { $($variant:ident => $wire:literal),+ $(,)? }) => {
        #[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
        pub enum $name {
            $(#[serde(rename = $wire)] $variant),+
        }

        impl Validate for $name {
            fn validate(&self) -> Result<(), ProtocolError> { Ok(()) }
        }
    };
}

string_enum!(MlsMessageType {
    Application => "application",
    Commit => "commit",
});

string_enum!(CommitEffect {
    HostHandoff => "host_handoff",
});

string_enum!(PresenceStatus {
    Online => "online",
    Offline => "offline",
});

string_enum!(RelayErrorCode {
    InvalidMessage => "invalid_message",
    MessageTooLarge => "message_too_large",
    NotJoined => "not_joined",
    NotActiveHost => "not_active_host",
    StaleEpoch => "stale_epoch",
    ApplicationEpochExpired => "application_epoch_expired",
    MembershipRemoved => "membership_removed",
    KeyPackageInvalid => "key_package_invalid",
    KeyPackageUnavailable => "key_package_unavailable",
    CapacityExceeded => "capacity_exceeded",
});

string_enum!(RelayHttpErrorCode {
    InvalidRequest => "invalid_request",
    AuthenticationRequired => "authentication_required",
    AccountDeletionBlocked => "account_deletion_blocked",
    AccountRestricted => "account_restricted",
    DeviceAuthRequired => "device_auth_required",
    Forbidden => "forbidden",
    NotFound => "not_found",
    TeamNotFound => "team_not_found",
    TeamMemberNotFound => "team_member_not_found",
    RoomNotFound => "room_not_found",
    InviteNotFound => "invite_not_found",
    InviteExpired => "invite_expired",
    Conflict => "conflict",
    RateLimited => "rate_limited",
    QuotaExceeded => "quota_exceeded",
    PayloadTooLarge => "payload_too_large",
    CapacityExceeded => "capacity_exceeded",
    PersistenceUnavailable => "persistence_unavailable",
    UpstreamUnavailable => "upstream_unavailable",
    RelayShuttingDown => "relay_shutting_down",
    KeyPackageInvalid => "key_package_invalid",
    KeyPackageUnavailable => "key_package_unavailable",
    InternalError => "internal_error",
});

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostTransferAuthorization {
    pub version: u8,
    pub transfer_id: String,
    pub room_id: String,
    pub commit_message_id: String,
    pub parent_epoch: u64,
    pub outgoing_host_user_id: String,
    pub outgoing_host_device_id: String,
    pub next_host_user_id: String,
    pub next_host_device_id: String,
    pub next_host_leaf: u64,
    pub signature_der: String,
    pub public_key_spki_der: String,
}

impl Validate for HostTransferAuthorization {
    fn validate(&self) -> Result<(), ProtocolError> {
        if self.version != 2 {
            return Err(ProtocolError::invalid(
                "host transfer authorization requires version 2",
            ));
        }
        bounded(
            "hostTransfer.transferId",
            &self.transfer_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        relay_id("hostTransfer.roomId", &self.room_id)?;
        if self.commit_message_id.len() != 64
            || !self
                .commit_message_id
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Err(ProtocolError::invalid(
                "hostTransfer.commitMessageId must be 64 lowercase hexadecimal digits",
            ));
        }
        safe_u64("hostTransfer.parentEpoch", self.parent_epoch)?;
        user_id(
            "hostTransfer.outgoingHostUserId",
            &self.outgoing_host_user_id,
        )?;
        device_id(
            "hostTransfer.outgoingHostDeviceId",
            &self.outgoing_host_device_id,
        )?;
        user_id("hostTransfer.nextHostUserId", &self.next_host_user_id)?;
        device_id("hostTransfer.nextHostDeviceId", &self.next_host_device_id)?;
        safe_u64("hostTransfer.nextHostLeaf", self.next_host_leaf)?;
        canonical_base64("hostTransfer.signatureDer", &self.signature_der, 4)?;
        canonical_base64(
            "hostTransfer.publicKeySpkiDer",
            &self.public_key_spki_der,
            4,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MlsRelayMessage {
    pub id: String,
    pub team_id: String,
    pub room_id: String,
    pub sender_device_id: String,
    pub sender_user_id: String,
    pub created_at: String,
    pub message_type: MlsMessageType,
    pub epoch_hint: u64,
    pub mls_message: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub commit_effect: Option<CommitEffect>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub next_host_user_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub next_host_device_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub host_transfer_authorization: Option<HostTransferAuthorization>,
}

impl Validate for MlsRelayMessage {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded("mls.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        relay_id("mls.teamId", &self.team_id)?;
        relay_id("mls.roomId", &self.room_id)?;
        device_id("mls.senderDeviceId", &self.sender_device_id)?;
        user_id("mls.senderUserId", &self.sender_user_id)?;
        datetime("mls.createdAt", &self.created_at)?;
        safe_u64("mls.epochHint", self.epoch_hint)?;
        canonical_base64("mls.mlsMessage", &self.mls_message, 4)?;
        if let Some(value) = &self.next_host_user_id {
            user_id("mls.nextHostUserId", value)?;
        }
        if let Some(value) = &self.next_host_device_id {
            device_id("mls.nextHostDeviceId", value)?;
        }
        if let Some(value) = &self.host_transfer_authorization {
            value.validate()?;
        }
        let complete_handoff = self.commit_effect.is_some()
            && self.next_host_user_id.is_some()
            && self.next_host_device_id.is_some()
            && self.host_transfer_authorization.is_some();
        let any_handoff = self.commit_effect.is_some()
            || self.next_host_user_id.is_some()
            || self.next_host_device_id.is_some()
            || self.host_transfer_authorization.is_some();
        if any_handoff && (!complete_handoff || self.message_type != MlsMessageType::Commit) {
            return Err(ProtocolError::invalid(
                "host handoff metadata requires a Commit and both next-host ids",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPackageUpload {
    pub id: String,
    pub key_package: String,
    pub key_package_hash: String,
    pub ciphersuite: u16,
}

impl Validate for KeyPackageUpload {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded("keyPackage.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded("keyPackage.keyPackage", &self.key_package, 1, usize::MAX)?;
        sha256_hash("keyPackage.keyPackageHash", &self.key_package_hash)?;
        if self.ciphersuite == PINNED_MLS_CIPHERSUITE {
            Ok(())
        } else {
            Err(ProtocolError::invalid(
                "key package ciphersuite must be the protocol-v2 pinned suite",
            ))
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPackageRecord {
    #[serde(flatten)]
    pub upload: KeyPackageUpload,
    pub user_id: String,
    pub device_id: String,
    pub credential_identity: String,
    pub created_at: String,
}

impl Validate for KeyPackageRecord {
    fn validate(&self) -> Result<(), ProtocolError> {
        self.upload.validate()?;
        user_id("keyPackage.userId", &self.user_id)?;
        device_id("keyPackage.deviceId", &self.device_id)?;
        bounded(
            "keyPackage.credentialIdentity",
            &self.credential_identity,
            1,
            usize::MAX,
        )?;
        datetime("keyPackage.createdAt", &self.created_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub team_id: String,
    pub room_id: String,
    pub user_id: String,
    pub device_id: String,
    pub display_name: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub avatar_url: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub public_key_fingerprint: Option<String>,
}

impl Validate for PresenceMessage {
    fn validate(&self) -> Result<(), ProtocolError> {
        if self.message_type != "presence" {
            return Err(ProtocolError::invalid("presence.type must be presence"));
        }
        validate_presence_fields(
            &self.team_id,
            &self.room_id,
            &self.user_id,
            &self.device_id,
            &self.display_name,
            self.avatar_url.as_deref(),
            self.public_key_fingerprint.as_deref(),
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type")]
pub enum RelayClientMessage {
    #[serde(rename = "join", rename_all = "camelCase")]
    Join {
        team_id: String,
        room_id: String,
        user_id: String,
        device_id: String,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        invite_id: Option<String>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        device_session_token: Option<String>,
    },
    #[serde(rename = "subscribe.team", rename_all = "camelCase")]
    SubscribeTeam {
        team_id: String,
        user_id: String,
        device_id: String,
    },
    #[serde(rename = "subscribe.workspace", rename_all = "camelCase")]
    SubscribeWorkspace { user_id: String, device_id: String },
    #[serde(rename = "publish")]
    Publish { message: Box<MlsRelayMessage> },
    #[serde(rename = "presence", rename_all = "camelCase")]
    Presence {
        team_id: String,
        room_id: String,
        user_id: String,
        device_id: String,
        display_name: String,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        avatar_url: Option<String>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        public_key_fingerprint: Option<String>,
    },
}

impl Validate for RelayClientMessage {
    fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::Join {
                team_id,
                room_id,
                user_id: user,
                device_id: device,
                invite_id,
                device_session_token,
            } => {
                relay_id("join.teamId", team_id)?;
                relay_id("join.roomId", room_id)?;
                user_id("join.userId", user)?;
                device_id("join.deviceId", device)?;
                if let Some(value) = invite_id {
                    bounded("join.inviteId", value, 1, MAX_ENVELOPE_ID_CHARS)?;
                }
                if let Some(value) = device_session_token {
                    bounded("join.deviceSessionToken", value, 32, 256)?;
                }
                Ok(())
            }
            Self::SubscribeTeam {
                team_id,
                user_id: user,
                device_id: device,
            } => {
                relay_id("subscribe.teamId", team_id)?;
                user_id("subscribe.userId", user)?;
                device_id("subscribe.deviceId", device)
            }
            Self::SubscribeWorkspace {
                user_id: user,
                device_id: device,
            } => {
                user_id("subscribe.userId", user)?;
                device_id("subscribe.deviceId", device)
            }
            Self::Publish { message } => message.validate(),
            Self::Presence {
                team_id,
                room_id,
                user_id: user,
                device_id: device,
                display_name,
                avatar_url,
                public_key_fingerprint,
            } => validate_presence_fields(
                team_id,
                room_id,
                user,
                device,
                display_name,
                avatar_url.as_deref(),
                public_key_fingerprint.as_deref(),
            ),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type")]
pub enum RelayServerMessage {
    #[serde(rename = "joined", rename_all = "camelCase")]
    Joined { team_id: String, room_id: String },
    #[serde(rename = "team.subscribed", rename_all = "camelCase")]
    TeamSubscribed { team_id: String },
    #[serde(rename = "workspace.subscribed")]
    WorkspaceSubscribed,
    #[serde(rename = "invite.requested", rename_all = "camelCase")]
    InviteRequested {
        invite_id: String,
        request_id: String,
    },
    #[serde(rename = "published", rename_all = "camelCase")]
    Published { message_id: String },
    #[serde(rename = "mls.message")]
    MlsMessage { message: Box<MlsRelayMessage> },
    #[serde(rename = "presence", rename_all = "camelCase")]
    Presence {
        team_id: String,
        room_id: String,
        user_id: String,
        device_id: String,
        display_name: String,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        avatar_url: Option<String>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        public_key_fingerprint: Option<String>,
        status: PresenceStatus,
    },
    #[serde(rename = "room.updated")]
    RoomUpdated { room: RoomRecord },
    #[serde(rename = "team.updated")]
    TeamUpdated { team: TeamRecord },
    #[serde(rename = "error", rename_all = "camelCase")]
    Error {
        message: String,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        code: Option<RelayErrorCode>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        message_id: Option<String>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        team_id: Option<String>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        room_id: Option<String>,
    },
}

impl Validate for RelayServerMessage {
    fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::Joined { team_id, room_id } => {
                relay_id("joined.teamId", team_id)?;
                relay_id("joined.roomId", room_id)
            }
            Self::TeamSubscribed { team_id } => relay_id("teamSubscribed.teamId", team_id),
            Self::WorkspaceSubscribed => Ok(()),
            Self::InviteRequested {
                invite_id,
                request_id,
            } => {
                bounded(
                    "inviteRequested.inviteId",
                    invite_id,
                    1,
                    MAX_ENVELOPE_ID_CHARS,
                )?;
                bounded(
                    "inviteRequested.requestId",
                    request_id,
                    1,
                    MAX_ENVELOPE_ID_CHARS,
                )
            }
            Self::Published { message_id } => {
                bounded("published.messageId", message_id, 1, MAX_ENVELOPE_ID_CHARS)
            }
            Self::MlsMessage { message } => message.validate(),
            Self::Presence {
                team_id,
                room_id,
                user_id: user,
                device_id: device,
                display_name,
                avatar_url,
                public_key_fingerprint,
                ..
            } => validate_presence_fields(
                team_id,
                room_id,
                user,
                device,
                display_name,
                avatar_url.as_deref(),
                public_key_fingerprint.as_deref(),
            ),
            Self::RoomUpdated { room } => room.validate(),
            Self::TeamUpdated { team } => team.validate(),
            Self::Error {
                message,
                message_id,
                team_id,
                room_id,
                ..
            } => {
                bounded("error.message", message, 0, MAX_MEDIUM_TEXT_CHARS)?;
                if let Some(value) = message_id {
                    bounded("error.messageId", value, 1, MAX_ENVELOPE_ID_CHARS)?;
                }
                if let Some(value) = team_id {
                    relay_id("error.teamId", value)?;
                }
                if let Some(value) = room_id {
                    relay_id("error.roomId", value)?;
                }
                Ok(())
            }
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct RelayHttpErrorResponse {
    pub error: String,
    pub code: RelayHttpErrorCode,
    #[serde(flatten)]
    pub context: Map<String, Value>,
}

impl Validate for RelayHttpErrorResponse {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded("httpError.error", &self.error, 1, MAX_MEDIUM_TEXT_CHARS)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MlsAuthenticatedData {
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

impl Validate for MlsAuthenticatedData {
    fn validate(&self) -> Result<(), ProtocolError> {
        if self.version != 1 {
            return Err(ProtocolError::invalid(
                "MLS authenticated data requires version 1",
            ));
        }
        safe_u64("authenticatedData.epoch", self.epoch)?;
        bounded("authenticatedData.messageId", &self.message_id, 1, 128)?;
        if !self
            .message_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(ProtocolError::invalid(
                "authenticatedData.messageId contains unsupported characters",
            ));
        }
        for (field, value, max) in [
            ("teamId", self.team_id.as_str(), 128),
            ("roomId", self.room_id.as_str(), 128),
            ("kind", self.kind.as_str(), 128),
            ("senderUserId", self.sender_user_id.as_str(), 128),
            ("senderDeviceId", self.sender_device_id.as_str(), 128),
            ("createdAt", self.created_at.as_str(), 64),
        ] {
            bounded(&format!("authenticatedData.{field}"), value, 1, max)?;
            if value.bytes().any(|byte| byte.is_ascii_control()) {
                return Err(ProtocolError::invalid(format!(
                    "authenticatedData.{field} contains an ASCII control character"
                )));
            }
        }
        date_parseable("authenticatedData.createdAt", &self.created_at)
    }
}

fn validate_presence_fields(
    team: &str,
    room: &str,
    user: &str,
    device: &str,
    display_name: &str,
    avatar_url: Option<&str>,
    public_key_fingerprint: Option<&str>,
) -> Result<(), ProtocolError> {
    relay_id("presence.teamId", team)?;
    relay_id("presence.roomId", room)?;
    user_id("presence.userId", user)?;
    device_id("presence.deviceId", device)?;
    bounded(
        "presence.displayName",
        display_name,
        1,
        MAX_DISPLAY_NAME_CHARS,
    )?;
    if let Some(value) = avatar_url {
        bounded("presence.avatarUrl", value, 0, MAX_URL_CHARS)?;
    }
    if let Some(value) = public_key_fingerprint {
        fingerprint("presence.publicKeyFingerprint", value)?;
    }
    Ok(())
}
