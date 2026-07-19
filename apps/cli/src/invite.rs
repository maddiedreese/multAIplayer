use crate::{
    auth::{endpoint, load_relay_transport_session, RestoredSession},
    identity::DeviceIdentity,
    mls::{
        InviteDecision, MlsClientError, MlsClientService, OpenedInviteRequest, OutboxRoute,
        PreparedInviteRequest, RelayMlsPublisher,
    },
    platform::{CredentialStore, HttpClient, HttpResponse},
    relay::{
        connect_with_retries, ReconnectPolicy, RelayConnection, ThreadSleeper,
        TungsteniteConnector, MAX_HTTP_RESPONSE_BYTES,
    },
    CliError,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use mls_core::CapabilityBinding;
use multaiplayer_protocol::{
    InviteJoinRequestRecord, InviteRecord, RelayClientMessage, RoomRecord, TeamRecord, Validate,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{fmt, time::Duration};
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

const INVITE_VERSION: u8 = 4;
const CAPABILITY_BYTES: usize = 32;
const CHECKSUM_BYTES: usize = 8;
const MAX_CODE_CHARS: usize = 12_288;
const INVITE_ORIGIN: &str = "https://open.multaiplayer.com";
const INVITE_PATH: &str = "/invite";
const NATIVE_SESSION_HEADER: &str = "x-multaiplayer-session";
const DEVICE_SESSION_HEADER: &str = "x-device-session";
const ADMISSION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Error, Clone, Copy, Eq, PartialEq)]
pub enum InviteCodeError {
    #[error("The invite code is invalid or unsupported.")]
    Invalid,
    #[error("The invite code checksum does not match.")]
    ChecksumMismatch,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum InviteError {
    #[error("Sign in with GitHub before using invites.")]
    AuthenticationRequired,
    #[error("Only the active host device can perform this invite operation.")]
    HostAuthorityRequired,
    #[error("The invite is invalid, expired, revoked, or already consumed.")]
    Unavailable,
    #[error("The invite request does not match its authenticated GitHub identity and device.")]
    IdentityMismatch,
    #[error("The invite operation could not be completed safely.")]
    RelayUnavailable,
    #[error("The invite requires explicit recovery before it can continue.")]
    RecoveryRequired,
}

impl From<InviteCodeError> for InviteError {
    fn from(_: InviteCodeError) -> Self {
        Self::Unavailable
    }
}

impl From<MlsClientError> for InviteError {
    fn from(error: MlsClientError) -> Self {
        match error {
            MlsClientError::RequiresRejoin | MlsClientError::GroupNotFound => {
                Self::RecoveryRequired
            }
            MlsClientError::InvalidInvite => Self::Unavailable,
            _ => Self::RelayUnavailable,
        }
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InviteCode {
    pub version: u8,
    pub team_id: String,
    pub room_id: String,
    pub room_name: String,
    pub capability_handle: String,
    pub capability_url_value: String,
    pub expires_at: String,
    pub host_user_id: String,
    pub host_device_id: String,
    pub host_hpke_public_key: String,
    pub host_hpke_key_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
}

impl fmt::Debug for InviteCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("InviteCode")
            .field("version", &self.version)
            .field("team_id", &self.team_id)
            .field("room_id", &self.room_id)
            .field("room_name", &self.room_name)
            .field("capability_handle", &"[redacted]")
            .field("capability_url_value", &"[redacted]")
            .field("expires_at", &self.expires_at)
            .field("host_user_id", &self.host_user_id)
            .field("host_device_id", &self.host_device_id)
            .field("host_hpke_public_key", &"[public key]")
            .field("host_hpke_key_fingerprint", &self.host_hpke_key_fingerprint)
            .field("checksum", &"[redacted]")
            .finish()
    }
}

impl InviteCode {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        team_id: String,
        room_id: String,
        room_name: String,
        capability_handle: String,
        capability_url_value: String,
        expires_at: String,
        host_user_id: String,
        host_device_id: String,
        host_hpke_public_key: String,
        host_hpke_key_fingerprint: String,
    ) -> Result<Self, InviteCodeError> {
        let mut value = Self {
            version: INVITE_VERSION,
            team_id,
            room_id,
            room_name,
            capability_handle,
            capability_url_value,
            expires_at,
            host_user_id,
            host_device_id,
            host_hpke_public_key,
            host_hpke_key_fingerprint,
            checksum: None,
        };
        value.validate_fields()?;
        value.checksum = Some(value.expected_checksum()?);
        Ok(value)
    }

    pub fn encode(&self, invite_id: &str) -> Result<String, InviteCodeError> {
        self.validate()?;
        if self.checksum.is_none() {
            return Err(InviteCodeError::Invalid);
        }
        if !bounded_token(invite_id, 160) {
            return Err(InviteCodeError::Invalid);
        }
        let json = zeroize::Zeroizing::new(
            serde_json::to_vec(self).map_err(|_| InviteCodeError::Invalid)?,
        );
        let payload = URL_SAFE_NO_PAD.encode(json);
        let encoded = format!(
            "{INVITE_ORIGIN}{INVITE_PATH}#invite={invite_id}&multaiplayerJoin={payload}&approval=request"
        );
        if encoded.len() > MAX_CODE_CHARS {
            return Err(InviteCodeError::Invalid);
        }
        Ok(encoded)
    }

    pub fn validate(&self) -> Result<(), InviteCodeError> {
        self.validate_fields()?;
        if let Some(checksum) = &self.checksum {
            if checksum != &self.expected_checksum()? {
                return Err(InviteCodeError::ChecksumMismatch);
            }
        }
        Ok(())
    }

    fn validate_fields(&self) -> Result<(), InviteCodeError> {
        if self.version != INVITE_VERSION
            || !bounded_text(&self.team_id, 160)
            || !bounded_text(&self.room_id, 160)
            || !bounded_text(&self.room_name, 120)
            || !bounded_token(&self.capability_handle, 160)
            || !valid_utc_timestamp(&self.expires_at)
            || !bounded_text(&self.host_user_id, 256)
            || !bounded_token(&self.host_device_id, 128)
            || !bounded_base64(&self.host_hpke_public_key, 4_096)
            || !valid_fingerprint(&self.host_hpke_key_fingerprint)
        {
            return Err(InviteCodeError::Invalid);
        }
        let capability = zeroize::Zeroizing::new(
            URL_SAFE_NO_PAD
                .decode(&self.capability_url_value)
                .map_err(|_| InviteCodeError::Invalid)?,
        );
        if capability.len() != CAPABILITY_BYTES
            || URL_SAFE_NO_PAD.encode(&capability) != self.capability_url_value
        {
            return Err(InviteCodeError::Invalid);
        }
        Ok(())
    }

    fn expected_checksum(&self) -> Result<String, InviteCodeError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct ChecksumInput<'a> {
            version: u8,
            team_id: &'a str,
            room_id: &'a str,
            room_name: &'a str,
            capability_handle: &'a str,
            capability_url_value: &'a str,
            expires_at: &'a str,
            host_user_id: &'a str,
            host_device_id: &'a str,
            host_hpke_public_key: &'a str,
            host_hpke_key_fingerprint: &'a str,
        }
        let canonical = zeroize::Zeroizing::new(
            serde_json::to_vec(&ChecksumInput {
                version: self.version,
                team_id: &self.team_id,
                room_id: &self.room_id,
                room_name: &self.room_name,
                capability_handle: &self.capability_handle,
                capability_url_value: &self.capability_url_value,
                expires_at: &self.expires_at,
                host_user_id: &self.host_user_id,
                host_device_id: &self.host_device_id,
                host_hpke_public_key: &self.host_hpke_public_key,
                host_hpke_key_fingerprint: &self.host_hpke_key_fingerprint,
            })
            .map_err(|_| InviteCodeError::Invalid)?,
        );
        Ok(URL_SAFE_NO_PAD.encode(&Sha256::digest(canonical)[..CHECKSUM_BYTES]))
    }
}

pub struct ParsedInviteCode {
    pub invite_id: String,
    pub invite: InviteCode,
}

impl fmt::Debug for ParsedInviteCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ParsedInviteCode")
            .field("invite_id", &"[redacted]")
            .field("invite", &self.invite)
            .finish()
    }
}

