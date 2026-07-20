use serde::{Deserialize, Serialize};

use crate::validation::{
    bounded, canonical_base64, datetime, deserialize_optional_non_null, device_id, fingerprint,
    relay_id, safe_u64, sha256_hash, user_id, validate_optional, ProtocolError, Validate,
    MAX_CODEX_MODEL_CHARS, MAX_DISPLAY_NAME_CHARS, MAX_ENVELOPE_ID_CHARS, MAX_PROJECT_PATH_CHARS,
    MAX_ROOM_NAME_CHARS, MAX_SHORT_TEXT_CHARS,
};

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

string_enum!(TeamRole {
    Owner => "owner",
    Admin => "admin",
    Member => "member",
});

string_enum!(HostStatus {
    Active => "active",
    Offline => "offline",
});

string_enum!(ApprovalPolicy {
    AskEveryTurn => "ask_every_turn",
    NeverHost => "never_host",
});

string_enum!(CatalogSelectionPolicy {
    Auto => "auto",
    Pinned => "pinned",
});

string_enum!(CodexReasoningEffort {
    None => "none",
    Minimal => "minimal",
    Low => "low",
    Medium => "medium",
    High => "high",
    Xhigh => "xhigh",
    Max => "max",
});

string_enum!(CodexSpeed {
    Standard => "standard",
    Fast => "fast",
});

string_enum!(CodexSandboxLevel {
    ReadOnly => "read_only",
    WorkspaceWrite => "workspace_write",
    WorkspaceWriteNetwork => "workspace_write_network",
    DangerFullAccess => "danger_full_access",
});

string_enum!(InviteResponseStatus {
    Approved => "approved",
    Denied => "denied",
});

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamRecord {
    pub id: String,
    pub name: String,
    pub members: u64,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub role: Option<TeamRole>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub archived_at: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub deleted_at: Option<String>,
}

