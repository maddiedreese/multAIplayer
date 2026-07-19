use crate::{
    identity::DeviceIdentity,
    platform::CredentialStore,
    relay::{RelayConnection, RelaySocket, RelayTransportError},
    CliError,
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use mls_core::{
    derive_capability_verifier, encode_capability_binding, generate_device_signing_secret,
    issue_capability, mac_binding, mac_response_binding, open, seal, validate_key_package_upload,
    verify_request_binding, verify_response_binding, ApplicationAuthenticatedData,
    BasicAppCredential, CapabilityBinding, EncryptedStore, EngineError, JoinAdmissionMetadata,
    KeyPackageUpload, MlsEngine, OutboxItem, OutboxMetadata, PendingInviteRequest, SealedPayload,
    StoreError, WelcomeRetryMetadata,
};
use multaiplayer_protocol::{
    MlsMessageType, MlsRelayMessage, RelayClientMessage, RelayErrorCode, RelayServerMessage,
    Validate,
};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use thiserror::Error;
use uuid::Uuid;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub const MLS_STORAGE_KEY_ACCOUNT: &str = "mls-store-wrap:v1";

#[derive(Debug, Error, Eq, PartialEq)]
pub enum MlsClientError {
    #[error("The MLS state store is unavailable.")]
    StorageUnavailable,
    #[error("The MLS state belongs to another authenticated device.")]
    IdentityScopeMismatch,
    #[error("The MLS state is corrupt or incompatible and requires an explicit rejoin.")]
    RequiresRejoin,
    #[error("The requested MLS group is not present in local state.")]
    GroupNotFound,
    #[error("The durable MLS outbox contains an invalid or unsupported record.")]
    InvalidOutbox,
    #[error("The invite capability, binding, or response is invalid.")]
    InvalidInvite,
    #[error("The relay operation failed.")]
    Relay(#[source] RelayTransportError),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutboxRoute {
    pub team_id: String,
    pub room_id: String,
    /// A validated RFC 3339 timestamp supplied by the platform clock adapter.
    pub created_at: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct DrainReport {
    pub published: Vec<String>,
    pub expired_applications: Vec<String>,
}

const INVITE_CAPABILITY_ACCOUNT_PREFIX: &str = "invite-capability:v1:";

#[derive(Clone, Eq, PartialEq, Zeroize, ZeroizeOnDrop)]
pub struct IssuedInviteCapability {
    pub handle: String,
    pub url_value: String,
}

impl std::fmt::Debug for IssuedInviteCapability {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("IssuedInviteCapability")
            .field("handle", &"[redacted]")
            .field("url_value", &"[redacted]")
            .finish()
    }
}

#[derive(Clone, Eq, PartialEq)]
pub struct PreparedInviteRequest {
    pub invite_id: String,
    pub request_id: String,
    pub requester_device_id: String,
    pub key_package_id: String,
    pub key_package: String,
    pub key_package_hash: String,
    pub sealed_request: String,
    pub binding: CapabilityBinding,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingInviteAdmission {
    pub invite_id: String,
    pub request_id: String,
    pub requester_user_id: String,
    pub requester_device_id: String,
    pub room_id: String,
    pub expires_at: String,
}

impl std::fmt::Debug for PreparedInviteRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PreparedInviteRequest")
            .field("invite_id", &self.invite_id)
            .field("request_id", &self.request_id)
            .field("requester_device_id", &self.requester_device_id)
            .field("key_package_id", &self.key_package_id)
            .field("key_package", &"[redacted key package]")
            .field("key_package_hash", &self.key_package_hash)
            .field("sealed_request", &"[redacted sealed request]")
            .field("binding", &self.binding)
            .finish()
    }
}

#[derive(Clone, Eq, PartialEq)]
pub struct OpenedInviteRequest {
    pub capability_handle: String,
    pub binding: CapabilityBinding,
    pub key_package: String,
    pub key_package_id: String,
    pub mac: String,
    pub requester_signature_public_key: String,
    pub requester_signature_key_fingerprint: String,
}

impl std::fmt::Debug for OpenedInviteRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OpenedInviteRequest")
            .field("capability_handle", &"[redacted]")
            .field("binding", &self.binding)
            .field("key_package", &"[redacted key package]")
            .field("key_package_id", &self.key_package_id)
            .field("mac", &"[redacted]")
            .field(
                "requester_signature_key_fingerprint",
                &self.requester_signature_key_fingerprint,
            )
            .finish()
    }
}

impl Zeroize for OpenedInviteRequest {
    fn zeroize(&mut self) {
        self.capability_handle.zeroize();
        self.key_package.zeroize();
        self.mac.zeroize();
    }
}