pub fn parse_invite_code(value: &str) -> Result<ParsedInviteCode, InviteCodeError> {
    if value.len() > MAX_CODE_CHARS {
        return Err(InviteCodeError::Invalid);
    }
    let url = reqwest::Url::parse(value).map_err(|_| InviteCodeError::Invalid)?;
    if url.scheme() != "https"
        || url.host_str() != Some("open.multaiplayer.com")
        || !matches!(url.path(), "/invite" | "/invite/")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
    {
        return Err(InviteCodeError::Invalid);
    }
    let fragment = url.fragment().ok_or(InviteCodeError::Invalid)?;
    let mut invite_id = None;
    let mut payload = None;
    let mut approval = None;
    let mut count = 0;
    for field in fragment.split('&') {
        count += 1;
        let (key, value) = field.split_once('=').ok_or(InviteCodeError::Invalid)?;
        if value.is_empty() || value.contains('%') {
            return Err(InviteCodeError::Invalid);
        }
        match key {
            "invite" if invite_id.is_none() => invite_id = Some(value),
            "multaiplayerJoin" if payload.is_none() => payload = Some(value),
            "approval" if approval.is_none() => approval = Some(value),
            _ => return Err(InviteCodeError::Invalid),
        }
    }
    if count != 3 || approval != Some("request") {
        return Err(InviteCodeError::Invalid);
    }
    let invite_id = invite_id.ok_or(InviteCodeError::Invalid)?;
    if !bounded_token(invite_id, 160) {
        return Err(InviteCodeError::Invalid);
    }
    let json = zeroize::Zeroizing::new(
        URL_SAFE_NO_PAD
            .decode(payload.ok_or(InviteCodeError::Invalid)?)
            .map_err(|_| InviteCodeError::Invalid)?,
    );
    let invite: InviteCode = serde_json::from_slice(&json).map_err(|_| InviteCodeError::Invalid)?;
    invite.validate()?;
    Ok(ParsedInviteCode {
        invite_id: invite_id.to_owned(),
        invite,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InviteLookup {
    pub invite: InviteRecord,
    pub room: RoomRecord,
    pub host_device: InviteDevice,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InviteDevice {
    pub user_id: String,
    pub device_id: String,
    pub signature_public_key: String,
    pub signature_key_fingerprint: String,
    #[serde(default)]
    pub hpke_public_key: Option<String>,
    #[serde(default)]
    pub hpke_key_fingerprint: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdmissionRequest {
    pub record: InviteJoinRequestRecord,
    pub requester_display_name: String,
    pub requester_device_fingerprint: String,
    pub opened: OpenedInviteRequest,
}

pub fn admission_prompt(request: &AdmissionRequest) -> String {
    format!(
        "GitHub identity: {}\nDevice fingerprint: {}\nRequest: {}",
        safe_prompt_text(&request.requester_display_name),
        request.requester_device_fingerprint,
        request.record.request_id
    )
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DirectedInviteResponse {
    pub status: String,
    pub response_binding: CapabilityBinding,
    pub response_mac: String,
    pub welcome: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPackagePublish {
    pub id: String,
    pub key_package: String,
    pub key_package_hash: String,
    pub ciphersuite: u16,
}

pub trait InviteBackend {
    fn create_invite(&mut self, team_id: &str, room_id: &str) -> Result<InviteRecord, InviteError>;
    fn revoke_room_invites(&mut self, team_id: &str, room_id: &str) -> Result<u64, InviteError>;
    fn lookup_invite(&mut self, invite_id: &str) -> Result<InviteLookup, InviteError>;
    fn publish_key_package(
        &mut self,
        device_id: &str,
        device_session: &str,
        package: &KeyPackagePublish,
    ) -> Result<(), InviteError>;
    fn publish_request(
        &mut self,
        device_session: &str,
        request: &PreparedInviteRequest,
    ) -> Result<(), InviteError>;
    fn load_requests(
        &mut self,
        invite_id: &str,
        host_device_id: &str,
        device_session: &str,
    ) -> Result<Vec<(InviteJoinRequestRecord, InviteDevice)>, InviteError>;
    fn consume_key_package(
        &mut self,
        request: &InviteJoinRequestRecord,
        host_device_id: &str,
        device_session: &str,
    ) -> Result<(), InviteError>;
    fn publish_commit(
        &mut self,
        room: &RoomRecord,
        device_session: &str,
        created_at: &str,
        commit_outbox_id: &str,
        mls: &mut MlsClientService,
    ) -> Result<(), InviteError>;
    fn publish_response(
        &mut self,
        invite_id: &str,
        host_device_id: &str,
        device_session: &str,
        request_id: &str,
        decision: &InviteDecision,
    ) -> Result<(), InviteError>;
    fn load_response(
        &mut self,
        invite_id: &str,
        request_id: &str,
        requester_device_id: &str,
        device_session: &str,
    ) -> Result<Option<DirectedInviteResponse>, InviteError>;
    fn complete_admission(
        &mut self,
        lookup: &InviteLookup,
        request_id: &str,
        requester_user_id: &str,
        requester_device_id: &str,
        device_session: &str,
    ) -> Result<(), InviteError>;
    fn acknowledge_response(
        &mut self,
        invite_id: &str,
        request_id: &str,
        requester_device_id: &str,
        device_session: &str,
    ) -> Result<(), InviteError>;
}

pub struct InviteService<'a, S, B> {
    store: &'a S,
    backend: &'a mut B,
}

impl<'a, S: CredentialStore, B: InviteBackend> InviteService<'a, S, B> {
    pub fn new(store: &'a S, backend: &'a mut B) -> Self {
        Self { store, backend }
    }

    pub fn issue(
        &mut self,
        room: &RoomRecord,
        identity: &DeviceIdentity,
    ) -> Result<String, InviteError> {
        ensure_active_host(room, identity)?;
        let invite = self.backend.create_invite(&room.team_id, &room.id)?;
        let expires_at = invite
            .expires_at
            .as_deref()
            .ok_or(InviteError::Unavailable)?;
        let capability = MlsClientService::issue_invite_capability(self.store)?;
        let code = InviteCode::new(
            room.team_id.clone(),
            room.id.clone(),
            room.name.clone(),
            capability.handle.clone(),
            capability.url_value.clone(),
            expires_at.into(),
            identity.public.user_id.clone(),
            identity.public.device_id.clone(),
            identity.public.hpke_public_key.clone(),
            identity.public.hpke_key_fingerprint.clone(),
        )?;
        code.encode(&invite.id).map_err(Into::into)
    }

    pub fn revoke(
        &mut self,
        room: &RoomRecord,
        identity: &DeviceIdentity,
    ) -> Result<u64, InviteError> {
        ensure_active_host(room, identity)?;
        self.backend.revoke_room_invites(&room.team_id, &room.id)
    }

    pub fn request_admission(
        &mut self,
        encoded: &str,
        identity: &DeviceIdentity,
        device_session: &str,
        now: &str,
        mls: &MlsClientService,
    ) -> Result<PreparedInviteRequest, InviteError> {
        let parsed = parse_invite_code(encoded)?;
        ensure_not_expired(&parsed.invite.expires_at, now)?;
        let lookup = self.backend.lookup_invite(&parsed.invite_id)?;
        validate_lookup(&parsed, &lookup)?;
        let epoch = lookup.room.accepted_mls_epoch.unwrap_or(0);
        let prepared = mls.prepare_invite_request(
            &parsed.invite.host_hpke_public_key,
            &parsed.invite.capability_handle,
            &parsed.invite.capability_url_value,
            &parsed.invite_id,
            &parsed.invite.team_id,
            &parsed.invite.room_id,
            epoch,
            &parsed.invite.host_user_id,
            &parsed.invite.host_device_id,
            &parsed.invite.expires_at,
        )?;
        let validated = mls_core::validate_key_package_upload(&mls_core::KeyPackageUpload {
            key_package: prepared.key_package.clone(),
            uploader_github_user_id: identity.public.user_id.clone(),
            uploader_device_id: identity.public.device_id.clone(),
        })
        .map_err(|_| InviteError::Unavailable)?;
        if validated.signature_public_key != identity.public.signature_public_key
            || validated.signature_key_fingerprint != identity.public.signature_key_fingerprint
        {
            return Err(InviteError::IdentityMismatch);
        }
        let package = KeyPackagePublish {
            id: prepared.key_package_id.clone(),
            key_package: prepared.key_package.clone(),
            key_package_hash: prepared.key_package_hash.clone(),
            ciphersuite: 2,
        };
        self.backend
            .publish_key_package(&identity.public.device_id, device_session, &package)?;
        self.backend.publish_request(device_session, &prepared)?;
        Ok(prepared)
    }

    pub fn review_requests(
        &mut self,
        invite_id: &str,
        room: &RoomRecord,
        identity: &DeviceIdentity,
        device_session: &str,
        now: &str,
        mls: &MlsClientService,
    ) -> Result<Vec<AdmissionRequest>, InviteError> {
        ensure_active_host(room, identity)?;
        let lookup = self.backend.lookup_invite(invite_id)?;
        if lookup.room != *room {
            return Err(InviteError::Unavailable);
        }
        ensure_not_expired(
            lookup
                .invite
                .expires_at
                .as_deref()
                .ok_or(InviteError::Unavailable)?,
            now,
        )?;
        let mut output = Vec::new();
        for (record, device) in
            self.backend
                .load_requests(invite_id, &identity.public.device_id, device_session)?
        {
            let opened =
                mls.open_invite_request(identity, &record.key_package_id, &record.sealed_request)?;
            if opened.binding.invite_id != record.invite_id
                || opened.binding.request_id != record.request_id
                || opened.binding.requester_user_id != record.requester_user_id
                || opened.binding.requester_device_id != record.requester_device_id
                || opened.binding.key_package_hash != record.key_package_hash
                || device.user_id != record.requester_user_id
                || device.device_id != record.requester_device_id
                || device.signature_public_key != opened.requester_signature_public_key
                || device.signature_key_fingerprint != opened.requester_signature_key_fingerprint
            {
                return Err(InviteError::IdentityMismatch);
            }
            output.push(AdmissionRequest {
                requester_display_name: record.requester_user_id.clone(),
                requester_device_fingerprint: device.signature_key_fingerprint.clone(),
                record,
                opened,
            });
        }
        Ok(output)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn decide(
        &mut self,
        request: &AdmissionRequest,
        room: &RoomRecord,
        identity: &DeviceIdentity,
        device_session: &str,
        approve: bool,
        decided_at: &str,
        mls: &mut MlsClientService,
    ) -> Result<InviteDecision, InviteError> {
        ensure_active_host(room, identity)?;
        if request.record.invite_id != request.opened.binding.invite_id
            || request.record.request_id != request.opened.binding.request_id
            || request.opened.binding.room_id != room.id
            || request.opened.binding.team_id != room.team_id
            || request.opened.binding.host_user_id != identity.public.user_id
            || request.opened.binding.host_device_id != identity.public.device_id
            || request.opened.binding.key_epoch != room.accepted_mls_epoch.unwrap_or(0)
        {
            return Err(InviteError::Unavailable);
        }
        ensure_not_expired(&request.opened.binding.expires_at, decided_at)?;
        let current = self.backend.lookup_invite(&request.record.invite_id)?;
        if current.room.id != room.id
            || current.room.team_id != room.team_id
            || current.room.host_user_id != room.host_user_id
            || current.room.active_host_device_id != room.active_host_device_id
            || current.room.host_status != room.host_status
            || current.invite.expires_at.as_deref()
                != Some(request.opened.binding.expires_at.as_str())
        {
            return Err(InviteError::Unavailable);
        }
        if approve && !mls.has_invite_decision(&request.opened.capability_handle)? {
            self.backend.consume_key_package(
                &request.record,
                &identity.public.device_id,
                device_session,
            )?;
        }
        let decision = mls.decide_invite(self.store, &request.opened, approve, decided_at)?;
        if approve && current.room.accepted_mls_epoch == Some(request.opened.binding.key_epoch) {
            self.backend.publish_commit(
                room,
                device_session,
                decided_at,
                decision
                    .commit_outbox_id
                    .as_deref()
                    .ok_or(InviteError::Unavailable)?,
                mls,
            )?;
        } else if approve
            && current.room.accepted_mls_epoch != Some(request.opened.binding.key_epoch + 1)
        {
            return Err(InviteError::Unavailable);
        }
        self.backend.publish_response(
            &request.record.invite_id,
            &identity.public.device_id,
            device_session,
            &request.record.request_id,
            &decision,
        )?;
        Ok(decision)
    }

    pub fn finish_admission(
        &mut self,
        request: &PreparedInviteRequest,
        device_session: &str,
        mls: &mut MlsClientService,
    ) -> Result<Option<u64>, InviteError> {
        let Some(response) = self.backend.load_response(
            &request.invite_id,
            &request.request_id,
            &request.requester_device_id,
            device_session,
        )?
        else {
            return Err(InviteError::Unavailable);
        };
        let epoch = mls.accept_invite_response(
            &request.request_id,
            response.response_binding,
            &response.response_mac,
            response.welcome.as_deref(),
        )?;
        if epoch.is_some() {
            let lookup = self.backend.lookup_invite(&request.invite_id)?;
            self.backend.complete_admission(
                &lookup,
                &request.request_id,
                &request.binding.requester_user_id,
                &request.binding.requester_device_id,
                device_session,
            )?;
        }
        self.backend.acknowledge_response(
            &request.invite_id,
            &request.request_id,
            &request.requester_device_id,
            device_session,
        )?;
        mls.complete_invite_response(
            &request.request_id,
            &request.binding.room_id,
            epoch.is_some(),
        )?;
        Ok(epoch)
    }
}

fn ensure_active_host(room: &RoomRecord, identity: &DeviceIdentity) -> Result<(), InviteError> {
    if room.host_status != multaiplayer_protocol::HostStatus::Active
        || room.host_user_id.as_deref() != Some(identity.public.user_id.as_str())
        || room.active_host_device_id.as_deref() != Some(identity.public.device_id.as_str())
    {
        return Err(InviteError::HostAuthorityRequired);
    }
    Ok(())
}

fn validate_lookup(parsed: &ParsedInviteCode, lookup: &InviteLookup) -> Result<(), InviteError> {
    let invite = &parsed.invite;
    if lookup.invite.id != parsed.invite_id
        || lookup.invite.team_id != invite.team_id
        || lookup.invite.room_id != invite.room_id
        || lookup.invite.expires_at.as_deref() != Some(invite.expires_at.as_str())
        || lookup.room.id != invite.room_id
        || lookup.room.team_id != invite.team_id
        || lookup.room.host_user_id.as_deref() != Some(invite.host_user_id.as_str())
        || lookup.room.active_host_device_id.as_deref() != Some(invite.host_device_id.as_str())
        || lookup.host_device.user_id != invite.host_user_id
        || lookup.host_device.device_id != invite.host_device_id
        || lookup.host_device.hpke_public_key.as_deref()
            != Some(invite.host_hpke_public_key.as_str())
        || lookup.host_device.hpke_key_fingerprint.as_deref()
            != Some(invite.host_hpke_key_fingerprint.as_str())
    {
        return Err(InviteError::IdentityMismatch);
    }
    Ok(())
}

fn safe_prompt_text(value: &str) -> String {
    value
        .chars()
        .take(120)
        .map(|character| {
            if character.is_control() {
                '�'
            } else {
                character
            }
        })
        .collect()
}

fn valid_utc_timestamp(value: &str) -> bool {
    value.len() == 24
        && value.as_bytes()[4] == b'-'
        && value.as_bytes()[7] == b'-'
        && value.as_bytes()[10] == b'T'
        && value.as_bytes()[13] == b':'
        && value.as_bytes()[16] == b':'
        && value.as_bytes()[19] == b'.'
        && value.as_bytes()[23] == b'Z'
        && value.bytes().enumerate().all(|(index, byte)| {
            matches!(index, 4 | 7 | 10 | 13 | 16 | 19 | 23) || byte.is_ascii_digit()
        })
}

fn ensure_not_expired(expires_at: &str, now: &str) -> Result<(), InviteError> {
    if !valid_utc_timestamp(expires_at) || !valid_utc_timestamp(now) || expires_at <= now {
        return Err(InviteError::Unavailable);
    }
    Ok(())
}

pub struct RelayInviteBackend<'a, S, H> {
    store: &'a S,
    http: &'a H,
    relay_origin: String,
    session: &'a RestoredSession,
    identity: &'a DeviceIdentity,
    #[cfg(test)]
    loopback_session: Option<zeroize::Zeroizing<String>>,
    #[cfg(test)]
    loopback_websocket_url: Option<String>,
}

impl<'a, S: CredentialStore, H: HttpClient> RelayInviteBackend<'a, S, H> {
    pub fn new(
        store: &'a S,
        http: &'a H,
        relay_origin: &str,
        session: &'a RestoredSession,
        identity: &'a DeviceIdentity,
    ) -> Result<Self, InviteError> {
        let relay_origin = crate::auth::validate_relay_origin(relay_origin)
            .map_err(|_| InviteError::RelayUnavailable)?;
        Ok(Self {
            store,
            http,
            relay_origin,
            session,
            identity,
            #[cfg(test)]
            loopback_session: None,
            #[cfg(test)]
            loopback_websocket_url: None,
        })
    }

    #[cfg(test)]
    fn new_for_loopback_test(
        store: &'a S,
        http: &'a H,
        relay_origin: &str,
        websocket_url: &str,
        relay_session: &str,
        session: &'a RestoredSession,
        identity: &'a DeviceIdentity,
    ) -> Result<Self, InviteError> {
        let parsed =
            reqwest::Url::parse(relay_origin).map_err(|_| InviteError::RelayUnavailable)?;
        if parsed.scheme() != "http"
            || !matches!(parsed.host_str(), Some("127.0.0.1") | Some("::1"))
            || parsed.port().is_none()
            || parsed.path() != "/"
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || relay_session.is_empty()
        {
            return Err(InviteError::RelayUnavailable);
        }
        TungsteniteConnector::from_loopback_test_url(websocket_url, relay_session)
            .map_err(|_| InviteError::RelayUnavailable)?;
        Ok(Self {
            store,
            http,
            relay_origin: parsed.origin().ascii_serialization(),
            session,
            identity,
            loopback_session: Some(zeroize::Zeroizing::new(relay_session.into())),
            loopback_websocket_url: Some(websocket_url.into()),
        })
    }

    fn relay_session(&self) -> Result<zeroize::Zeroizing<String>, InviteError> {
        #[cfg(test)]
        if let Some(session) = &self.loopback_session {
            return Ok(session.clone());
        }
        load_relay_transport_session(self.store, &self.relay_origin)
            .map_err(map_cli_error)?
            .map(|session| session.secret)
            .ok_or(InviteError::AuthenticationRequired)
    }

    fn response(
        &self,
        response: HttpResponse,
        expected_url: &str,
        statuses: &[u16],
    ) -> Result<HttpResponse, InviteError> {
        if response.final_url != expected_url || response.body.len() > MAX_HTTP_RESPONSE_BYTES {
            return Err(InviteError::RelayUnavailable);
        }
        if statuses.contains(&response.status) {
            return Ok(response);
        }
        Err(match response.status {
            401 => InviteError::AuthenticationRequired,
            403 => InviteError::HostAuthorityRequired,
            404 | 409 | 410 => InviteError::Unavailable,
            _ => InviteError::RelayUnavailable,
        })
    }

    fn json<T: for<'de> Deserialize<'de>>(
        &self,
        response: HttpResponse,
        expected_url: &str,
        statuses: &[u16],
    ) -> Result<T, InviteError> {
        let response = self.response(response, expected_url, statuses)?;
        serde_json::from_slice(&response.body).map_err(|_| InviteError::RelayUnavailable)
    }

    fn connector(&self) -> Result<TungsteniteConnector, InviteError> {
        #[cfg(test)]
        if let Some(url) = &self.loopback_websocket_url {
            let session = self.relay_session()?;
            return TungsteniteConnector::from_loopback_test_url(url, session.as_str())
                .map_err(|_| InviteError::RelayUnavailable);
        }
        TungsteniteConnector::from_store(self.store, &self.relay_origin)
            .map_err(|_| InviteError::RelayUnavailable)
    }

    fn joined_connection(
        &self,
        room: &RoomRecord,
        invite_id: Option<&str>,
        device_session: &str,
    ) -> Result<RelayConnection<crate::relay::TungsteniteSocket>, InviteError> {
        let mut connector = self.connector()?;
        let socket = connect_with_retries(
            &mut connector,
            ReconnectPolicy::default(),
            &mut ThreadSleeper,
        )
        .map_err(|_| InviteError::RelayUnavailable)?;
        let mut connection = RelayConnection::new(socket);
        let join = RelayClientMessage::Join {
            team_id: room.team_id.clone(),
            room_id: room.id.clone(),
            user_id: self.session.user.id.clone(),
            device_id: self.identity.public.device_id.clone(),
            invite_id: invite_id.map(str::to_owned),
            device_session_token: Some(device_session.into()),
        };
        connection
            .join_and_wait_for_ack(&join, ADMISSION_TIMEOUT, &mut |_| Ok(()))
            .map_err(|_| InviteError::RelayUnavailable)?;
        Ok(connection)
    }
}

impl<S: CredentialStore, H: HttpClient> InviteBackend for RelayInviteBackend<'_, S, H> {
    fn create_invite(&mut self, team_id: &str, room_id: &str) -> Result<InviteRecord, InviteError> {
        let url = endpoint(&self.relay_origin, "/invites").map_err(map_cli_error)?;
        let session = self.relay_session()?;
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Body {
            invite: InviteRecord,
        }
        let body: Body = self.json(
            self.http
                .post_json(
                    &url,
                    &[(NATIVE_SESSION_HEADER, session.as_str())],
                    &json!({ "teamId": team_id, "roomId": room_id }),
                )
                .map_err(map_cli_error)?,
            &url,
            &[201],
        )?;
        body.invite
            .validate()
            .map_err(|_| InviteError::RelayUnavailable)?;
        if body.invite.team_id != team_id || body.invite.room_id != room_id {
            return Err(InviteError::RelayUnavailable);
        }
        Ok(body.invite)
    }

    fn revoke_room_invites(&mut self, team_id: &str, room_id: &str) -> Result<u64, InviteError> {
        let url = endpoint(
            &self.relay_origin,
            &format!("/teams/{team_id}/rooms/{room_id}/invites"),
        )
        .map_err(map_cli_error)?;
        let session = self.relay_session()?;
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Body {
            revoked: u64,
        }
        let body: Body = self.json(
            self.http
                .delete(&url, &[(NATIVE_SESSION_HEADER, session.as_str())])
                .map_err(map_cli_error)?,
            &url,
            &[200],
        )?;
        Ok(body.revoked)
    }

    fn lookup_invite(&mut self, invite_id: &str) -> Result<InviteLookup, InviteError> {
        if !bounded_token(invite_id, 160) {
            return Err(InviteError::Unavailable);
        }
        let url = endpoint(&self.relay_origin, &format!("/invites/{invite_id}"))
            .map_err(map_cli_error)?;
        let session = self.relay_session()?;
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Body {
            invite: InviteRecord,
            team: TeamRecord,
            room: RoomRecord,
            host_device: Option<InviteDevice>,
        }
        let body: Body = self.json(
            self.http
                .get(&url, &[(NATIVE_SESSION_HEADER, session.as_str())])
                .map_err(map_cli_error)?,
            &url,
            &[200],
        )?;
        body.invite
            .validate()
            .map_err(|_| InviteError::RelayUnavailable)?;
        body.team
            .validate()
            .map_err(|_| InviteError::RelayUnavailable)?;
        body.room
            .validate()
            .map_err(|_| InviteError::RelayUnavailable)?;
        if body.team.id != body.invite.team_id
            || body.room.team_id != body.team.id
            || body.room.id != body.invite.room_id
        {
            return Err(InviteError::RelayUnavailable);
        }
        Ok(InviteLookup {
            invite: body.invite,
            room: body.room,
            host_device: body.host_device.ok_or(InviteError::Unavailable)?,
        })
    }

    fn publish_key_package(
        &mut self,
        device_id: &str,
        device_session: &str,
        package: &KeyPackagePublish,
    ) -> Result<(), InviteError> {
        let url = endpoint(
            &self.relay_origin,
            &format!("/devices/{device_id}/key-packages"),
        )
        .map_err(map_cli_error)?;
        let session = self.relay_session()?;
        let response = self
            .http
            .post_json(
                &url,
                &[
                    (NATIVE_SESSION_HEADER, session.as_str()),
                    (DEVICE_SESSION_HEADER, device_session),
                ],
                &json!({ "keyPackages": [package] }),
            )
            .map_err(map_cli_error)?;
        self.response(response, &url, &[201]).map(|_| ())
    }

    fn publish_request(
        &mut self,
        device_session: &str,
        request: &PreparedInviteRequest,
    ) -> Result<(), InviteError> {
        let url = endpoint(
            &self.relay_origin,
            &format!("/invites/{}/requests", request.invite_id),
        )
        .map_err(map_cli_error)?;
        let session = self.relay_session()?;
        let response = self
            .http
            .post_json(
                &url,
                &[
                    (NATIVE_SESSION_HEADER, session.as_str()),
                    (DEVICE_SESSION_HEADER, device_session),
                ],
                &json!({
                    "requestId": request.request_id,
                    "requesterDeviceId": request.requester_device_id,
                    "keyPackageId": request.key_package_id,
                    "keyPackageHash": request.key_package_hash,
                    "sealedRequest": request.sealed_request,
                }),
            )
            .map_err(map_cli_error)?;
        self.response(response, &url, &[200, 201]).map(|_| ())
    }

    fn load_requests(
        &mut self,
        invite_id: &str,
        host_device_id: &str,
        device_session: &str,
    ) -> Result<Vec<(InviteJoinRequestRecord, InviteDevice)>, InviteError> {
        let url = endpoint(
            &self.relay_origin,
            &format!("/invites/{invite_id}/requests?hostDeviceId={host_device_id}"),
        )
        .map_err(map_cli_error)?;
        let session = self.relay_session()?;
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Item {
            request_id: String,
            invite_id: String,
            requester_user_id: String,
            requester_device_id: String,
            key_package_id: String,
            key_package_hash: String,
            sealed_request: String,
            created_at: String,
            requester_device: Option<InviteDevice>,
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Body {
            requests: Vec<Item>,
        }
        let body: Body = self.json(
            self.http
                .get(
                    &url,
                    &[
                        (NATIVE_SESSION_HEADER, session.as_str()),
                        (DEVICE_SESSION_HEADER, device_session),
                    ],
                )
                .map_err(map_cli_error)?,
            &url,
            &[200],
        )?;
        body.requests
            .into_iter()
            .map(|item| {
                let record = InviteJoinRequestRecord {
                    request_id: item.request_id,
                    invite_id: item.invite_id,
                    requester_user_id: item.requester_user_id,
                    requester_device_id: item.requester_device_id,
                    key_package_id: item.key_package_id,
                    key_package_hash: item.key_package_hash,
                    sealed_request: item.sealed_request,
                    created_at: item.created_at,
                };
                record
                    .validate()
                    .map_err(|_| InviteError::RelayUnavailable)?;
                Ok((
                    record,
                    item.requester_device.ok_or(InviteError::IdentityMismatch)?,
                ))
            })
            .collect()
    }

    fn consume_key_package(
        &mut self,
        request: &InviteJoinRequestRecord,
        host_device_id: &str,
        device_session: &str,
    ) -> Result<(), InviteError> {
        // The room id is cryptographically bound but not duplicated in the relay request record.
        // Use the opened binding's room through an exact preflight lookup below.
        let lookup = self.lookup_invite(&request.invite_id)?;
        let url = endpoint(
            &self.relay_origin,
            &format!(
                "/rooms/{}/key-packages/{}/{}/consume",
                lookup.room.id, request.requester_user_id, request.requester_device_id
            ),
        )
        .map_err(map_cli_error)?;
        let session = self.relay_session()?;
        let response = self
            .http
            .post_json(
                &url,
                &[
                    (NATIVE_SESSION_HEADER, session.as_str()),
                    (DEVICE_SESSION_HEADER, device_session),
                ],
                &json!({
                    "hostDeviceId": host_device_id,
                    "inviteId": request.invite_id,
                    "keyPackageId": request.key_package_id,
                    "keyPackageHash": request.key_package_hash,
                }),
            )
            .map_err(map_cli_error)?;
        let response = self.response(response, &url, &[200])?;
        let value: serde_json::Value =
            serde_json::from_slice(&response.body).map_err(|_| InviteError::RelayUnavailable)?;
        let exact = value.get("keyPackage").is_some_and(|package| {
            package.get("id").and_then(|value| value.as_str())
                == Some(request.key_package_id.as_str())
                && package
                    .get("keyPackageHash")
                    .and_then(|value| value.as_str())
                    == Some(request.key_package_hash.as_str())
                && package.get("userId").and_then(|value| value.as_str())
                    == Some(request.requester_user_id.as_str())
                && package.get("deviceId").and_then(|value| value.as_str())
                    == Some(request.requester_device_id.as_str())
        }) || value
            .get("alreadyConsumed")
            .and_then(|value| value.as_bool())
            == Some(true)
            && value.get("keyPackageId").and_then(|value| value.as_str())
                == Some(request.key_package_id.as_str())
            && value.get("keyPackageHash").and_then(|value| value.as_str())
                == Some(request.key_package_hash.as_str())
            && value.get("userId").and_then(|value| value.as_str())
                == Some(request.requester_user_id.as_str())
            && value.get("deviceId").and_then(|value| value.as_str())
                == Some(request.requester_device_id.as_str());
        if !exact {
            return Err(InviteError::Unavailable);
        }
        Ok(())
    }

    fn publish_commit(
        &mut self,
        room: &RoomRecord,
        device_session: &str,
        created_at: &str,
        commit_outbox_id: &str,
        mls: &mut MlsClientService,
    ) -> Result<(), InviteError> {
        let mut connection = self.joined_connection(room, None, device_session)?;
        fn ignore_server_message(
            _: &multaiplayer_protocol::RelayServerMessage,
        ) -> Result<(), crate::relay::RelayTransportError> {
            Ok(())
        }
        let mut handler = ignore_server_message;
        let mut publisher =
            RelayMlsPublisher::new(&mut connection, ADMISSION_TIMEOUT, &mut handler);
        mls.publish_invite_commit(
            &OutboxRoute {
                team_id: room.team_id.clone(),
                room_id: room.id.clone(),
                created_at: created_at.into(),
            },
            commit_outbox_id,
            &mut publisher,
        )
        .map_err(Into::into)
    }

    fn publish_response(
        &mut self,
        invite_id: &str,
        host_device_id: &str,
        device_session: &str,
        request_id: &str,
        decision: &InviteDecision,
    ) -> Result<(), InviteError> {
        let url = endpoint(
            &self.relay_origin,
            &format!("/invites/{invite_id}/response"),
        )
        .map_err(map_cli_error)?;
        let session = self.relay_session()?;
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            host_device_id: &'a str,
            request_id: &'a str,
            status: &'a str,
            response_binding: &'a CapabilityBinding,
            response_mac: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            welcome: Option<&'a str>,
        }
        let body = serde_json::to_vec(&Body {
            host_device_id,
            request_id,
            status: &decision.status,
            response_binding: &decision.response_binding,
            response_mac: &decision.response_mac,
            welcome: decision.welcome.as_deref(),
        })
        .map_err(|_| InviteError::RelayUnavailable)?;
        let response = self
            .http
            .post_json_bytes(
                &url,
                &[
                    (NATIVE_SESSION_HEADER, session.as_str()),
                    (DEVICE_SESSION_HEADER, device_session),
                ],
                &body,
            )
            .map_err(map_cli_error)?;
        self.response(response, &url, &[200, 201]).map(|_| ())
    }

    fn load_response(
        &mut self,
        invite_id: &str,
        request_id: &str,
        requester_device_id: &str,
        device_session: &str,
    ) -> Result<Option<DirectedInviteResponse>, InviteError> {
        let url = endpoint(
            &self.relay_origin,
            &format!(
                "/invites/{invite_id}/response/{request_id}?requesterDeviceId={requester_device_id}"
            ),
        )
        .map_err(map_cli_error)?;
        let session = self.relay_session()?;
        let response = self
            .http
            .get(
                &url,
                &[
                    (NATIVE_SESSION_HEADER, session.as_str()),
                    (DEVICE_SESSION_HEADER, device_session),
                ],
            )
            .map_err(map_cli_error)?;
        if response.final_url == url && response.status == 404 {
            return Ok(None);
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Body {
            status: String,
            response_binding: CapabilityBinding,
            response_mac: String,
            welcome: Option<String>,
        }
        let body: Body = self.json(response, &url, &[200])?;
        Ok(Some(DirectedInviteResponse {
            status: body.status,
            response_binding: body.response_binding,
            response_mac: body.response_mac,
            welcome: body.welcome,
        }))
    }

    fn complete_admission(
        &mut self,
        lookup: &InviteLookup,
        request_id: &str,
        requester_user_id: &str,
        requester_device_id: &str,
        device_session: &str,
    ) -> Result<(), InviteError> {
        if requester_user_id != self.session.user.id
            || requester_device_id != self.identity.public.device_id
        {
            return Err(InviteError::IdentityMismatch);
        }
        if request_id.is_empty() {
            return Err(InviteError::Unavailable);
        }
        self.joined_connection(&lookup.room, Some(&lookup.invite.id), device_session)
            .map(|_| ())
    }

    fn acknowledge_response(
        &mut self,
        invite_id: &str,
        request_id: &str,
        requester_device_id: &str,
        device_session: &str,
    ) -> Result<(), InviteError> {
        let url = endpoint(
            &self.relay_origin,
            &format!("/invites/{invite_id}/response/{request_id}/ack"),
        )
        .map_err(map_cli_error)?;
        let session = self.relay_session()?;
        let response = self
            .http
            .post_json(
                &url,
                &[
                    (NATIVE_SESSION_HEADER, session.as_str()),
                    (DEVICE_SESSION_HEADER, device_session),
                ],
                &json!({ "requesterDeviceId": requester_device_id }),
            )
            .map_err(map_cli_error)?;
        self.response(response, &url, &[204]).map(|_| ())
    }
}

fn map_cli_error(_: CliError) -> InviteError {
    InviteError::RelayUnavailable
}

fn bounded_text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}

fn bounded_token(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn bounded_base64(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
}

fn valid_fingerprint(value: &str) -> bool {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return false;
    };
    let groups: Vec<_> = hex.split(':').collect();
    groups.len() == 16
        && groups
            .iter()
            .all(|group| group.len() == 4 && group.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        auth::SignedInUser,
        identity::load_or_create_identity,
        platform::tests::MemoryCredentialStore,
        room::{CreateRoomRequest, RelayRoomBackend, RoomBackend, RoomService},
    };
    use serde_json::Value;
    use std::{
        collections::BTreeMap,
        fs,
        io::{BufRead, BufReader, Read, Write},
        path::{Path, PathBuf},
        process::{Child, ChildStdout, Command, Stdio},
    };

    struct LoopbackHttp {
        client: reqwest::blocking::Client,
    }

    impl LoopbackHttp {
        fn new() -> Self {
            Self {
                client: reqwest::blocking::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .unwrap(),
            }
        }

        fn send(
            &self,
            method: reqwest::Method,
            url: &str,
            headers: &[(&str, &str)],
            body: Option<&Value>,
        ) -> Result<HttpResponse, CliError> {
            let parsed = reqwest::Url::parse(url).map_err(|_| CliError::RelayUnavailable)?;
            if parsed.scheme() != "http"
                || !matches!(parsed.host_str(), Some("127.0.0.1") | Some("::1"))
                || parsed.port().is_none()
            {
                return Err(CliError::RelayUnavailable);
            }
            let mut request = self.client.request(method, parsed);
            for (name, value) in headers {
                request = request.header(*name, *value);
            }
            if let Some(body) = body {
                request = request.json(body);
            }
            let response = request.send().map_err(|_| CliError::RelayUnavailable)?;
            let status = response.status().as_u16();
            let final_url = response.url().to_string();
            let response_headers: BTreeMap<_, _> = response
                .headers()
                .iter()
                .filter_map(|(name, value)| {
                    value
                        .to_str()
                        .ok()
                        .map(|value| (name.as_str().to_owned(), value.to_owned()))
                })
                .collect();
            let mut response_body = Vec::new();
            response
                .take((MAX_HTTP_RESPONSE_BYTES + 1) as u64)
                .read_to_end(&mut response_body)
                .map_err(|_| CliError::RelayUnavailable)?;
            if response_body.len() > MAX_HTTP_RESPONSE_BYTES {
                return Err(CliError::RelayUnavailable);
            }
            Ok(HttpResponse {
                status,
                final_url,
                headers: response_headers,
                body: response_body,
            })
        }
    }

    impl HttpClient for LoopbackHttp {
        fn get(&self, url: &str, headers: &[(&str, &str)]) -> Result<HttpResponse, CliError> {
            self.send(reqwest::Method::GET, url, headers, None)
        }
        fn post_json(
            &self,
            url: &str,
            headers: &[(&str, &str)],
            body: &Value,
        ) -> Result<HttpResponse, CliError> {
            self.send(reqwest::Method::POST, url, headers, Some(body))
        }
        fn post_json_bytes(
            &self,
            url: &str,
            headers: &[(&str, &str)],
            body: &[u8],
        ) -> Result<HttpResponse, CliError> {
            let parsed = reqwest::Url::parse(url).map_err(|_| CliError::RelayUnavailable)?;
            let mut request = self
                .client
                .post(parsed)
                .header("content-type", "application/json");
            for (name, value) in headers {
                request = request.header(*name, *value);
            }
            let response = request
                .body(body.to_vec())
                .send()
                .map_err(|_| CliError::RelayUnavailable)?;
            let status = response.status().as_u16();
            let final_url = response.url().to_string();
            let response_headers = response
                .headers()
                .iter()
                .filter_map(|(name, value)| {
                    value
                        .to_str()
                        .ok()
                        .map(|value| (name.as_str().to_owned(), value.to_owned()))
                })
                .collect();
            let mut response_body = Vec::new();
            response
                .take((MAX_HTTP_RESPONSE_BYTES + 1) as u64)
                .read_to_end(&mut response_body)
                .map_err(|_| CliError::RelayUnavailable)?;
            Ok(HttpResponse {
                status,
                final_url,
                headers: response_headers,
                body: response_body,
            })
        }
        fn patch_json(
            &self,
            url: &str,
            headers: &[(&str, &str)],
            body: &Value,
        ) -> Result<HttpResponse, CliError> {
            self.send(reqwest::Method::PATCH, url, headers, Some(body))
        }
        fn delete(&self, url: &str, headers: &[(&str, &str)]) -> Result<HttpResponse, CliError> {
            self.send(reqwest::Method::DELETE, url, headers, None)
        }
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RelayFixtureInfo {
        base_url: String,
        ws_url: String,
        temp_dir: PathBuf,
    }

    struct RelayFixture {
        child: Option<Child>,
        _stdout: BufReader<ChildStdout>,
        info: RelayFixtureInfo,
    }

    impl RelayFixture {
        fn start() -> Self {
            let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/real-relay-fixture.ts");
            let mut child = Command::new("node")
                .arg("--import")
                .arg("tsx")
                .arg(fixture)
                .current_dir(repository_root())
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .expect("start real relay fixture");
            child
                .stdin
                .as_mut()
                .unwrap()
                .write_all(b"\"invite-secret-reflection-sentinel\"\n")
                .unwrap();
            let mut stdout = BufReader::new(child.stdout.take().unwrap());
            let mut line = String::new();
            stdout.read_line(&mut line).unwrap();
            let info = serde_json::from_str(&line).unwrap();
            Self {
                child: Some(child),
                _stdout: stdout,
                info,
            }
        }
    }

    impl Drop for RelayFixture {
        fn drop(&mut self) {
            if let Some(mut child) = self.child.take() {
                let _ = child.stdin.take().unwrap().write_all(b"stop\n");
                let _ = child.wait();
            }
            let _ = fs::remove_dir_all(&self.info.temp_dir);
        }
    }

    struct JourneyDirectory(PathBuf);
    impl JourneyDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("multaiplayer-cli-invite-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for JourneyDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn debug_session(
        http: &LoopbackHttp,
        origin: &str,
        id: &str,
        login: &str,
        name: &str,
    ) -> String {
        let url = endpoint(origin, "/debug/auth-session").unwrap();
        let response = http
            .post_json(
                &url,
                &[],
                &json!({ "id": id, "login": login, "name": name }),
            )
            .unwrap();
        assert_eq!(response.status, 201);
        response
            .headers
            .get("set-cookie")
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .strip_prefix("multaiplayer_session=")
            .unwrap()
            .to_owned()
    }

    fn register_identity(
        http: &LoopbackHttp,
        origin: &str,
        relay_session: &str,
        identity: &DeviceIdentity,
    ) {
        let response = http
            .post_json(
                &endpoint(origin, "/devices").unwrap(),
                &[("cookie", &format!("multaiplayer_session={relay_session}"))],
                &json!({
                    "deviceId": identity.public.device_id,
                    "displayName": identity.public.display_name,
                    "signaturePublicKey": identity.public.signature_public_key,
                    "signatureKeyFingerprint": identity.public.signature_key_fingerprint,
                    "hpkePublicKey": identity.public.hpke_public_key,
                    "hpkeKeyFingerprint": identity.public.hpke_key_fingerprint,
                }),
            )
            .unwrap();
        assert!(
            matches!(response.status, 200 | 201),
            "register status {}",
            response.status
        );
    }

    fn restored(id: &str, login: &str, name: &str, origin: &str) -> RestoredSession {
        RestoredSession {
            user: SignedInUser {
                id: id.into(),
                login: login.into(),
                name: Some(name.into()),
                avatar_url: None,
            },
            relay_origin: origin.into(),
        }
    }

    fn assert_tree_excludes(root: &Path, forbidden: &[u8]) {
        if forbidden.is_empty() {
            return;
        }
        for entry in fs::read_dir(root).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                assert_tree_excludes(&path, forbidden);
            } else {
                let bytes = fs::read(&path).unwrap();
                assert!(!bytes
                    .windows(forbidden.len())
                    .any(|value| value == forbidden));
            }
        }
    }

    fn repository_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf()
    }

    fn sample() -> InviteCode {
        InviteCode::new(
            "team-core".into(),
            "room-core".into(),
            "Compiler work".into(),
            "super_secret_handle".into(),
            URL_SAFE_NO_PAD.encode([0x5a; CAPABILITY_BYTES]),
            "2026-07-19T12:34:56.000Z".into(),
            "github:host".into(),
            "device_host".into(),
            base64::engine::general_purpose::STANDARD.encode([4u8; 65]),
            format!("sha256:{}", vec!["abcd"; 16].join(":")),
        )
        .unwrap()
    }

    #[test]
    fn versioned_code_round_trips_with_desktop_url_shape() {
        let code = sample();
        let encoded = code.encode("invite_123").unwrap();
        assert!(encoded.starts_with(
            "https://open.multaiplayer.com/invite#invite=invite_123&multaiplayerJoin="
        ));
        assert!(encoded.ends_with("&approval=request"));
        let parsed = parse_invite_code(&encoded).unwrap();
        assert_eq!(parsed.invite_id, "invite_123");
        assert_eq!(parsed.invite, code);
    }

    #[test]
    fn exact_desktop_v4_codec_interoperates_in_both_directions() {
        let script =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/invite-code-parity.ts");
        let desktop = Command::new("node")
            .arg("--import")
            .arg("tsx")
            .arg(&script)
            .arg("emit-desktop")
            .current_dir(repository_root())
            .output()
            .expect("run authoritative desktop encoder");
        assert!(desktop.status.success());
        let desktop_code = String::from_utf8(desktop.stdout).unwrap();
        let parsed = parse_invite_code(&desktop_code).expect("CLI accepts desktop v4 payload");
        assert_eq!(parsed.invite_id, "invite_desktop");
        assert!(parsed.invite.checksum.is_none());

        let cli_code = sample().encode("invite_desktop").unwrap();
        let mut desktop = Command::new("node")
            .arg("--import")
            .arg("tsx")
            .arg(&script)
            .arg("accept-cli")
            .current_dir(repository_root())
            .stdin(Stdio::piped())
            .spawn()
            .expect("run authoritative desktop decoder");
        desktop
            .stdin
            .as_mut()
            .unwrap()
            .write_all(cli_code.as_bytes())
            .unwrap();
        assert!(desktop.wait().unwrap().success());
    }

    #[test]
    fn capability_has_256_bits_and_debug_is_redacted() {
        let code = sample();
        let decoded = URL_SAFE_NO_PAD.decode(&code.capability_url_value).unwrap();
        assert_eq!(decoded.len(), 32);
        let debug = format!("{code:?}");
        assert!(!debug.contains(&code.capability_url_value));
        assert!(!debug.contains(&code.capability_handle));
        assert!(!debug.contains(code.checksum.as_deref().unwrap()));
    }

    #[test]
    fn secret_lifetime_schema_uses_zeroizing_guards() {
        let invite_source = include_str!("invite.rs");
        let mls_source = include_str!("mls.rs");
        for required in [
            "Serialize, Zeroize, ZeroizeOnDrop",
            "zeroize::Zeroizing::new(serde_json::to_vec",
            "zeroize::Zeroizing::new(URL_SAFE_NO_PAD",
        ] {
            assert!(
                invite_source.contains(required),
                "missing invite guard: {required}"
            );
        }
        for required in [
            "Zeroizing::new(issued.take_url_value())",
            "Zeroizing::new(STANDARD.encode(issued.verifier()))",
            "let plaintext = Zeroizing::new(",
            "payload.capability_handle.zeroize()",
            "impl Zeroize for OpenedInviteRequest",
            "let response_verifier = Zeroizing::new(derive_capability_verifier",
            "pending.capability_url_value.zeroize()",
            "let encoded = Zeroizing::new(",
        ] {
            assert!(
                mls_source.contains(required),
                "missing MLS guard: {required}"
            );
        }
    }

    #[test]
    fn every_single_byte_payload_mutation_fails_closed() {
        let encoded = sample().encode("invite_123").unwrap();
        let marker = "multaiplayerJoin=";
        let start = encoded.find(marker).unwrap() + marker.len();
        let end = encoded[start..].find('&').unwrap() + start;
        for index in start..end {
            let original = encoded.as_bytes()[index];
            let replacement = if original == b'A' { 'B' } else { 'A' };
            let mut candidate = encoded.clone();
            candidate.replace_range(index..index + 1, &replacement.to_string());
            assert!(
                parse_invite_code(&candidate).is_err(),
                "mutation {index} passed"
            );
        }
    }

    #[test]
    fn rejects_noncanonical_ambiguous_and_oversized_codes() {
        let valid = sample().encode("invite_123").unwrap();
        for candidate in [
            valid.replace("https://", "http://"),
            valid.replace("open.multaiplayer.com", "evil.example"),
            format!("{valid}&extra=value"),
            valid.replace("approval=request", "approval=approve"),
            valid.replace("invite=invite_123", "invite=invite%2F123"),
        ] {
            assert!(parse_invite_code(&candidate).is_err());
        }
        assert!(parse_invite_code(&"a".repeat(MAX_CODE_CHARS + 1)).is_err());
    }

    #[test]
    fn production_two_device_deny_expire_revoke_approve_and_replay_journey() {
        let journey = JourneyDirectory::new();
        let project = journey.0.join("project");
        fs::create_dir(&project).unwrap();
        let relay = RelayFixture::start();
        let http = LoopbackHttp::new();
        let host_store = MemoryCredentialStore::default();
        let guest_store = MemoryCredentialStore::default();
        let host_identity =
            load_or_create_identity(&host_store, "github:maddiedreese", "Maddie").unwrap();
        let guest_identity =
            load_or_create_identity(&guest_store, "github:guest", "Guest User").unwrap();
        let host_relay_session = debug_session(
            &http,
            &relay.info.base_url,
            "github:maddiedreese",
            "maddiedreese",
            "Maddie",
        );
        let guest_relay_session = debug_session(
            &http,
            &relay.info.base_url,
            "github:guest",
            "guest",
            "Guest User",
        );
        register_identity(
            &http,
            &relay.info.base_url,
            &host_relay_session,
            &host_identity,
        );
        register_identity(
            &http,
            &relay.info.base_url,
            &guest_relay_session,
            &guest_identity,
        );
        let host_session = restored(
            "github:maddiedreese",
            "maddiedreese",
            "Maddie",
            &relay.info.base_url,
        );
        let guest_session = restored("github:guest", "guest", "Guest User", &relay.info.base_url);
        let host_mls_path = journey.0.join("host-mls.sqlite");
        let guest_mls_path = journey.0.join("guest-mls.sqlite");
        let mut host_mls =
            MlsClientService::open(&host_store, &host_identity, &host_mls_path).unwrap();
        let mut guest_mls =
            MlsClientService::open(&guest_store, &guest_identity, &guest_mls_path).unwrap();

        let room = {
            let mut backend = RelayRoomBackend::new_for_loopback_test(
                &host_store,
                &http,
                &relay.info.base_url,
                &relay.info.ws_url,
                &host_relay_session,
                &host_session,
                &host_identity,
            )
            .unwrap();
            RoomService::new(
                &host_store,
                &mut backend,
                &mut host_mls,
                &host_identity.public.user_id,
                &host_identity.public.device_id,
                &relay.info.base_url,
            )
            .create(&CreateRoomRequest {
                team: Some("team-core".into()),
                name: "Invite journey".into(),
                project: project.to_string_lossy().into_owned(),
            })
            .unwrap()
            .room
        };
        let host_device_session = {
            let mut backend = RelayRoomBackend::new_for_loopback_test(
                &host_store,
                &http,
                &relay.info.base_url,
                &relay.info.ws_url,
                &host_relay_session,
                &host_session,
                &host_identity,
            )
            .unwrap();
            backend.establish_device_session().unwrap()
        };
        let guest_device_session = {
            let mut backend = RelayRoomBackend::new_for_loopback_test(
                &guest_store,
                &http,
                &relay.info.base_url,
                &relay.info.ws_url,
                &guest_relay_session,
                &guest_session,
                &guest_identity,
            )
            .unwrap();
            backend.establish_device_session().unwrap()
        };
        let valid_now = "2000-01-01T00:00:00.000Z";

        let denied_code = {
            let mut backend = RelayInviteBackend::new_for_loopback_test(
                &host_store,
                &http,
                &relay.info.base_url,
                &relay.info.ws_url,
                &host_relay_session,
                &host_session,
                &host_identity,
            )
            .unwrap();
            InviteService::new(&host_store, &mut backend)
                .issue(&room, &host_identity)
                .unwrap()
        };
        let denied = {
            let mut backend = RelayInviteBackend::new_for_loopback_test(
                &guest_store,
                &http,
                &relay.info.base_url,
                &relay.info.ws_url,
                &guest_relay_session,
                &guest_session,
                &guest_identity,
            )
            .unwrap();
            InviteService::new(&guest_store, &mut backend)
                .request_admission(
                    &denied_code,
                    &guest_identity,
                    guest_device_session.as_str(),
                    valid_now,
                    &guest_mls,
                )
                .unwrap()
        };
        let denied_request = {
            let invite_id = parse_invite_code(&denied_code).unwrap().invite_id;
            let mut backend = RelayInviteBackend::new_for_loopback_test(
                &host_store,
                &http,
                &relay.info.base_url,
                &relay.info.ws_url,
                &host_relay_session,
                &host_session,
                &host_identity,
            )
            .unwrap();
            let mut service = InviteService::new(&host_store, &mut backend);
            let requests = service
                .review_requests(
                    &invite_id,
                    &room,
                    &host_identity,
                    host_device_session.as_str(),
                    valid_now,
                    &host_mls,
                )
                .unwrap();
            assert_eq!(requests.len(), 1);
            let prompt = admission_prompt(&requests[0]);
            assert!(prompt.contains("GitHub identity: github:guest"));
            assert!(prompt.contains(&guest_identity.public.signature_key_fingerprint));
            let denied_secret = parse_invite_code(&denied_code).unwrap().invite;
            let debug = format!("{:?}", requests[0]);
            assert!(!debug.contains(&denied_secret.capability_handle));
            assert!(!debug.contains(&denied_secret.capability_url_value));
            assert!(!debug.contains(&requests[0].opened.mac));
            assert!(!debug.contains(&requests[0].opened.key_package));
            let decision = service
                .decide(
                    &requests[0],
                    &room,
                    &host_identity,
                    host_device_session.as_str(),
                    false,
                    valid_now,
                    &mut host_mls,
                )
                .unwrap();
            assert_eq!(decision.status, "denied");
            let replay = service
                .decide(
                    &requests[0],
                    &room,
                    &host_identity,
                    host_device_session.as_str(),
                    false,
                    valid_now,
                    &mut host_mls,
                )
                .unwrap();
            assert_eq!(replay.response_mac, decision.response_mac);

            let mut conflicting = requests[0].clone();
            conflicting.record.request_id = "conflicting-denial".into();
            conflicting.opened.binding.request_id = "conflicting-denial".into();
            assert_eq!(
                service.decide(
                    &conflicting,
                    &room,
                    &host_identity,
                    host_device_session.as_str(),
                    false,
                    valid_now,
                    &mut host_mls,
                ),
                Err(InviteError::Unavailable)
            );
            requests.into_iter().next().unwrap()
        };
        assert_eq!(denied_request.record.request_id, denied.request_id);
        {
            let mut backend = RelayInviteBackend::new_for_loopback_test(
                &guest_store,
                &http,
                &relay.info.base_url,
                &relay.info.ws_url,
                &guest_relay_session,
                &guest_session,
                &guest_identity,
            )
            .unwrap();
            assert_eq!(
                InviteService::new(&guest_store, &mut backend)
                    .finish_admission(&denied, guest_device_session.as_str(), &mut guest_mls,)
                    .unwrap(),
                None
            );
        }

        let expiring_code = {
            let mut backend = RelayInviteBackend::new_for_loopback_test(
                &host_store,
                &http,
                &relay.info.base_url,
                &relay.info.ws_url,
                &host_relay_session,
                &host_session,
                &host_identity,
            )
            .unwrap();
            InviteService::new(&host_store, &mut backend)
                .issue(&room, &host_identity)
                .unwrap()
        };
        let expires_at = parse_invite_code(&expiring_code)
            .unwrap()
            .invite
            .expires_at
            .clone();
        {
            let mut backend = RelayInviteBackend::new_for_loopback_test(
                &guest_store,
                &http,
                &relay.info.base_url,
                &relay.info.ws_url,
                &guest_relay_session,
                &guest_session,
                &guest_identity,
            )
            .unwrap();
            assert_eq!(
                InviteService::new(&guest_store, &mut backend).request_admission(
                    &expiring_code,
                    &guest_identity,
                    guest_device_session.as_str(),
                    &expires_at,
                    &guest_mls,
                ),
                Err(InviteError::Unavailable)
            );
        }

        let revoked_code = {
            let mut backend = RelayInviteBackend::new_for_loopback_test(
                &host_store,
                &http,
                &relay.info.base_url,
                &relay.info.ws_url,
                &host_relay_session,
                &host_session,
                &host_identity,
            )
            .unwrap();
            let mut service = InviteService::new(&host_store, &mut backend);
            let code = service.issue(&room, &host_identity).unwrap();
            assert!(service.revoke(&room, &host_identity).unwrap() >= 1);
            code
        };
        {
            let mut backend = RelayInviteBackend::new_for_loopback_test(
                &guest_store,
                &http,
                &relay.info.base_url,
                &relay.info.ws_url,
                &guest_relay_session,
                &guest_session,
                &guest_identity,
            )
            .unwrap();
            assert_eq!(
                InviteService::new(&guest_store, &mut backend).request_admission(
                    &revoked_code,
                    &guest_identity,
                    guest_device_session.as_str(),
                    valid_now,
                    &guest_mls,
                ),
                Err(InviteError::Unavailable)
            );
        }

        let approved_code = {
            let mut backend = RelayInviteBackend::new_for_loopback_test(
                &host_store,
                &http,
                &relay.info.base_url,
                &relay.info.ws_url,
                &host_relay_session,
                &host_session,
                &host_identity,
            )
            .unwrap();
            InviteService::new(&host_store, &mut backend)
                .issue(&room, &host_identity)
                .unwrap()
        };
        let approved = {
            let mut backend = RelayInviteBackend::new_for_loopback_test(
                &guest_store,
                &http,
                &relay.info.base_url,
                &relay.info.ws_url,
                &guest_relay_session,
                &guest_session,
                &guest_identity,
            )
            .unwrap();
            InviteService::new(&guest_store, &mut backend)
                .request_admission(
                    &approved_code,
                    &guest_identity,
                    guest_device_session.as_str(),
                    valid_now,
                    &guest_mls,
                )
                .unwrap()
        };
        {
            let invite_id = parse_invite_code(&approved_code).unwrap().invite_id;
            let mut backend = RelayInviteBackend::new_for_loopback_test(
                &host_store,
                &http,
                &relay.info.base_url,
                &relay.info.ws_url,
                &host_relay_session,
                &host_session,
                &host_identity,
            )
            .unwrap();
            let mut service = InviteService::new(&host_store, &mut backend);
            let requests = service
                .review_requests(
                    &invite_id,
                    &room,
                    &host_identity,
                    host_device_session.as_str(),
                    valid_now,
                    &host_mls,
                )
                .unwrap();
            let decision = service
                .decide(
                    &requests[0],
                    &room,
                    &host_identity,
                    host_device_session.as_str(),
                    true,
                    valid_now,
                    &mut host_mls,
                )
                .unwrap();
            assert_eq!(decision.status, "approved");
            let replay = service
                .decide(
                    &requests[0],
                    &room,
                    &host_identity,
                    host_device_session.as_str(),
                    true,
                    valid_now,
                    &mut host_mls,
                )
                .unwrap();
            assert_eq!(replay.response_mac, decision.response_mac);

            let mut conflicting = requests[0].clone();
            conflicting.record.request_id = "conflicting-request".into();
            conflicting.opened.binding.request_id = "conflicting-request".into();
            assert_eq!(
                service.decide(
                    &conflicting,
                    &room,
                    &host_identity,
                    host_device_session.as_str(),
                    true,
                    valid_now,
                    &mut host_mls,
                ),
                Err(InviteError::Unavailable)
            );
        }
        {
            let mut backend = RelayInviteBackend::new_for_loopback_test(
                &guest_store,
                &http,
                &relay.info.base_url,
                &relay.info.ws_url,
                &guest_relay_session,
                &guest_session,
                &guest_identity,
            )
            .unwrap();
            assert_eq!(
                InviteService::new(&guest_store, &mut backend)
                    .finish_admission(&approved, guest_device_session.as_str(), &mut guest_mls,)
                    .unwrap(),
                Some(1)
            );
        }
        assert_eq!(host_mls.open_group(&room.id).unwrap(), 1);
        assert_eq!(guest_mls.open_group(&room.id).unwrap(), 1);
        for code in [&denied_code, &expiring_code, &revoked_code, &approved_code] {
            let parsed = parse_invite_code(code).unwrap();
            assert_tree_excludes(&relay.info.temp_dir, code.as_bytes());
            assert_tree_excludes(
                &relay.info.temp_dir,
                parsed.invite.capability_handle.as_bytes(),
            );
            assert_tree_excludes(
                &relay.info.temp_dir,
                parsed.invite.capability_url_value.as_bytes(),
            );
        }
    }
}