impl Validate for TeamRecord {
    fn validate(&self) -> Result<(), ProtocolError> {
        relay_id("team.id", &self.id)?;
        bounded("team.name", &self.name, 1, MAX_DISPLAY_NAME_CHARS)?;
        safe_u64("team.members", self.members)?;
        if let Some(value) = &self.archived_at {
            datetime("team.archivedAt", value)?;
        }
        if let Some(value) = &self.deleted_at {
            datetime("team.deletedAt", value)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberRecord {
    pub team_id: String,
    pub user_id: String,
    pub role: TeamRole,
    pub joined_at: String,
}

impl Validate for TeamMemberRecord {
    fn validate(&self) -> Result<(), ProtocolError> {
        relay_id("teamMember.teamId", &self.team_id)?;
        user_id("teamMember.userId", &self.user_id)?;
        datetime("teamMember.joinedAt", &self.joined_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRecord {
    pub user_id: String,
    pub device_id: String,
    pub display_name: String,
    pub signature_public_key: String,
    pub signature_key_fingerprint: String,
    pub hpke_public_key: String,
    pub hpke_key_fingerprint: String,
    pub registered_at: String,
    pub last_seen_at: String,
}

impl Validate for DeviceRecord {
    fn validate(&self) -> Result<(), ProtocolError> {
        user_id("device.userId", &self.user_id)?;
        device_id("device.deviceId", &self.device_id)?;
        bounded(
            "device.displayName",
            &self.display_name,
            1,
            MAX_DISPLAY_NAME_CHARS,
        )?;
        bounded(
            "device.signaturePublicKey",
            &self.signature_public_key,
            1,
            4_096,
        )?;
        fingerprint(
            "device.signatureKeyFingerprint",
            &self.signature_key_fingerprint,
        )?;
        bounded("device.hpkePublicKey", &self.hpke_public_key, 1, 4_096)?;
        fingerprint("device.hpkeKeyFingerprint", &self.hpke_key_fingerprint)?;
        datetime("device.registeredAt", &self.registered_at)?;
        datetime("device.lastSeenAt", &self.last_seen_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomRecord {
    pub id: String,
    pub team_id: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub accepted_mls_epoch: Option<u64>,
    pub name: String,
    pub host: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub host_user_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub active_host_device_id: Option<String>,
    pub host_status: HostStatus,
    pub approval_policy: ApprovalPolicy,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub archived_at: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub deleted_at: Option<String>,
}

impl Validate for RoomRecord {
    fn validate(&self) -> Result<(), ProtocolError> {
        relay_id("room.id", &self.id)?;
        relay_id("room.teamId", &self.team_id)?;
        if let Some(value) = self.accepted_mls_epoch {
            safe_u64("room.acceptedMlsEpoch", value)?;
        }
        bounded("room.name", &self.name, 1, MAX_ROOM_NAME_CHARS)?;
        bounded("room.host", &self.host, 1, MAX_DISPLAY_NAME_CHARS)?;
        if let Some(value) = &self.host_user_id {
            user_id("room.hostUserId", value)?;
        }
        if let Some(value) = &self.active_host_device_id {
            device_id("room.activeHostDeviceId", value)?;
        }
        if self.host_status == HostStatus::Active && self.host_user_id.is_none() {
            return Err(ProtocolError::invalid(
                "an active room requires a stable host user id",
            ));
        }
        if let Some(value) = &self.archived_at {
            datetime("room.archivedAt", value)?;
        }
        if let Some(value) = &self.deleted_at {
            datetime("room.deletedAt", value)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomConfig {
    pub project_path: String,
    pub codex_model: String,
    pub codex_model_policy: CatalogSelectionPolicy,
    pub codex_reasoning_effort: CodexReasoningEffort,
    pub codex_reasoning_effort_policy: CatalogSelectionPolicy,
    pub codex_raw_reasoning_enabled: bool,
    pub codex_speed: CodexSpeed,
    pub codex_service_tier_policy: CatalogSelectionPolicy,
    pub codex_sandbox_level: CodexSandboxLevel,
    pub config_revision: u64,
    pub config_epoch: u64,
    pub config_pending: bool,
}

impl Validate for RoomConfig {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded(
            "roomConfig.projectPath",
            &self.project_path,
            1,
            MAX_PROJECT_PATH_CHARS,
        )?;
        bounded(
            "roomConfig.codexModel",
            &self.codex_model,
            1,
            MAX_CODEX_MODEL_CHARS,
        )?;
        safe_u64("roomConfig.configRevision", self.config_revision)?;
        safe_u64("roomConfig.configEpoch", self.config_epoch)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ClientRoomRecord {
    #[serde(flatten)]
    pub room: RoomRecord,
    #[serde(flatten)]
    pub config: RoomConfig,
    pub unread: u64,
}

impl Validate for ClientRoomRecord {
    fn validate(&self) -> Result<(), ProtocolError> {
        self.room.validate()?;
        self.config.validate()?;
        safe_u64("clientRoom.unread", self.unread)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteRecord {
    pub id: String,
    pub team_id: String,
    pub room_id: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub creator_user_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub approved_user_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub approved_device_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub key_package_hash: Option<String>,
    pub created_at: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub expires_at: Option<String>,
}

impl Validate for InviteRecord {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded("invite.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        relay_id("invite.teamId", &self.team_id)?;
        relay_id("invite.roomId", &self.room_id)?;
        if let Some(value) = &self.creator_user_id {
            user_id("invite.creatorUserId", value)?;
        }
        if let Some(value) = &self.approved_user_id {
            user_id("invite.approvedUserId", value)?;
        }
        if let Some(value) = &self.approved_device_id {
            device_id("invite.approvedDeviceId", value)?;
        }
        if let Some(value) = &self.key_package_hash {
            sha256_hash("invite.keyPackageHash", value)?;
        }
        datetime("invite.createdAt", &self.created_at)?;
        if let Some(value) = &self.expires_at {
            datetime("invite.expiresAt", value)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteJoinRequestRecord {
    pub request_id: String,
    pub invite_id: String,
    pub requester_user_id: String,
    pub requester_device_id: String,
    pub key_package_id: String,
    pub key_package_hash: String,
    pub sealed_request: String,
    pub created_at: String,
}

impl Validate for InviteJoinRequestRecord {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded(
            "inviteRequest.requestId",
            &self.request_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        bounded(
            "inviteRequest.inviteId",
            &self.invite_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        user_id("inviteRequest.requesterUserId", &self.requester_user_id)?;
        device_id("inviteRequest.requesterDeviceId", &self.requester_device_id)?;
        bounded(
            "inviteRequest.keyPackageId",
            &self.key_package_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        sha256_hash("inviteRequest.keyPackageHash", &self.key_package_hash)?;
        bounded(
            "inviteRequest.sealedRequest",
            &self.sealed_request,
            1,
            usize::MAX,
        )?;
        datetime("inviteRequest.createdAt", &self.created_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InviteResponseBinding {
    pub version: u8,
    pub phase: String,
    pub invite_id: String,
    pub team_id: String,
    pub room_id: String,
    pub key_epoch: u64,
    pub key_package_hash: String,
    pub request_id: String,
    pub request_nonce: String,
    pub requester_user_id: String,
    pub requester_device_id: String,
    pub host_user_id: String,
    pub host_device_id: String,
    pub expires_at: String,
    pub status: InviteResponseStatus,
    pub decided_at: String,
}

impl Validate for InviteResponseBinding {
    fn validate(&self) -> Result<(), ProtocolError> {
        if self.version != 3 || self.phase != "response" {
            return Err(ProtocolError::invalid(
                "invite response binding requires version 3 and response phase",
            ));
        }
        bounded(
            "responseBinding.inviteId",
            &self.invite_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        relay_id("responseBinding.teamId", &self.team_id)?;
        relay_id("responseBinding.roomId", &self.room_id)?;
        safe_u64("responseBinding.keyEpoch", self.key_epoch)?;
        sha256_hash("responseBinding.keyPackageHash", &self.key_package_hash)?;
        bounded(
            "responseBinding.requestId",
            &self.request_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        bounded(
            "responseBinding.requestNonce",
            &self.request_nonce,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        user_id("responseBinding.requesterUserId", &self.requester_user_id)?;
        device_id(
            "responseBinding.requesterDeviceId",
            &self.requester_device_id,
        )?;
        user_id("responseBinding.hostUserId", &self.host_user_id)?;
        device_id("responseBinding.hostDeviceId", &self.host_device_id)?;
        datetime("responseBinding.expiresAt", &self.expires_at)?;
        datetime("responseBinding.decidedAt", &self.decided_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteResponseRecord {
    pub request_id: String,
    pub invite_id: String,
    pub requester_user_id: String,
    pub requester_device_id: String,
    pub key_package_hash: String,
    pub status: InviteResponseStatus,
    pub response_binding: InviteResponseBinding,
    pub response_mac: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub welcome: Option<String>,
    pub created_at: String,
}

impl Validate for InviteResponseRecord {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded(
            "inviteResponse.requestId",
            &self.request_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        bounded(
            "inviteResponse.inviteId",
            &self.invite_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        user_id("inviteResponse.requesterUserId", &self.requester_user_id)?;
        device_id(
            "inviteResponse.requesterDeviceId",
            &self.requester_device_id,
        )?;
        sha256_hash("inviteResponse.keyPackageHash", &self.key_package_hash)?;
        self.response_binding.validate()?;
        canonical_base64("inviteResponse.responseMac", &self.response_mac, 0)?;
        match (&self.status, &self.welcome) {
            (InviteResponseStatus::Approved, Some(welcome)) => {
                bounded("inviteResponse.welcome", welcome, 1, usize::MAX)?;
            }
            (InviteResponseStatus::Denied, None) => {}
            _ => {
                return Err(ProtocolError::invalid(
                    "approved responses require Welcome; denied responses forbid it",
                ));
            }
        }
        datetime("inviteResponse.createdAt", &self.created_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentBlobRecord {
    pub id: String,
    pub team_id: String,
    pub room_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub media_type: String,
    pub size: u64,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub uploaded_by_user_id: Option<String>,
    pub epoch: u64,
    pub sealed_blob: String,
    pub created_at: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub expires_at: Option<String>,
}

impl Validate for AttachmentBlobRecord {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded("attachment.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        relay_id("attachment.teamId", &self.team_id)?;
        relay_id("attachment.roomId", &self.room_id)?;
        bounded("attachment.name", &self.name, 1, MAX_SHORT_TEXT_CHARS)?;
        bounded("attachment.type", &self.media_type, 1, 160)?;
        safe_u64("attachment.size", self.size)?;
        if let Some(value) = &self.uploaded_by_user_id {
            user_id("attachment.uploadedByUserId", value)?;
        }
        safe_u64("attachment.epoch", self.epoch)?;
        bounded("attachment.sealedBlob", &self.sealed_blob, 1, usize::MAX)?;
        datetime("attachment.createdAt", &self.created_at)?;
        if let Some(value) = &self.expires_at {
            datetime("attachment.expiresAt", value)?;
        }
        Ok(())
    }
}

impl<T: Validate> Validate for Vec<T> {
    fn validate(&self) -> Result<(), ProtocolError> {
        for value in self {
            value.validate()?;
        }
        Ok(())
    }
}

impl<T: Validate> Validate for Option<T> {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_optional(self)
    }
}