impl Drop for OpenedInviteRequest {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InviteDecision {
    pub status: String,
    pub response_binding: CapabilityBinding,
    pub response_mac: String,
    pub commit_outbox_id: Option<String>,
    pub response_outbox_id: String,
    pub welcome: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectedInviteRequestEnvelope<'a> {
    version: u8,
    binding: &'a CapabilityBinding,
    sealed_payload: &'a SealedPayload,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DirectedInviteRequestEnvelopeOwned {
    version: u8,
    binding: CapabilityBinding,
    sealed_payload: SealedPayload,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InviteRequestPayload {
    capability_handle: String,
    binding: CapabilityBinding,
    key_package: String,
    mac: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredMlsStorageKey {
    version: u8,
    github_user_id: String,
    device_id: String,
    wrapping_key: SecretString,
}

impl Zeroize for StoredMlsStorageKey {
    fn zeroize(&mut self) {
        self.wrapping_key.zeroize();
    }
}

impl ZeroizeOnDrop for StoredMlsStorageKey {}

impl Drop for StoredMlsStorageKey {
    fn drop(&mut self) {
        self.zeroize();
    }
}

struct SecretString(String);

impl SecretString {
    fn new(value: String) -> Self {
        Self(value)
    }

    fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl Serialize for SecretString {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for SecretString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        String::deserialize(deserializer).map(Self::new)
    }
}

impl Zeroize for SecretString {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl ZeroizeOnDrop for SecretString {}

impl Drop for SecretString {
    fn drop(&mut self) {
        self.zeroize();
    }
}

pub trait MlsPublisher {
    fn publish(&mut self, message: &RelayClientMessage) -> Result<(), RelayTransportError>;
}

pub struct RelayMlsPublisher<'a, S, H> {
    connection: &'a mut RelayConnection<S>,
    timeout: Duration,
    handler: &'a mut H,
}

impl<'a, S, H> RelayMlsPublisher<'a, S, H> {
    pub fn new(
        connection: &'a mut RelayConnection<S>,
        timeout: Duration,
        handler: &'a mut H,
    ) -> Self {
        Self {
            connection,
            timeout,
            handler,
        }
    }
}

impl<S, H> MlsPublisher for RelayMlsPublisher<'_, S, H>
where
    S: RelaySocket,
    H: FnMut(&RelayServerMessage) -> Result<(), RelayTransportError>,
{
    fn publish(&mut self, message: &RelayClientMessage) -> Result<(), RelayTransportError> {
        self.connection
            .publish_and_wait_for_ack(message, self.timeout, self.handler)
    }
}

pub struct MlsClientService {
    engine: MlsEngine,
    store: EncryptedStore,
    user_id: String,
    device_id: String,
    requires_rejoin: BTreeSet<String>,
}

impl MlsClientService {
    pub fn open(
        credential_store: &impl CredentialStore,
        identity: &DeviceIdentity,
        path: &Path,
    ) -> Result<Self, MlsClientError> {
        let state_exists = state_files_exist(path);
        let wrapping_key = load_or_create_storage_key(
            credential_store,
            &identity.public.user_id,
            &identity.public.device_id,
            state_exists,
        )?;
        let credential = BasicAppCredential {
            github_user_id: identity.public.user_id.clone(),
            device_id: identity.public.device_id.clone(),
        };
        let signing_secret = identity.mls_signing_secret();
        let engine =
            MlsEngine::open_persistent(credential, signing_secret.to_vec(), path, *wrapping_key)
                .map_err(|_| {
                    if state_exists {
                        MlsClientError::RequiresRejoin
                    } else {
                        MlsClientError::StorageUnavailable
                    }
                })?;
        let store = EncryptedStore::open(path, *wrapping_key).map_err(map_store_open_error)?;
        secure_store_permissions(path)?;
        Ok(Self {
            engine,
            store,
            user_id: identity.public.user_id.clone(),
            device_id: identity.public.device_id.clone(),
            requires_rejoin: BTreeSet::new(),
        })
    }

    pub fn open_group(&mut self, room_id: &str) -> Result<u64, MlsClientError> {
        match self.engine.open_group(room_id) {
            Ok(epoch) => {
                self.requires_rejoin.remove(room_id);
                Ok(epoch)
            }
            Err(error) if error.is_requires_rejoin() => {
                self.requires_rejoin.insert(room_id.to_owned());
                Err(MlsClientError::RequiresRejoin)
            }
            Err(EngineError::GroupNotFound) => Err(MlsClientError::GroupNotFound),
            Err(_) => Err(MlsClientError::StorageUnavailable),
        }
    }

    /// Establishes epoch zero durably, or reopens the exact existing group on retry.
    pub fn create_group_idempotent(&mut self, room_id: &str) -> Result<u64, MlsClientError> {
        match self.open_group(room_id) {
            Ok(epoch) => Ok(epoch),
            Err(MlsClientError::GroupNotFound) => {
                self.engine.create_group(room_id).map_err(map_engine_error)
            }
            Err(error) => Err(error),
        }
    }

    pub fn issue_invite_capability(
        credential_store: &impl CredentialStore,
    ) -> Result<IssuedInviteCapability, MlsClientError> {
        let mut issued = issue_capability();
        let raw = Zeroizing::new(issued.take_url_value());
        let handle = Uuid::new_v4().to_string();
        let encoded_verifier = Zeroizing::new(STANDARD.encode(issued.verifier()));
        credential_store
            .set(
                &format!("{INVITE_CAPABILITY_ACCOUNT_PREFIX}{handle}"),
                encoded_verifier.as_str(),
            )
            .map_err(|_| MlsClientError::StorageUnavailable)?;
        Ok(IssuedInviteCapability {
            handle,
            url_value: URL_SAFE_NO_PAD.encode(raw.as_slice()),
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn prepare_invite_request(
        &self,
        host_hpke_public_key: &str,
        capability_handle: &str,
        capability_url_value: &str,
        invite_id: &str,
        team_id: &str,
        room_id: &str,
        key_epoch: u64,
        host_user_id: &str,
        host_device_id: &str,
        expires_at: &str,
    ) -> Result<PreparedInviteRequest, MlsClientError> {
        if !valid_capability_handle(capability_handle) {
            return Err(MlsClientError::InvalidInvite);
        }
        let capability = decode_url_key(capability_url_value)?;
        let host_hpke = STANDARD
            .decode(host_hpke_public_key)
            .map_err(|_| MlsClientError::InvalidInvite)?;
        let key_package = self
            .engine
            .generate_key_package()
            .map_err(map_engine_error)?;
        let key_package_encoded = STANDARD.encode(&key_package);
        let key_package_hash = format!("sha256:{:x}", Sha256::digest(&key_package));
        let key_package_id = Uuid::new_v4().to_string();
        let request_id = Uuid::new_v4().to_string();
        let nonce = Zeroizing::new(generate_device_signing_secret().map_err(map_invite_error)?);
        let binding = CapabilityBinding {
            version: 3,
            phase: "request".into(),
            invite_id: invite_id.into(),
            team_id: team_id.into(),
            room_id: room_id.into(),
            key_epoch,
            key_package_hash: key_package_hash.clone(),
            request_id: request_id.clone(),
            request_nonce: URL_SAFE_NO_PAD.encode(nonce),
            requester_user_id: self.user_id.clone(),
            requester_device_id: self.device_id.clone(),
            host_user_id: host_user_id.into(),
            host_device_id: host_device_id.into(),
            expires_at: expires_at.into(),
            status: None,
            decided_at: None,
        };
        let request_mac =
            Zeroizing::new(mac_binding(&capability, &binding).map_err(map_invite_error)?);
        let mut payload = InviteRequestPayload {
            capability_handle: capability_handle.into(),
            binding: binding.clone(),
            key_package: key_package_encoded.clone(),
            mac: STANDARD.encode(request_mac.as_slice()),
        };
        let aad = encode_capability_binding(&binding).map_err(map_invite_error)?;
        let serialized_payload = Zeroizing::new(
            serde_json::to_vec(&payload).map_err(|_| MlsClientError::InvalidInvite)?,
        );
        payload.capability_handle.zeroize();
        payload.key_package.zeroize();
        payload.mac.zeroize();
        let sealed_payload = seal(
            &host_hpke,
            b"multaiplayer:invite-request:v3",
            &aad,
            serialized_payload.as_slice(),
        )
        .map_err(map_invite_error)?;
        let sealed_request = serde_json::to_string(&DirectedInviteRequestEnvelope {
            version: 3,
            binding: &binding,
            sealed_payload: &sealed_payload,
        })
        .map_err(|_| MlsClientError::InvalidInvite)?;
        let mut pending = PendingInviteRequest {
            capability_url_value: capability_url_value.into(),
            original_binding: binding.clone(),
            key_package_id: key_package_id.clone(),
            sealed_request: sealed_request.clone(),
        };
        let stored = self
            .store
            .put_pending_invite_request(&pending)
            .map_err(map_store_error);
        pending.capability_url_value.zeroize();
        stored?;
        Ok(PreparedInviteRequest {
            invite_id: invite_id.into(),
            request_id,
            requester_device_id: self.device_id.clone(),
            key_package_id,
            key_package: key_package_encoded,
            key_package_hash,
            sealed_request,
            binding,
        })
    }

    pub fn open_invite_request(
        &self,
        identity: &DeviceIdentity,
        key_package_id: &str,
        sealed_request: &str,
    ) -> Result<OpenedInviteRequest, MlsClientError> {
        let envelope: DirectedInviteRequestEnvelopeOwned =
            serde_json::from_str(sealed_request).map_err(|_| MlsClientError::InvalidInvite)?;
        if envelope.version != 3 || envelope.binding.phase != "request" {
            return Err(MlsClientError::InvalidInvite);
        }
        let aad = encode_capability_binding(&envelope.binding).map_err(map_invite_error)?;
        let plaintext = Zeroizing::new(
            open(
                &identity.hpke,
                b"multaiplayer:invite-request:v3",
                &aad,
                &envelope.sealed_payload,
            )
            .map_err(map_invite_error)?,
        );
        let mut payload: InviteRequestPayload =
            serde_json::from_slice(&plaintext).map_err(|_| MlsClientError::InvalidInvite)?;
        if payload.binding != envelope.binding
            || !valid_capability_handle(&payload.capability_handle)
        {
            return Err(MlsClientError::InvalidInvite);
        }
        let key_package = STANDARD
            .decode(&payload.key_package)
            .map_err(|_| MlsClientError::InvalidInvite)?;
        if format!("sha256:{:x}", Sha256::digest(&key_package)) != envelope.binding.key_package_hash
        {
            return Err(MlsClientError::InvalidInvite);
        }
        let validated = validate_key_package_upload(&KeyPackageUpload {
            key_package: payload.key_package.clone(),
            uploader_github_user_id: envelope.binding.requester_user_id.clone(),
            uploader_device_id: envelope.binding.requester_device_id.clone(),
        })
        .map_err(|_| MlsClientError::InvalidInvite)?;
        Ok(OpenedInviteRequest {
            capability_handle: std::mem::take(&mut payload.capability_handle),
            binding: envelope.binding,
            key_package: std::mem::take(&mut payload.key_package),
            key_package_id: key_package_id.into(),
            mac: std::mem::take(&mut payload.mac),
            requester_signature_public_key: validated.signature_public_key,
            requester_signature_key_fingerprint: validated.signature_key_fingerprint,
        })
    }

    pub fn decide_invite(
        &mut self,
        credential_store: &impl CredentialStore,
        request: &OpenedInviteRequest,
        approve: bool,
        decided_at: &str,
    ) -> Result<InviteDecision, MlsClientError> {
        let binding_hash = format!(
            "{:x}",
            Sha256::digest(encode_capability_binding(&request.binding).map_err(map_invite_error)?)
        );
        if let Some(receipt) = self
            .engine
            .invite_receipt(&request.capability_handle)
            .map_err(map_engine_error)?
        {
            if !approve
                || receipt.binding_hash != binding_hash
                || receipt.key_package_hash != request.binding.key_package_hash
            {
                return Err(MlsClientError::InvalidInvite);
            }
            let welcome = self.outbox_payload(&receipt.welcome_outbox_id)?;
            return Ok(InviteDecision {
                status: "approved".into(),
                response_binding: receipt.response_binding,
                response_mac: receipt.response_mac,
                commit_outbox_id: Some(receipt.commit_outbox_id),
                response_outbox_id: receipt.welcome_outbox_id,
                welcome: Some(STANDARD.encode(welcome)),
            });
        }
        if let Some((receipt, response_binding, response_mac)) = self
            .engine
            .denied_invite_response(&request.capability_handle)
            .map_err(map_engine_error)?
        {
            if approve
                || receipt.binding_hash != binding_hash
                || receipt.key_package_hash != request.binding.key_package_hash
            {
                return Err(MlsClientError::InvalidInvite);
            }
            return Ok(InviteDecision {
                status: "denied".into(),
                response_binding,
                response_mac,
                commit_outbox_id: None,
                response_outbox_id: receipt.response_outbox_id,
                welcome: None,
            });
        }
        let verifier = load_invite_verifier(credential_store, &request.capability_handle)?;
        let mac = decode_standard_key(&request.mac)?;
        verify_request_binding(&verifier, &request.binding, &mac).map_err(map_invite_error)?;
        let mut response_binding = request.binding.clone();
        response_binding.phase = "response".into();
        response_binding.status = Some(if approve { "approved" } else { "denied" }.into());
        response_binding.decided_at = Some(decided_at.into());
        let response_mac_bytes = Zeroizing::new(
            mac_response_binding(&verifier, &response_binding).map_err(map_invite_error)?,
        );
        let response_mac = STANDARD.encode(response_mac_bytes.as_slice());
        let decision = if approve {
            let key_package = STANDARD
                .decode(&request.key_package)
                .map_err(|_| MlsClientError::InvalidInvite)?;
            let output = self
                .engine
                .add_member_for_invite(
                    &request.binding.room_id,
                    &key_package,
                    WelcomeRetryMetadata {
                        invite_id: request.binding.invite_id.clone(),
                        request_id: request.binding.request_id.clone(),
                        requester_user_id: request.binding.requester_user_id.clone(),
                        requester_device_id: request.binding.requester_device_id.clone(),
                        key_package_id: request.key_package_id.clone(),
                        key_package_hash: request.binding.key_package_hash.clone(),
                        response_binding: response_binding.clone(),
                        response_mac: response_mac.clone(),
                    },
                    request.capability_handle.clone(),
                    binding_hash,
                )
                .map_err(map_engine_error)?;
            InviteDecision {
                status: "approved".into(),
                response_binding,
                response_mac,
                commit_outbox_id: Some(output.commit_outbox_id),
                response_outbox_id: output.welcome_outbox_id,
                welcome: Some(STANDARD.encode(output.welcome)),
            }
        } else {
            let outbox_id = self
                .engine
                .deny_invite(
                    request.capability_handle.clone(),
                    binding_hash,
                    request.binding.key_package_hash.clone(),
                    response_binding.clone(),
                    response_mac.clone(),
                )
                .map_err(map_engine_error)?;
            InviteDecision {
                status: "denied".into(),
                response_binding,
                response_mac,
                commit_outbox_id: None,
                response_outbox_id: outbox_id,
                welcome: None,
            }
        };
        credential_store
            .delete(&format!(
                "{INVITE_CAPABILITY_ACCOUNT_PREFIX}{}",
                request.capability_handle
            ))
            .map_err(|_| MlsClientError::StorageUnavailable)?;
        Ok(decision)
    }

    pub fn has_invite_decision(&self, capability_handle: &str) -> Result<bool, MlsClientError> {
        Ok(self
            .engine
            .invite_receipt(capability_handle)
            .map_err(map_engine_error)?
            .is_some()
            || self
                .engine
                .denied_invite_response(capability_handle)
                .map_err(map_engine_error)?
                .is_some())
    }

    pub fn accept_invite_response(
        &mut self,
        request_id: &str,
        response_binding: CapabilityBinding,
        response_mac: &str,
        welcome: Option<&str>,
    ) -> Result<Option<u64>, MlsClientError> {
        let mut pending = self
            .store
            .pending_invite_request(request_id)
            .map_err(map_store_error)?
            .ok_or(MlsClientError::InvalidInvite)?;
        let capability_url_value =
            Zeroizing::new(std::mem::take(&mut pending.capability_url_value));
        validate_response_pair(&pending.original_binding, &response_binding)?;
        let capability = decode_url_key(capability_url_value.as_str())?;
        let response_mac_bytes = decode_standard_key(response_mac)?;
        let response_verifier = Zeroizing::new(derive_capability_verifier(&capability));
        verify_response_binding(&response_verifier, &response_binding, &response_mac_bytes)
            .map_err(map_invite_error)?;
        let epoch = match response_binding.status.as_deref() {
            Some("approved") => {
                let welcome = Zeroizing::new(
                    STANDARD
                        .decode(welcome.ok_or(MlsClientError::InvalidInvite)?)
                        .map_err(|_| MlsClientError::InvalidInvite)?,
                );
                let response_hash = format!(
                    "{:x}",
                    Sha256::digest(
                        serde_json::to_vec(&(
                            &pending.original_binding,
                            &response_binding,
                            response_mac,
                            welcome.as_slice(),
                        ))
                        .map_err(|_| MlsClientError::InvalidInvite)?
                    )
                );
                Some(
                    self.engine
                        .join_welcome_for_invite(
                            &welcome,
                            JoinAdmissionMetadata {
                                invite_id: pending.original_binding.invite_id.clone(),
                                team_id: pending.original_binding.team_id.clone(),
                                room_id: pending.original_binding.room_id.clone(),
                                request_id: pending.original_binding.request_id.clone(),
                                requester_user_id: pending
                                    .original_binding
                                    .requester_user_id
                                    .clone(),
                                requester_device_id: pending
                                    .original_binding
                                    .requester_device_id
                                    .clone(),
                            },
                            response_hash,
                        )
                        .map_err(map_engine_error)?,
                )
            }
            Some("denied") if welcome.is_none() => None,
            _ => return Err(MlsClientError::InvalidInvite),
        };
        Ok(epoch)
    }

    pub fn complete_invite_response(
        &self,
        request_id: &str,
        room_id: &str,
        approved: bool,
    ) -> Result<(), MlsClientError> {
        self.store
            .delete_pending_invite_request(request_id)
            .map_err(map_store_error)?;
        if approved {
            self.engine
                .complete_join_admission(room_id, request_id)
                .map_err(map_engine_error)?;
        }
        Ok(())
    }

    pub fn pending_invite_admission(
        &self,
        request_id: &str,
    ) -> Result<Option<PendingInviteAdmission>, MlsClientError> {
        let pending = self
            .store
            .pending_invite_request(request_id)
            .map_err(map_store_error)?;
        let Some(pending) = pending else {
            return Ok(None);
        };
        if pending.original_binding.request_id != request_id
            || pending.original_binding.requester_device_id != self.device_id
        {
            return Err(MlsClientError::InvalidInvite);
        }
        Ok(Some(PendingInviteAdmission {
            invite_id: pending.original_binding.invite_id,
            request_id: pending.original_binding.request_id,
            requester_user_id: pending.original_binding.requester_user_id,
            requester_device_id: self.device_id.clone(),
            room_id: pending.original_binding.room_id,
            expires_at: pending.original_binding.expires_at,
        }))
    }

    fn outbox_payload(&self, id: &str) -> Result<Vec<u8>, MlsClientError> {
        self.store
            .pending_outbox()
            .map_err(map_store_error)?
            .into_iter()
            .find(|item| item.id == id)
            .map(|item| item.payload)
            .ok_or(MlsClientError::InvalidInvite)
    }

    pub fn room_requires_rejoin(&self, room_id: &str) -> bool {
        self.requires_rejoin.contains(room_id)
    }

    pub fn pending_outbox_room_ids(&self) -> Result<Vec<String>, MlsClientError> {
        let items = self.store.pending_outbox().map_err(map_store_error)?;
        Ok(items
            .into_iter()
            .map(|item| item.room_id)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect())
    }

    pub fn drain_room_outbox(
        &mut self,
        route: &OutboxRoute,
        publisher: &mut impl MlsPublisher,
    ) -> Result<DrainReport, MlsClientError> {
        if route.room_id.is_empty() {
            return Err(MlsClientError::InvalidOutbox);
        }
        let mut items = self.store.pending_outbox().map_err(map_store_error)?;
        items.retain(|item| item.room_id == route.room_id);
        items.sort_by(|left, right| {
            left.epoch
                .cmp(&right.epoch)
                .then_with(|| outbox_priority(&left.kind).cmp(&outbox_priority(&right.kind)))
                .then_with(|| left.id.cmp(&right.id))
        });

        let result = drain_items(
            &mut self.engine,
            items,
            route,
            self.user_id.as_str(),
            self.device_id.as_str(),
            publisher,
        );
        if result == Err(MlsClientError::RequiresRejoin) {
            self.requires_rejoin.insert(route.room_id.clone());
        }
        result
    }

    pub fn publish_invite_commit(
        &mut self,
        route: &OutboxRoute,
        expected_id: &str,
        publisher: &mut impl MlsPublisher,
    ) -> Result<(), MlsClientError> {
        let item = self
            .store
            .pending_outbox()
            .map_err(map_store_error)?
            .into_iter()
            .find(|item| {
                item.id == expected_id && item.room_id == route.room_id && item.kind == "add"
            })
            .ok_or(MlsClientError::InvalidInvite)?;
        let message =
            relay_message_for_item(&item, route, self.user_id.as_str(), self.device_id.as_str())?;
        publisher
            .publish(&RelayClientMessage::Publish {
                message: Box::new(message),
            })
            .map_err(MlsClientError::Relay)?;
        self.engine
            .publish_succeeded(&route.room_id, expected_id)
            .map(|_| ())
            .map_err(map_engine_error)
    }
}

trait OutboxAuthority {
    fn publish_succeeded(&mut self, room_id: &str, message_id: &str) -> Result<(), MlsClientError>;
    fn clear_stale_commit(&mut self, room_id: &str, message_id: &str)
        -> Result<(), MlsClientError>;
    fn retire_expired_application(
        &mut self,
        room_id: &str,
        message_id: &str,
    ) -> Result<(), MlsClientError>;
}

impl OutboxAuthority for MlsEngine {
    fn publish_succeeded(&mut self, room_id: &str, message_id: &str) -> Result<(), MlsClientError> {
        MlsEngine::publish_succeeded(self, room_id, message_id)
            .map(|_| ())
            .map_err(map_engine_error)
    }

    fn clear_stale_commit(
        &mut self,
        room_id: &str,
        message_id: &str,
    ) -> Result<(), MlsClientError> {
        self.clear_pending_commit(room_id, message_id)
            .map(|_| ())
            .map_err(map_engine_error)
    }

    fn retire_expired_application(
        &mut self,
        room_id: &str,
        message_id: &str,
    ) -> Result<(), MlsClientError> {
        self.retire_stale_application(room_id, message_id)
            .map(|_| ())
            .map_err(map_engine_error)
    }
}

fn drain_items(
    authority: &mut impl OutboxAuthority,
    items: Vec<OutboxItem>,
    route: &OutboxRoute,
    user_id: &str,
    device_id: &str,
    publisher: &mut impl MlsPublisher,
) -> Result<DrainReport, MlsClientError> {
    let mut report = DrainReport::default();
    for item in items {
        let message = relay_message_for_item(&item, route, user_id, device_id)?;
        match publisher.publish(&RelayClientMessage::Publish {
            message: Box::new(message.clone()),
        }) {
            Ok(()) => {
                authority.publish_succeeded(&route.room_id, &item.id)?;
                report.published.push(item.id);
            }
            Err(RelayTransportError::AckRejected(Some(
                RelayErrorCode::ApplicationEpochExpired,
            ))) if message.message_type == MlsMessageType::Application => {
                authority.retire_expired_application(&route.room_id, &item.id)?;
                report.expired_applications.push(item.id);
            }
            Err(RelayTransportError::AckRejected(Some(RelayErrorCode::StaleEpoch)))
                if message.message_type == MlsMessageType::Commit =>
            {
                authority.clear_stale_commit(&route.room_id, &item.id)?;
                return Err(MlsClientError::RequiresRejoin);
            }
            Err(error) => return Err(MlsClientError::Relay(error)),
        }
    }
    Ok(report)
}

fn load_or_create_storage_key(
    store: &impl CredentialStore,
    user_id: &str,
    device_id: &str,
    state_exists: bool,
) -> Result<Zeroizing<[u8; 32]>, MlsClientError> {
    if let Some(value) = store
        .get(MLS_STORAGE_KEY_ACCOUNT)
        .map_err(map_credential_error)?
    {
        let value = Zeroizing::new(value);
        let stored: StoredMlsStorageKey =
            serde_json::from_str(value.as_str()).map_err(|_| MlsClientError::RequiresRejoin)?;
        if stored.version != 1 {
            return Err(MlsClientError::RequiresRejoin);
        }
        if stored.github_user_id != user_id || stored.device_id != device_id {
            return Err(MlsClientError::IdentityScopeMismatch);
        }
        return decode_fixed_key(stored.wrapping_key.as_str());
    }
    if state_exists {
        return Err(MlsClientError::RequiresRejoin);
    }
    let generated = Zeroizing::new(
        generate_device_signing_secret().map_err(|_| MlsClientError::StorageUnavailable)?,
    );
    let key = normalize_generated_storage_key(generated.as_slice())?;
    let stored = StoredMlsStorageKey {
        version: 1,
        github_user_id: user_id.to_owned(),
        device_id: device_id.to_owned(),
        wrapping_key: SecretString::new(STANDARD.encode(key.as_ref())),
    };
    let serialized = Zeroizing::new(
        serde_json::to_string(&stored).map_err(|_| MlsClientError::StorageUnavailable)?,
    );
    store
        .set(MLS_STORAGE_KEY_ACCOUNT, serialized.as_str())
        .map_err(map_credential_error)?;
    Ok(key)
}

fn normalize_generated_storage_key(
    generated: &[u8],
) -> Result<Zeroizing<[u8; 32]>, MlsClientError> {
    if generated.is_empty() || generated.len() > 32 {
        return Err(MlsClientError::StorageUnavailable);
    }
    let mut key = Zeroizing::new([0; 32]);
    key[32 - generated.len()..].copy_from_slice(generated);
    Ok(key)
}

fn decode_fixed_key(value: &str) -> Result<Zeroizing<[u8; 32]>, MlsClientError> {
    let bytes = Zeroizing::new(
        STANDARD
            .decode(value)
            .map_err(|_| MlsClientError::RequiresRejoin)?,
    );
    let canonical = Zeroizing::new(STANDARD.encode(bytes.as_slice()));
    if canonical.as_str() != value {
        return Err(MlsClientError::RequiresRejoin);
    }
    if bytes.len() != 32 {
        return Err(MlsClientError::RequiresRejoin);
    }
    let mut key = Zeroizing::new([0; 32]);
    key.copy_from_slice(bytes.as_slice());
    Ok(key)
}

fn relay_message_for_item(
    item: &OutboxItem,
    route: &OutboxRoute,
    user_id: &str,
    device_id: &str,
) -> Result<MlsRelayMessage, MlsClientError> {
    if item.room_id != route.room_id {
        return Err(MlsClientError::InvalidOutbox);
    }
    let metadata = item
        .metadata
        .as_deref()
        .map(serde_json::from_slice::<OutboxMetadata>)
        .transpose()
        .map_err(|_| MlsClientError::InvalidOutbox)?;
    let message = match metadata {
        Some(OutboxMetadata::Application { authenticated_data }) => {
            let authenticated: ApplicationAuthenticatedData =
                serde_json::from_slice(&authenticated_data)
                    .map_err(|_| MlsClientError::InvalidOutbox)?;
            if item.kind != "application"
                || authenticated.message_id != item.id
                || authenticated.room_id != route.room_id
                || authenticated.team_id != route.team_id
                || authenticated.sender_user_id != user_id
                || authenticated.sender_device_id != device_id
                || authenticated.epoch != item.epoch
            {
                return Err(MlsClientError::InvalidOutbox);
            }
            MlsRelayMessage {
                id: item.id.clone(),
                team_id: authenticated.team_id,
                room_id: authenticated.room_id,
                sender_device_id: authenticated.sender_device_id,
                sender_user_id: authenticated.sender_user_id,
                created_at: authenticated.created_at,
                message_type: MlsMessageType::Application,
                epoch_hint: authenticated.epoch,
                mls_message: STANDARD.encode(&item.payload),
                commit_effect: None,
                next_host_user_id: None,
                next_host_device_id: None,
                host_transfer_authorization: None,
            }
        }
        Some(OutboxMetadata::Commit { parent_epoch })
            if matches!(item.kind.as_str(), "add" | "remove") =>
        {
            MlsRelayMessage {
                id: item.id.clone(),
                team_id: route.team_id.clone(),
                room_id: route.room_id.clone(),
                sender_device_id: device_id.to_owned(),
                sender_user_id: user_id.to_owned(),
                created_at: route.created_at.clone(),
                message_type: MlsMessageType::Commit,
                epoch_hint: parent_epoch,
                mls_message: STANDARD.encode(&item.payload),
                commit_effect: None,
                next_host_user_id: None,
                next_host_device_id: None,
                host_transfer_authorization: None,
            }
        }
        // Welcome/invite-response publication and host handoff belong to later tasks.
        _ => return Err(MlsClientError::InvalidOutbox),
    };
    message
        .validate()
        .map_err(|_| MlsClientError::InvalidOutbox)?;
    Ok(message)
}

fn outbox_priority(kind: &str) -> u8 {
    match kind {
        "application" => 0,
        "welcome" | "invite-denial" => 2,
        _ => 1,
    }
}

fn state_files_exist(path: &Path) -> bool {
    [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ]
    .iter()
    .any(|candidate| candidate.exists())
}

fn secure_store_permissions(path: &Path) -> Result<(), MlsClientError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|_| MlsClientError::StorageUnavailable)?;
    }
    Ok(())
}

fn map_credential_error(_: CliError) -> MlsClientError {
    MlsClientError::StorageUnavailable
}

fn map_store_open_error(error: StoreError) -> MlsClientError {
    if error.is_database_corruption() {
        MlsClientError::RequiresRejoin
    } else {
        MlsClientError::StorageUnavailable
    }
}

fn map_store_error(error: StoreError) -> MlsClientError {
    if error.is_database_corruption() {
        return MlsClientError::RequiresRejoin;
    }
    match error {
        StoreError::CorruptValue | StoreError::InvalidValue => MlsClientError::RequiresRejoin,
        StoreError::Sqlite(_) => MlsClientError::StorageUnavailable,
    }
}

fn map_invite_error<T>(_error: T) -> MlsClientError {
    MlsClientError::InvalidInvite
}

fn valid_capability_handle(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn decode_url_key(value: &str) -> Result<Zeroizing<[u8; 32]>, MlsClientError> {
    let bytes = Zeroizing::new(
        URL_SAFE_NO_PAD
            .decode(value)
            .map_err(|_| MlsClientError::InvalidInvite)?,
    );
    bytes
        .as_slice()
        .try_into()
        .map(Zeroizing::new)
        .map_err(|_| MlsClientError::InvalidInvite)
}

fn decode_standard_key(value: &str) -> Result<Zeroizing<[u8; 32]>, MlsClientError> {
    let bytes = Zeroizing::new(
        STANDARD
            .decode(value)
            .map_err(|_| MlsClientError::InvalidInvite)?,
    );
    bytes
        .as_slice()
        .try_into()
        .map(Zeroizing::new)
        .map_err(|_| MlsClientError::InvalidInvite)
}

fn load_invite_verifier(
    store: &impl CredentialStore,
    handle: &str,
) -> Result<Zeroizing<[u8; 32]>, MlsClientError> {
    if !valid_capability_handle(handle) {
        return Err(MlsClientError::InvalidInvite);
    }
    let encoded = Zeroizing::new(
        store
            .get(&format!("{INVITE_CAPABILITY_ACCOUNT_PREFIX}{handle}"))
            .map_err(|_| MlsClientError::StorageUnavailable)?
            .ok_or(MlsClientError::InvalidInvite)?,
    );
    decode_standard_key(encoded.as_str())
}

fn validate_response_pair(
    original: &CapabilityBinding,
    response: &CapabilityBinding,
) -> Result<(), MlsClientError> {
    if original.version != 3
        || original.phase != "request"
        || original.status.is_some()
        || original.decided_at.is_some()
        || response.version != 3
        || response.phase != "response"
        || response.status.is_none()
        || response.decided_at.is_none()
        || original.invite_id != response.invite_id
        || original.team_id != response.team_id
        || original.room_id != response.room_id
        || original.key_epoch != response.key_epoch
        || original.key_package_hash != response.key_package_hash
        || original.request_id != response.request_id
        || original.request_nonce != response.request_nonce
        || original.requester_user_id != response.requester_user_id
        || original.requester_device_id != response.requester_device_id
        || original.host_user_id != response.host_user_id
        || original.host_device_id != response.host_device_id
        || original.expires_at != response.expires_at
    {
        return Err(MlsClientError::InvalidInvite);
    }
    encode_capability_binding(response).map_err(map_invite_error)?;
    Ok(())
}

fn map_engine_error(error: EngineError) -> MlsClientError {
    match error {
        EngineError::RequiresRejoin { .. } => MlsClientError::RequiresRejoin,
        EngineError::GroupNotFound => MlsClientError::GroupNotFound,
        EngineError::InvalidInput => MlsClientError::InvalidOutbox,
        _ => MlsClientError::StorageUnavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{identity::load_or_create_identity, platform::tests::MemoryCredentialStore};
    use mls_core::ApplicationAuthenticatedDataInput;
    use std::collections::VecDeque;
    use uuid::Uuid;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("multaiplayer-cli-mls-{}", Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn database(&self) -> PathBuf {
            self.0.join("mls.db")
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[derive(Default)]
    struct FakePublisher {
        outcomes: VecDeque<Result<(), RelayTransportError>>,
        messages: Vec<RelayClientMessage>,
    }

    #[derive(Default)]
    struct ScriptedSocket {
        events: VecDeque<crate::relay::SocketEvent>,
        sent: Vec<String>,
    }

    impl RelaySocket for ScriptedSocket {
        fn send_text(&mut self, text: &str) -> Result<(), RelayTransportError> {
            self.sent.push(text.to_owned());
            Ok(())
        }

        fn receive(
            &mut self,
            _timeout: Duration,
        ) -> Result<crate::relay::SocketEvent, RelayTransportError> {
            self.events
                .pop_front()
                .ok_or(RelayTransportError::ReceiveTimeout)
        }

        fn close(&mut self, _code: u16, _reason: &str) {}
    }

    impl MlsPublisher for FakePublisher {
        fn publish(&mut self, message: &RelayClientMessage) -> Result<(), RelayTransportError> {
            self.messages.push(message.clone());
            self.outcomes.pop_front().unwrap_or(Ok(()))
        }
    }

    #[derive(Default)]
    struct FakeAuthority {
        published: Vec<String>,
        cleared: Vec<String>,
        retired: Vec<String>,
        fail_next_publish_cleanup: bool,
    }

    impl OutboxAuthority for FakeAuthority {
        fn publish_succeeded(
            &mut self,
            _room_id: &str,
            message_id: &str,
        ) -> Result<(), MlsClientError> {
            if self.fail_next_publish_cleanup {
                self.fail_next_publish_cleanup = false;
                return Err(MlsClientError::StorageUnavailable);
            }
            self.published.push(message_id.to_owned());
            Ok(())
        }

        fn clear_stale_commit(
            &mut self,
            _room_id: &str,
            message_id: &str,
        ) -> Result<(), MlsClientError> {
            self.cleared.push(message_id.to_owned());
            Ok(())
        }

        fn retire_expired_application(
            &mut self,
            _room_id: &str,
            message_id: &str,
        ) -> Result<(), MlsClientError> {
            self.retired.push(message_id.to_owned());
            Ok(())
        }
    }

    fn route() -> OutboxRoute {
        OutboxRoute {
            team_id: "team-1".into(),
            room_id: "room-1".into(),
            created_at: "2026-07-18T12:34:56.000Z".into(),
        }
    }

    fn application_item(id: &str) -> OutboxItem {
        let authenticated_data = ApplicationAuthenticatedData {
            version: 1,
            epoch: 4,
            message_id: id.into(),
            team_id: "team-1".into(),
            room_id: "room-1".into(),
            kind: "chat.message".into(),
            sender_user_id: "github:42".into(),
            sender_device_id: "device_1".into(),
            created_at: "2026-07-18T12:00:00.000Z".into(),
        };
        OutboxItem {
            id: id.into(),
            room_id: "room-1".into(),
            epoch: 4,
            kind: "application".into(),
            payload: vec![1, 2, 3],
            metadata: Some(
                serde_json::to_vec(&OutboxMetadata::Application {
                    authenticated_data: serde_json::to_vec(&authenticated_data).unwrap(),
                })
                .unwrap(),
            ),
        }
    }

    fn commit_item(id: &str) -> OutboxItem {
        OutboxItem {
            id: id.into(),
            room_id: "room-1".into(),
            epoch: 5,
            kind: "add".into(),
            payload: vec![4, 5, 6],
            metadata: Some(
                serde_json::to_vec(&OutboxMetadata::Commit { parent_epoch: 4 }).unwrap(),
            ),
        }
    }

    #[test]
    fn storage_key_is_identity_bound_stable_and_never_regenerated_over_state() {
        let store = MemoryCredentialStore::default();
        let first = load_or_create_storage_key(&store, "github:42", "device_1", false).unwrap();
        let second = load_or_create_storage_key(&store, "github:42", "device_1", true).unwrap();
        assert_eq!(first, second);
        assert_eq!(
            load_or_create_storage_key(&store, "github:99", "device_2", true),
            Err(MlsClientError::IdentityScopeMismatch)
        );

        store.values.borrow_mut().remove(MLS_STORAGE_KEY_ACCOUNT);
        assert_eq!(
            load_or_create_storage_key(&store, "github:42", "device_1", true),
            Err(MlsClientError::RequiresRejoin)
        );
        assert!(!store.values.borrow().contains_key(MLS_STORAGE_KEY_ACCOUNT));
    }

    #[test]
    fn storage_key_write_failure_does_not_claim_success_or_leave_a_value() {
        let store = MemoryCredentialStore::default();
        *store.fail_set_account.borrow_mut() = Some(MLS_STORAGE_KEY_ACCOUNT.into());
        assert_eq!(
            load_or_create_storage_key(&store, "github:42", "device_1", false),
            Err(MlsClientError::StorageUnavailable)
        );
        assert!(!store.values.borrow().contains_key(MLS_STORAGE_KEY_ACCOUNT));
    }

    #[test]
    fn malformed_wrong_length_and_noncanonical_keys_require_explicit_recovery() {
        let store = MemoryCredentialStore::default();
        for wrapping_key in ["%%%".to_owned(), STANDARD.encode([7; 31]), "YQ".to_owned()] {
            store.values.borrow_mut().insert(
                MLS_STORAGE_KEY_ACCOUNT.into(),
                serde_json::to_string(&StoredMlsStorageKey {
                    version: 1,
                    github_user_id: "github:42".into(),
                    device_id: "device_1".into(),
                    wrapping_key: SecretString::new(wrapping_key),
                })
                .unwrap(),
            );
            assert_eq!(
                load_or_create_storage_key(&store, "github:42", "device_1", true),
                Err(MlsClientError::RequiresRejoin)
            );
        }
        store.values.borrow_mut().insert(
            MLS_STORAGE_KEY_ACCOUNT.into(),
            serde_json::to_string(&StoredMlsStorageKey {
                version: 2,
                github_user_id: "github:42".into(),
                device_id: "device_1".into(),
                wrapping_key: SecretString::new(STANDARD.encode([7; 32])),
            })
            .unwrap(),
        );
        assert_eq!(
            load_or_create_storage_key(&store, "github:42", "device_1", true),
            Err(MlsClientError::RequiresRejoin)
        );
    }

    #[test]
    fn truncated_state_is_not_overwritten_or_deleted_when_the_key_is_missing() {
        let directory = TestDirectory::new();
        let path = directory.database();
        let truncated = b"partial-sqlcipher-state";
        fs::write(&path, truncated).unwrap();
        let store = MemoryCredentialStore::default();
        let identity = load_or_create_identity(&store, "github:42", "Maddie").unwrap();

        assert!(matches!(
            MlsClientService::open(&store, &identity, &path),
            Err(MlsClientError::RequiresRejoin)
        ));
        assert_eq!(fs::read(&path).unwrap(), truncated);
        assert!(!store.values.borrow().contains_key(MLS_STORAGE_KEY_ACCOUNT));
    }

    #[test]
    fn persistent_state_reopens_for_the_same_identity_and_rejects_cross_identity() {
        let directory = TestDirectory::new();
        let path = directory.database();
        let store = MemoryCredentialStore::default();
        let identity = load_or_create_identity(&store, "github:42", "Maddie").unwrap();
        let mut first = MlsClientService::open(&store, &identity, &path).unwrap();
        first.engine.create_group("room-1").unwrap();
        drop(first);

        let same_identity = load_or_create_identity(&store, "github:42", "Maddie").unwrap();
        let mut reopened = MlsClientService::open(&store, &same_identity, &path).unwrap();
        assert_eq!(reopened.open_group("room-1"), Ok(0));
        drop(reopened);

        let other_identity_store = MemoryCredentialStore::default();
        let other = load_or_create_identity(&other_identity_store, "github:99", "Other").unwrap();
        assert!(matches!(
            MlsClientService::open(&store, &other, &path),
            Err(MlsClientError::IdentityScopeMismatch)
        ));
    }

    #[test]
    fn idempotent_group_creation_reopens_the_same_durable_epoch_zero_state() {
        let directory = TestDirectory::new();
        let path = directory.database();
        let store = MemoryCredentialStore::default();
        let identity = load_or_create_identity(&store, "github:42", "Maddie").unwrap();
        let mut first = MlsClientService::open(&store, &identity, &path).unwrap();
        assert_eq!(first.create_group_idempotent("room-create"), Ok(0));
        assert_eq!(first.create_group_idempotent("room-create"), Ok(0));
        drop(first);

        let same_identity = load_or_create_identity(&store, "github:42", "Maddie").unwrap();
        let mut restarted = MlsClientService::open(&store, &same_identity, &path).unwrap();
        assert_eq!(restarted.create_group_idempotent("room-create"), Ok(0));
        assert_eq!(restarted.open_group("room-create"), Ok(0));
    }

    #[test]
    fn wrong_stored_key_does_not_modify_existing_state() {
        let directory = TestDirectory::new();
        let path = directory.database();
        let store = MemoryCredentialStore::default();
        let identity = load_or_create_identity(&store, "github:42", "Maddie").unwrap();
        let mut service = MlsClientService::open(&store, &identity, &path).unwrap();
        service.engine.create_group("room-1").unwrap();
        drop(service);
        let before = fs::read(&path).unwrap();

        let mut stored: StoredMlsStorageKey =
            serde_json::from_str(store.values.borrow().get(MLS_STORAGE_KEY_ACCOUNT).unwrap())
                .unwrap();
        stored.wrapping_key = SecretString::new(STANDARD.encode([99; 32]));
        store.values.borrow_mut().insert(
            MLS_STORAGE_KEY_ACCOUNT.into(),
            serde_json::to_string(&stored).unwrap(),
        );
        let same_identity = load_or_create_identity(&store, "github:42", "Maddie").unwrap();
        assert!(matches!(
            MlsClientService::open(&store, &same_identity, &path),
            Err(MlsClientError::RequiresRejoin)
        ));
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn outbox_survives_restart_and_is_removed_only_after_exact_ack_cleanup() {
        let directory = TestDirectory::new();
        let path = directory.database();
        let store = MemoryCredentialStore::default();
        let identity = load_or_create_identity(&store, "github:42", "Maddie").unwrap();
        let user_id = identity.public.user_id.clone();
        let device_id = identity.public.device_id.clone();
        let mut first = MlsClientService::open(&store, &identity, &path).unwrap();
        first.engine.create_group("room-1").unwrap();
        first
            .engine
            .encrypt_application(
                "room-1",
                "message-1",
                b"encrypted after persistence",
                ApplicationAuthenticatedDataInput {
                    version: 1,
                    message_id: "message-1".into(),
                    team_id: "team-1".into(),
                    room_id: "room-1".into(),
                    kind: "chat.message".into(),
                    sender_user_id: user_id,
                    sender_device_id: device_id,
                    created_at: "2026-07-18T12:00:00.000Z".into(),
                },
            )
            .unwrap();
        assert_eq!(first.pending_outbox_room_ids().unwrap(), ["room-1"]);
        drop(first);

        let same_identity = load_or_create_identity(&store, "github:42", "Maddie").unwrap();
        let mut reopened = MlsClientService::open(&store, &same_identity, &path).unwrap();
        reopened.open_group("room-1").unwrap();
        let mut offline = FakePublisher {
            outcomes: [Err(RelayTransportError::ConnectionClosed)].into(),
            ..FakePublisher::default()
        };
        assert!(matches!(
            reopened.drain_room_outbox(&route(), &mut offline),
            Err(MlsClientError::Relay(RelayTransportError::ConnectionClosed))
        ));
        assert_eq!(reopened.pending_outbox_room_ids().unwrap(), ["room-1"]);

        let mut online = FakePublisher::default();
        assert_eq!(
            reopened.drain_room_outbox(&route(), &mut online).unwrap(),
            DrainReport {
                published: vec!["message-1".into()],
                expired_applications: vec![]
            }
        );
        assert!(reopened.pending_outbox_room_ids().unwrap().is_empty());
        assert_eq!(offline.messages, online.messages);
    }

    #[test]
    fn ack_before_cleanup_failure_never_reports_success_and_replay_is_idempotent() {
        let item = application_item("message-1");
        let mut authority = FakeAuthority {
            fail_next_publish_cleanup: true,
            ..FakeAuthority::default()
        };
        let mut publisher = FakePublisher::default();
        assert_eq!(
            drain_items(
                &mut authority,
                vec![item.clone()],
                &route(),
                "github:42",
                "device_1",
                &mut publisher
            ),
            Err(MlsClientError::StorageUnavailable)
        );
        assert!(authority.published.is_empty());

        let report = drain_items(
            &mut authority,
            vec![item],
            &route(),
            "github:42",
            "device_1",
            &mut publisher,
        )
        .unwrap();
        assert_eq!(report.published, ["message-1"]);
        assert_eq!(authority.published, ["message-1"]);
        assert_eq!(publisher.messages.len(), 2);
        assert_eq!(publisher.messages[0], publisher.messages[1]);
    }

    #[test]
    fn composed_relay_path_ignores_replayed_ack_and_cleans_up_only_exact_id() {
        let socket = ScriptedSocket {
            events: [
                crate::relay::SocketEvent::Text(
                    r#"{"type":"published","messageId":"already-cleaned"}"#.into(),
                ),
                crate::relay::SocketEvent::Text(
                    r#"{"type":"published","messageId":"message-1"}"#.into(),
                ),
            ]
            .into(),
            ..ScriptedSocket::default()
        };
        let mut connection = RelayConnection::new(socket);
        let mut observed = Vec::new();
        let mut authority = FakeAuthority::default();
        let report = {
            let mut handler = |message: &RelayServerMessage| {
                if let RelayServerMessage::Published { message_id } = message {
                    observed.push(message_id.clone());
                }
                Ok(())
            };
            let mut publisher =
                RelayMlsPublisher::new(&mut connection, Duration::from_secs(1), &mut handler);
            drain_items(
                &mut authority,
                vec![application_item("message-1")],
                &route(),
                "github:42",
                "device_1",
                &mut publisher,
            )
            .unwrap()
        };

        assert_eq!(observed, ["already-cleaned", "message-1"]);
        assert_eq!(report.published, ["message-1"]);
        assert_eq!(authority.published, ["message-1"]);
        assert_eq!(connection.into_inner().sent.len(), 1);
    }

    #[test]
    fn stale_commit_requires_rejoin_and_expired_application_is_retired_exactly() {
        let mut authority = FakeAuthority::default();
        let mut stale = FakePublisher {
            outcomes: [Err(RelayTransportError::AckRejected(Some(
                RelayErrorCode::StaleEpoch,
            )))]
            .into(),
            ..FakePublisher::default()
        };
        assert_eq!(
            drain_items(
                &mut authority,
                vec![commit_item("commit-1")],
                &route(),
                "github:42",
                "device_1",
                &mut stale
            ),
            Err(MlsClientError::RequiresRejoin)
        );
        assert_eq!(authority.cleared, ["commit-1"]);

        let mut expired = FakePublisher {
            outcomes: [Err(RelayTransportError::AckRejected(Some(
                RelayErrorCode::ApplicationEpochExpired,
            )))]
            .into(),
            ..FakePublisher::default()
        };
        let report = drain_items(
            &mut authority,
            vec![application_item("application-1")],
            &route(),
            "github:42",
            "device_1",
            &mut expired,
        )
        .unwrap();
        assert_eq!(report.expired_applications, ["application-1"]);
        assert_eq!(authority.retired, ["application-1"]);
    }

    #[test]
    fn application_routing_is_recovered_only_from_authenticated_metadata() {
        let item = application_item("message-1");
        let message = relay_message_for_item(&item, &route(), "github:42", "device_1").unwrap();
        assert_eq!(message.created_at, "2026-07-18T12:00:00.000Z");
        assert_eq!(message.epoch_hint, 4);
        assert_eq!(message.message_type, MlsMessageType::Application);

        let mut wrong_route = route();
        wrong_route.team_id = "team-other".into();
        assert_eq!(
            relay_message_for_item(&item, &wrong_route, "github:42", "device_1"),
            Err(MlsClientError::InvalidOutbox)
        );
        assert_eq!(
            relay_message_for_item(&item, &route(), "github:99", "device_1"),
            Err(MlsClientError::InvalidOutbox)
        );
    }

    #[test]
    fn unsupported_or_corrupt_outbox_records_are_never_published_or_deleted() {
        let mut welcome = commit_item("welcome-1");
        welcome.kind = "welcome".into();
        welcome.metadata = None;
        let mut authority = FakeAuthority::default();
        let mut publisher = FakePublisher::default();
        assert_eq!(
            drain_items(
                &mut authority,
                vec![welcome],
                &route(),
                "github:42",
                "device_1",
                &mut publisher
            ),
            Err(MlsClientError::InvalidOutbox)
        );
        assert!(publisher.messages.is_empty());
        assert!(authority.published.is_empty());
    }

    #[test]
    fn errors_do_not_expose_keys_paths_or_relay_prose() {
        let values = [
            MlsClientError::StorageUnavailable,
            MlsClientError::IdentityScopeMismatch,
            MlsClientError::RequiresRejoin,
            MlsClientError::InvalidOutbox,
            MlsClientError::Relay(RelayTransportError::AckRejected(None)),
        ];
        for error in values {
            let rendered = error.to_string();
            assert!(!rendered.contains("wrapping_key"));
            assert!(!rendered.contains("/private/"));
            assert!(!rendered.contains("attacker-controlled"));
        }
    }

    #[test]
    fn wrapping_key_credential_types_are_zeroizing_and_keep_the_v1_schema() {
        fn assert_zeroize_on_drop<T: ZeroizeOnDrop>() {}
        assert_zeroize_on_drop::<SecretString>();
        assert_zeroize_on_drop::<StoredMlsStorageKey>();
        assert_zeroize_on_drop::<Zeroizing<String>>();

        let mut secret = SecretString::new(STANDARD.encode([7; 32]));
        secret.zeroize();
        assert!(secret.as_str().is_empty());

        let stored = StoredMlsStorageKey {
            version: 1,
            github_user_id: "github:42".into(),
            device_id: "device_1".into(),
            wrapping_key: SecretString::new(STANDARD.encode([8; 32])),
        };
        let serialized = Zeroizing::new(serde_json::to_string(&stored).unwrap());
        let expected_key = Zeroizing::new(STANDARD.encode([8; 32]));
        let expected = Zeroizing::new(format!(
            "{{\"version\":1,\"githubUserId\":\"github:42\",\"deviceId\":\"device_1\",\"wrappingKey\":\"{}\"}}",
            expected_key.as_str()
        ));
        assert_eq!(serialized.as_str(), expected.as_str());
    }

    #[test]
    fn minimally_encoded_p256_scalars_are_normalized_without_retry_or_entropy_loss() {
        let scalar = [9; 31];
        let normalized = normalize_generated_storage_key(&scalar).unwrap();
        assert_eq!(normalized[0], 0);
        assert_eq!(&normalized[1..], scalar.as_slice());
        assert_eq!(
            normalize_generated_storage_key(&[7; 32]).unwrap().as_ref(),
            &[7; 32]
        );
        assert_eq!(
            normalize_generated_storage_key(&[]),
            Err(MlsClientError::StorageUnavailable)
        );
        assert_eq!(
            normalize_generated_storage_key(&[1; 33]),
            Err(MlsClientError::StorageUnavailable)
        );
    }
}
