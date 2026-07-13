use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use mls_core::{
    generate_device_signing_secret, generate_hpke_key_pair, issue_capability, mac_binding,
    mac_response_binding, open, seal, validate_credential, validate_key_package_upload,
    verify_binding, ApplicationAuthenticatedDataInput, BasicAppCredential, CapabilityBinding,
    DeviceAuthSigner, EncryptedStore, ExporterCiphertext, HostTransferAuthorizationPayload,
    HpkeKeyPair, JoinAdmissionMetadata, KeyPackageUpload, MlsEngine, OutboxMetadata, SealedPayload,
    WelcomeRetryMetadata,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, sync::Mutex};
use tauri::Manager;

const MAX_B64_MESSAGE: usize = 2 * 1024 * 1024;

#[derive(Default)]
pub(crate) struct MlsNativeState {
    engine: Mutex<Option<MlsEngine>>,
    signer: Mutex<Option<DeviceAuthSigner>>,
    hpke: Mutex<Option<HpkeKeyPair>>,
    store: Mutex<Option<EncryptedStore>>,
    identity: Mutex<Option<(String, String, IdentityPublic)>>,
    invite_approval: Mutex<()>,
    requires_rejoin_rooms: Mutex<HashSet<String>>,
}

const MLS_KEYCHAIN_SERVICE: &str = "com.multaiplayer.desktop.room-secrets";
const MLS_IDENTITY_ACCOUNT: &str = "mls-identity:v1";
const MLS_HPKE_ACCOUNT: &str = "mls-hpke:v1";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredMlsIdentity {
    version: u8,
    github_user_id: String,
    device_id: String,
    signing_secret: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct IdentityInitializeRequest {
    github_user_id: String,
    device_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IdentityPublic {
    github_user_id: String,
    device_id: String,
    ciphersuite: u16,
    signature_public_key: String,
    signature_key_fingerprint: String,
    hpke_public_key: String,
    hpke_key_fingerprint: String,
    requires_rejoin: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeyPackagePublish {
    id: String,
    key_package: String,
    key_package_hash: String,
    ciphersuite: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RosterPublic {
    roster: Vec<RosterEntry>,
    self_leaf: u32,
    epoch: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RosterEntry {
    leaf: u32,
    github_user_id: String,
    device_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapabilityIssueResponse {
    capability_handle: String,
    capability_url_value: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InviteRequestSealRequest {
    recipient_hpke_public_key: String,
    capability_handle: String,
    capability_url_value: String,
    binding: CapabilityBinding,
    key_package: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InviteRequestSealResponse {
    key_package_hash: String,
    sealed_payload: SealedPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InviteRequestOpenRequest {
    binding: CapabilityBinding,
    sealed_payload: SealedPayload,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InviteRequestPayload {
    capability_handle: String,
    binding: CapabilityBinding,
    key_package: String,
    mac: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InviteRequestOpenResponse {
    capability_handle: String,
    binding: CapabilityBinding,
    key_package: String,
    mac: String,
    requester_signature_public_key: String,
    requester_signature_key_fingerprint: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InviteApproveRequest {
    capability_handle: String,
    binding: CapabilityBinding,
    mac: String,
    key_package: String,
    key_package_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InviteDenyRequest {
    capability_handle: String,
    binding: CapabilityBinding,
    mac: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InviteDenyResponse {
    outbox_id: String,
    response_binding: CapabilityBinding,
    response_mac: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InviteResponseAcceptRequest {
    capability_url_value: String,
    original_binding: CapabilityBinding,
    response_binding: CapabilityBinding,
    response_mac: String,
    welcome: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InviteResponseAcceptResponse {
    status: String,
    epoch: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingJoinAdmissionPublic {
    invite_id: String,
    team_id: String,
    room_id: String,
    request_id: String,
    requester_user_id: String,
    requester_device_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct JoinAdmissionCompleteRequest {
    room_id: String,
    request_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InviteApproveResponse {
    epoch: u64,
    commit_outbox_id: String,
    welcome_outbox_id: String,
    response_binding: CapabilityBinding,
    response_mac: String,
    requester_signature_public_key: String,
    requester_signature_key_fingerprint: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BlobEncryptRequest {
    room_id: String,
    blob_id: String,
    plaintext: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BlobPrepareRequest {
    room_id: String,
    blob_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BlobDecryptRequest {
    room_id: String,
    blob_id: String,
    value: ExporterCiphertext,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistorySaveRequest {
    room_id: String,
    plaintext: String,
    retention_days: u16,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistoryRetentionRequest {
    room_id: String,
    retention_days: u16,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistoryEpochRequest {
    room_id: String,
    epoch: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeviceAuthRequest {
    challenge: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceAuthResponse {
    signature_der: String,
    public_key_spki_der: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RoomRequest {
    room_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PublishSucceededRequest {
    room_id: String,
    message_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClearPendingRequest {
    room_id: String,
    expected_message_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutboxPublic {
    id: String,
    room_id: String,
    epoch: u64,
    kind: String,
    payload: String,
    metadata: Option<OutboxMetadata>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct JoinRequest {
    room_id: String,
    welcome: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EncryptRequest {
    room_id: String,
    message_id: String,
    payload: String,
    authenticated_data: ApplicationAuthenticatedDataInput,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct IncomingRequest {
    room_id: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IncomingApplication {
    sender_leaf: u32,
    epoch: u64,
    authenticated_data: String,
    payload: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutboundApplicationResponse {
    message: String,
    outbox_id: String,
    epoch: u64,
    authenticated_data: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutboundCommitResponse {
    message: String,
    outbox_id: String,
    parent_epoch: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoveRequest {
    room_id: String,
    leaf: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TransferRequest {
    room_id: String,
    next_host_leaf: u32,
    next_host_device_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HostTransferAuthorizationRequest {
    room_id: String,
    commit_message_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostTransferAuthorizationResponse {
    authorization: HostTransferAuthorizationPayload,
    signature_der: String,
    public_key_spki_der: String,
}

#[tauri::command]
pub(crate) fn mls_identity_initialize(
    request: IdentityInitializeRequest,
    state: tauri::State<'_, MlsNativeState>,
    app: tauri::AppHandle,
) -> Result<IdentityPublic, String> {
    let mut identity_lock = state
        .identity
        .lock()
        .map_err(|_| "MLS identity state is unavailable".to_string())?;
    if let Some((user, device, public)) = identity_lock.as_ref() {
        if user == &request.github_user_id && device == &request.device_id {
            return Ok(public.clone());
        }
        return Err("MLS identity is already initialized for another device".into());
    }
    let identity = BasicAppCredential {
        github_user_id: request.github_user_id.clone(),
        device_id: request.device_id.clone(),
    };
    validate_credential(
        &serde_json::to_vec(&identity).map_err(|_| "MLS identity is invalid".to_string())?,
    )
    .map_err(safe_error)?;
    let secret = load_or_create_signing_secret(&request.github_user_id, &request.device_id)?;
    let wrapping_key = load_or_create_store_wrapping_key()?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Failed to resolve MLS data directory".to_string())?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|_| "Failed to create MLS data directory".to_string())?;
    let database_path = data_dir.join("mls-v2.db");
    let mut requires_rejoin = false;
    let engine =
        match MlsEngine::open_persistent(identity, secret.clone(), &database_path, wrapping_key) {
            Ok(engine) => engine,
            Err(error)
                if database_path.exists()
                    && should_quarantine_store(&database_path, wrapping_key) =>
            {
                quarantine_store(&database_path)?;
                requires_rejoin = true;
                MlsEngine::open_persistent(
                    BasicAppCredential {
                        github_user_id: request.github_user_id.clone(),
                        device_id: request.device_id.clone(),
                    },
                    secret.clone(),
                    &database_path,
                    wrapping_key,
                )
                .map_err(|_| safe_error(error))?
            }
            Err(error) => return Err(safe_error(error)),
        };
    let store = EncryptedStore::open(&database_path, wrapping_key).map_err(safe_error)?;
    secure_store_permissions(&database_path)?;
    let signer = DeviceAuthSigner::from_secret(
        secret,
        request.github_user_id.clone(),
        request.device_id.clone(),
    )
    .map_err(safe_error)?;
    let signature_public_key = STANDARD.encode(signer.public_key_spki_der().map_err(safe_error)?);
    let hpke = load_or_create_hpke_key_pair()?;
    let hpke_public_key = STANDARD.encode(hpke.public_key_bytes());
    let signature_key_fingerprint = fingerprint(
        &STANDARD
            .decode(&signature_public_key)
            .map_err(|_| "MLS identity encoding failed".to_string())?,
    );
    let hpke_key_fingerprint = fingerprint(hpke.public_key_bytes());
    *state
        .engine
        .lock()
        .map_err(|_| "MLS state is unavailable".to_string())? = Some(engine);
    *state
        .signer
        .lock()
        .map_err(|_| "MLS signer is unavailable".to_string())? = Some(signer);
    *state
        .hpke
        .lock()
        .map_err(|_| "MLS HPKE state is unavailable".to_string())? = Some(hpke);
    *state
        .store
        .lock()
        .map_err(|_| "MLS store is unavailable".to_string())? = Some(store);
    let public = IdentityPublic {
        github_user_id: request.github_user_id.clone(),
        device_id: request.device_id.clone(),
        ciphersuite: 2,
        signature_public_key,
        signature_key_fingerprint,
        hpke_public_key,
        hpke_key_fingerprint,
        requires_rejoin,
    };
    *identity_lock = Some((request.github_user_id, request.device_id, public.clone()));
    Ok(public)
}

#[tauri::command]
pub(crate) fn mls_group_state(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<RosterPublic, String> {
    with_engine(&state, |engine| {
        let roster = engine.roster(&request.room_id)?;
        let self_leaf = engine.self_leaf(&request.room_id)?;
        let epoch = engine.current_epoch(&request.room_id)?;
        Ok(RosterPublic {
            roster: roster
                .into_iter()
                .map(|m| RosterEntry {
                    leaf: m.leaf,
                    github_user_id: m.credential.github_user_id,
                    device_id: m.credential.device_id,
                })
                .collect(),
            self_leaf,
            epoch,
        })
    })
}

#[tauri::command]
pub(crate) fn mls_invite_capability_issue() -> Result<CapabilityIssueResponse, String> {
    let mut issued = issue_capability();
    let raw = issued.take_url_value();
    let handle = uuid::Uuid::new_v4().to_string();
    let entry = keyring::Entry::new(
        MLS_KEYCHAIN_SERVICE,
        &format!("mls-invite-capability:{handle}"),
    )
    .map_err(|_| "Failed to open invite verifier".to_string())?;
    entry
        .set_password(&STANDARD.encode(issued.verifier()))
        .map_err(|_| "Failed to persist invite verifier".to_string())?;
    Ok(CapabilityIssueResponse {
        capability_handle: handle,
        capability_url_value: URL_SAFE_NO_PAD.encode(raw),
    })
}

#[tauri::command]
pub(crate) fn mls_invite_request_seal(
    request: InviteRequestSealRequest,
) -> Result<InviteRequestSealResponse, String> {
    if request.binding.phase != "request" {
        return Err("Invite request binding is invalid".into());
    }
    let key_package = decode(&request.key_package)?;
    let key_package_hash = format!("sha256:{:x}", Sha256::digest(&key_package));
    if request.binding.key_package_hash != key_package_hash {
        return Err("Invite KeyPackage binding is invalid".into());
    }
    validate_key_package_upload(&KeyPackageUpload {
        key_package: request.key_package.clone(),
        uploader_github_user_id: request.binding.requester_user_id.clone(),
        uploader_device_id: request.binding.requester_device_id.clone(),
    })
    .map_err(safe_error)?;
    let capability = fixed32_url(&request.capability_url_value)?;
    if !valid_capability_handle(&request.capability_handle) {
        return Err("Invite capability handle is invalid".into());
    }
    let payload = InviteRequestPayload {
        capability_handle: request.capability_handle,
        mac: STANDARD.encode(mac_binding(&capability, &request.binding).map_err(safe_error)?),
        binding: request.binding,
        key_package: request.key_package,
    };
    let aad = serde_json::to_vec(&payload.binding)
        .map_err(|_| "Invite request binding is invalid".to_string())?;
    let sealed_payload = seal(
        &decode(&request.recipient_hpke_public_key)?,
        b"multaiplayer:invite-request:v2",
        &aad,
        &serde_json::to_vec(&payload)
            .map_err(|_| "Invite request payload is invalid".to_string())?,
    )
    .map_err(safe_error)?;
    Ok(InviteRequestSealResponse {
        key_package_hash,
        sealed_payload,
    })
}

#[tauri::command]
pub(crate) fn mls_invite_request_open(
    request: InviteRequestOpenRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<InviteRequestOpenResponse, String> {
    let aad = serde_json::to_vec(&request.binding)
        .map_err(|_| "Invite request binding is invalid".to_string())?;
    let hpke = state
        .hpke
        .lock()
        .map_err(|_| "MLS HPKE state is unavailable".to_string())?;
    let plaintext = open(
        hpke.as_ref()
            .ok_or_else(|| "MLS identity is not initialized".to_string())?,
        b"multaiplayer:invite-request:v2",
        &aad,
        &request.sealed_payload,
    )
    .map_err(safe_error)?;
    let payload: InviteRequestPayload = serde_json::from_slice(&plaintext)
        .map_err(|_| "Invite request payload is invalid".to_string())?;
    if payload.binding != request.binding {
        return Err("Invite request context mismatch".into());
    }
    if !valid_capability_handle(&payload.capability_handle) {
        return Err("Invite capability handle is invalid".into());
    }
    let key_package = decode(&payload.key_package)?;
    if format!("sha256:{:x}", Sha256::digest(&key_package)) != payload.binding.key_package_hash {
        return Err("Invite KeyPackage binding is invalid".into());
    }
    let validated = validate_key_package_upload(&KeyPackageUpload {
        key_package: payload.key_package.clone(),
        uploader_github_user_id: payload.binding.requester_user_id.clone(),
        uploader_device_id: payload.binding.requester_device_id.clone(),
    })
    .map_err(safe_error)?;
    Ok(InviteRequestOpenResponse {
        capability_handle: payload.capability_handle,
        binding: payload.binding,
        key_package: payload.key_package,
        mac: payload.mac,
        requester_signature_public_key: validated.signature_public_key,
        requester_signature_key_fingerprint: validated.signature_key_fingerprint,
    })
}
#[tauri::command]
pub(crate) fn mls_invite_approve(
    request: InviteApproveRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<InviteApproveResponse, String> {
    let _approval = state
        .invite_approval
        .lock()
        .map_err(|_| "Invite approval is unavailable".to_string())?;
    if !valid_capability_handle(&request.capability_handle) || request.binding.phase != "request" {
        return Err("Invite approval is invalid".into());
    }
    if request.key_package_id.is_empty()
        || request.key_package_id.len() > 256
        || request.key_package_id.chars().any(char::is_control)
    {
        return Err("Invite KeyPackage id is invalid".into());
    }
    let key_package = decode(&request.key_package)?;
    let hash = format!("sha256:{:x}", Sha256::digest(&key_package));
    if hash != request.binding.key_package_hash {
        return Err("Invite KeyPackage binding is invalid".into());
    }
    let validated = validate_key_package_upload(&KeyPackageUpload {
        key_package: request.key_package.clone(),
        uploader_github_user_id: request.binding.requester_user_id.clone(),
        uploader_device_id: request.binding.requester_device_id.clone(),
    })
    .map_err(safe_error)?;
    let binding_hash = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&request.binding)
                .map_err(|_| "Invite binding is invalid".to_string())?
        )
    );
    let entry = keyring::Entry::new(
        MLS_KEYCHAIN_SERVICE,
        &format!("mls-invite-capability:{}", request.capability_handle),
    )
    .map_err(|_| "Failed to open invite verifier".to_string())?;
    if let Some(receipt) = with_engine(&state, |engine| {
        engine.invite_receipt(&request.capability_handle)
    })? {
        if receipt.binding_hash != binding_hash || receipt.key_package_hash != hash {
            return Err("Invite capability was already consumed for another request".into());
        }
        let commit_still_pending = with_store(&state, |store| store.pending_outbox())?
            .iter()
            .any(|item| item.id == receipt.commit_outbox_id);
        if !commit_still_pending {
            let _ = entry.delete_credential();
        }
        return Ok(InviteApproveResponse {
            epoch: receipt.epoch,
            commit_outbox_id: receipt.commit_outbox_id,
            welcome_outbox_id: receipt.welcome_outbox_id,
            response_binding: receipt.response_binding,
            response_mac: receipt.response_mac,
            requester_signature_public_key: validated.signature_public_key,
            requester_signature_key_fingerprint: validated.signature_key_fingerprint,
        });
    }
    let verifier = fixed32(
        &entry
            .get_password()
            .map_err(|_| "Invite capability is unavailable".to_string())?,
    )?;
    let mac = fixed32(&request.mac)?;
    verify_binding(&verifier, &request.binding, &mac).map_err(safe_error)?;
    let mut response_binding = request.binding.clone();
    response_binding.phase = "response".into();
    response_binding.status = Some("approved".into());
    response_binding.decided_at = Some(decision_timestamp());
    let response_mac =
        STANDARD.encode(mac_response_binding(&verifier, &response_binding).map_err(safe_error)?);
    let welcome_metadata = WelcomeRetryMetadata {
        invite_id: request.binding.invite_id.clone(),
        request_id: request.binding.request_id.clone(),
        requester_user_id: request.binding.requester_user_id.clone(),
        requester_device_id: request.binding.requester_device_id.clone(),
        key_package_id: request.key_package_id,
        key_package_hash: request.binding.key_package_hash.clone(),
        response_binding,
        response_mac,
    };
    let approved_binding = welcome_metadata.response_binding.clone();
    let approved_mac = welcome_metadata.response_mac.clone();
    let output = with_engine(&state, |engine| {
        engine.add_member_for_invite(
            &request.binding.room_id,
            &key_package,
            welcome_metadata,
            request.capability_handle.clone(),
            binding_hash,
        )
    })?;
    Ok(InviteApproveResponse {
        epoch: output.epoch,
        commit_outbox_id: output.commit_outbox_id,
        welcome_outbox_id: output.welcome_outbox_id,
        response_binding: approved_binding,
        response_mac: approved_mac,
        requester_signature_public_key: validated.signature_public_key,
        requester_signature_key_fingerprint: validated.signature_key_fingerprint,
    })
}

#[tauri::command]
pub(crate) fn mls_invite_deny(
    request: InviteDenyRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<InviteDenyResponse, String> {
    let _approval = state
        .invite_approval
        .lock()
        .map_err(|_| "Invite approval is unavailable".to_string())?;
    if !valid_capability_handle(&request.capability_handle) || request.binding.phase != "request" {
        return Err("Invite denial is invalid".into());
    }
    let binding_hash = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&request.binding)
                .map_err(|_| "Invite binding is invalid".to_string())?
        )
    );
    let entry = keyring::Entry::new(
        MLS_KEYCHAIN_SERVICE,
        &format!("mls-invite-capability:{}", request.capability_handle),
    )
    .map_err(|_| "Failed to open invite verifier".to_string())?;
    if let Some((receipt, response_binding, response_mac)) = with_engine(&state, |engine| {
        engine.denied_invite_response(&request.capability_handle)
    })? {
        if receipt.binding_hash != binding_hash
            || receipt.key_package_hash != request.binding.key_package_hash
        {
            return Err("Invite capability was already consumed for another request".into());
        }
        let _ = entry.delete_credential();
        return Ok(InviteDenyResponse {
            outbox_id: receipt.response_outbox_id,
            response_binding,
            response_mac,
        });
    }
    let verifier = fixed32(
        &entry
            .get_password()
            .map_err(|_| "Invite capability is unavailable".to_string())?,
    )?;
    verify_binding(&verifier, &request.binding, &fixed32(&request.mac)?).map_err(safe_error)?;
    let mut response_binding = request.binding;
    response_binding.phase = "response".into();
    response_binding.status = Some("denied".into());
    response_binding.decided_at = Some(decision_timestamp());
    let response_mac =
        STANDARD.encode(mac_response_binding(&verifier, &response_binding).map_err(safe_error)?);
    let outbox_id = with_engine(&state, |engine| {
        engine.deny_invite(
            request.capability_handle,
            binding_hash,
            response_binding.key_package_hash.clone(),
            response_binding.clone(),
            response_mac.clone(),
        )
    })?;
    entry
        .delete_credential()
        .map_err(|_| "Invite denied but verifier cleanup failed".to_string())?;
    Ok(InviteDenyResponse {
        outbox_id,
        response_binding,
        response_mac,
    })
}

#[tauri::command]
pub(crate) fn mls_invite_response_accept(
    request: InviteResponseAcceptRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<InviteResponseAcceptResponse, String> {
    let raw = fixed32_url(&request.capability_url_value)?;
    validate_invite_response_pair(&request.original_binding, &request.response_binding)?;
    verify_binding(
        &derive_capability_verifier(&raw),
        &request.response_binding,
        &fixed32(&request.response_mac)?,
    )
    .map_err(safe_error)?;
    let status = request
        .response_binding
        .status
        .as_deref()
        .ok_or_else(|| "Invite response is invalid".to_string())?;
    let epoch = match status {
        "approved" => {
            let welcome = decode(
                request
                    .welcome
                    .as_deref()
                    .ok_or_else(|| "Approved invite response has no Welcome".to_string())?,
            )?;
            let response_hash = format!(
                "{:x}",
                Sha256::digest(
                    serde_json::to_vec(&(
                        &request.original_binding,
                        &request.response_binding,
                        &request.response_mac,
                        &welcome,
                    ))
                    .map_err(|_| "Invite response is invalid".to_string())?
                )
            );
            Some(with_engine(&state, |engine| {
                engine.join_welcome_for_invite(
                    &welcome,
                    JoinAdmissionMetadata {
                        invite_id: request.original_binding.invite_id.clone(),
                        team_id: request.original_binding.team_id.clone(),
                        room_id: request.original_binding.room_id.clone(),
                        request_id: request.original_binding.request_id.clone(),
                        requester_user_id: request.original_binding.requester_user_id.clone(),
                        requester_device_id: request.original_binding.requester_device_id.clone(),
                    },
                    response_hash,
                )
            })?)
        }
        "denied" if request.welcome.is_none() => None,
        _ => return Err("Invite response is invalid".into()),
    };
    Ok(InviteResponseAcceptResponse {
        status: status.to_owned(),
        epoch,
    })
}

#[tauri::command]
pub(crate) fn mls_join_admissions_list(
    state: tauri::State<'_, MlsNativeState>,
) -> Result<Vec<PendingJoinAdmissionPublic>, String> {
    with_engine(&state, |engine| engine.pending_join_admissions()).map(|receipts| {
        receipts
            .into_iter()
            .map(|receipt| PendingJoinAdmissionPublic {
                invite_id: receipt.invite_id,
                team_id: receipt.team_id,
                room_id: receipt.room_id,
                request_id: receipt.request_id,
                requester_user_id: receipt.requester_user_id,
                requester_device_id: receipt.requester_device_id,
            })
            .collect()
    })
}

#[tauri::command]
pub(crate) fn mls_join_admission_complete(
    request: JoinAdmissionCompleteRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<(), String> {
    with_engine(&state, |engine| {
        engine.complete_join_admission(&request.room_id, &request.request_id)
    })
}

#[tauri::command]
pub(crate) fn mls_blob_encrypt(
    request: BlobEncryptRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<ExporterCiphertext, String> {
    let plaintext = decode(&request.plaintext)?;
    with_engine(&state, |engine| {
        engine.encrypt_blob(&request.room_id, request.blob_id.as_bytes(), &plaintext)
    })
}
#[tauri::command]
pub(crate) fn mls_blob_prepare(
    request: BlobPrepareRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<u64, String> {
    with_engine(&state, |engine| {
        engine.prepare_blob(&request.room_id, request.blob_id.as_bytes())
    })
}
#[tauri::command]
pub(crate) fn mls_blob_decrypt(
    request: BlobDecryptRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<String, String> {
    with_engine(&state, |engine| {
        engine.decrypt_blob(&request.room_id, request.blob_id.as_bytes(), &request.value)
    })
    .map(|v| STANDARD.encode(v))
}

#[tauri::command]
pub(crate) fn mls_history_save(
    request: HistorySaveRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<u64, String> {
    let plaintext = decode(&request.plaintext)?;
    let value = with_engine(&state, |engine| {
        engine.encrypt_history(&request.room_id, &plaintext)
    })?;
    let epoch = value.epoch;
    with_engine(&state, |engine| {
        engine.set_history_retention(&request.room_id, request.retention_days)
    })?;
    let encoded =
        serde_json::to_vec(&value).map_err(|_| "Failed to encode encrypted history".to_string())?;
    with_store(&state, |store| {
        store.set_history_ciphertext_retention(&request.room_id, request.retention_days)?;
        store.put_history_ciphertext(&request.room_id, epoch, &encoded, request.retention_days)
    })?;
    Ok(epoch)
}

#[tauri::command]
pub(crate) fn mls_history_retention_set(
    request: HistoryRetentionRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<(), String> {
    with_engine(&state, |engine| {
        engine.set_history_retention(&request.room_id, request.retention_days)
    })?;
    with_store(&state, |store| {
        store.set_history_ciphertext_retention(&request.room_id, request.retention_days)
    })
}

#[tauri::command]
pub(crate) fn mls_history_load(
    request: HistoryEpochRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<Option<String>, String> {
    with_engine(&state, |engine| {
        engine.prune_expired_material(&request.room_id)
    })?;
    let Some(encoded) = with_store(&state, |store| {
        store.history_ciphertext(&request.room_id, request.epoch)
    })?
    else {
        return Ok(None);
    };
    let value: ExporterCiphertext =
        serde_json::from_slice(&encoded).map_err(|_| "Encrypted history is corrupt".to_string())?;
    with_engine(&state, |engine| {
        engine.decrypt_history(&request.room_id, &value)
    })
    .map(|value| Some(STANDARD.encode(value)))
}

#[tauri::command]
pub(crate) fn mls_history_delete(
    request: HistoryEpochRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<(), String> {
    with_engine(&state, |engine| {
        engine.forget_history_epoch(&request.room_id, request.epoch)
    })?;
    with_store(&state, |store| {
        store.delete_history_ciphertext(&request.room_id, request.epoch)
    })
}

#[tauri::command]
pub(crate) fn mls_history_load_latest(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<Option<String>, String> {
    with_engine(&state, |engine| {
        engine.prune_expired_material(&request.room_id)
    })?;
    let Some((_epoch, encoded)) = with_store(&state, |store| {
        store.latest_history_ciphertext(&request.room_id)
    })?
    else {
        return Ok(None);
    };
    let value: ExporterCiphertext =
        serde_json::from_slice(&encoded).map_err(|_| "Encrypted history is corrupt".to_string())?;
    with_engine(&state, |engine| {
        engine.decrypt_history(&request.room_id, &value)
    })
    .map(|value| Some(STANDARD.encode(value)))
}

#[tauri::command]
pub(crate) fn mls_history_delete_all(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<(), String> {
    let engine = state
        .engine
        .lock()
        .map_err(|_| "MLS engine is unavailable".to_string())?;
    let store = state
        .store
        .lock()
        .map_err(|_| "MLS store is unavailable".to_string())?;
    delete_all_history_native(
        engine
            .as_ref()
            .ok_or_else(|| "MLS identity is not initialized".to_string())?,
        store
            .as_ref()
            .ok_or_else(|| "MLS identity is not initialized".to_string())?,
        &request.room_id,
    )
}

fn delete_all_history_native(
    engine: &MlsEngine,
    store: &EncryptedStore,
    room_id: &str,
) -> Result<(), String> {
    // The engine transaction removes both retained epoch secrets and ciphertext rows from the
    // shared SQLCipher KVS. The store deletion is an idempotent defense-in-depth pass for the
    // application-storage abstraction; running it second cannot orphan readable ciphertext.
    engine.forget_history(room_id).map_err(safe_error)?;
    store
        .delete_all_history_ciphertexts(room_id)
        .map_err(safe_error)
}

#[tauri::command]
pub(crate) fn mls_device_auth_sign(
    request: DeviceAuthRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<DeviceAuthResponse, String> {
    let challenge = decode(&request.challenge)?;
    let lock = state
        .signer
        .lock()
        .map_err(|_| "MLS signer is unavailable".to_string())?;
    let output = lock
        .as_ref()
        .ok_or_else(|| "MLS identity is not initialized".to_string())?
        .sign(&challenge)
        .map_err(safe_error)?;
    Ok(DeviceAuthResponse {
        signature_der: STANDARD.encode(output.signature_der),
        public_key_spki_der: STANDARD.encode(output.public_key_spki_der),
    })
}

#[tauri::command]
pub(crate) fn mls_generate_key_package(
    state: tauri::State<'_, MlsNativeState>,
) -> Result<KeyPackagePublish, String> {
    let bytes = with_engine(&state, |engine| engine.generate_key_package())?;
    let id = uuid::Uuid::new_v4().to_string();
    let key_package_hash = format!("sha256:{:x}", Sha256::digest(&bytes));
    Ok(KeyPackagePublish {
        id,
        key_package: STANDARD.encode(bytes),
        key_package_hash,
        ciphersuite: 2,
    })
}

#[tauri::command]
pub(crate) fn mls_create_group(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<u64, String> {
    with_engine(&state, |engine| engine.create_group(&request.room_id))
}

#[tauri::command]
pub(crate) fn mls_join_welcome(
    request: JoinRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<u64, String> {
    let welcome = decode(&request.welcome)?;
    with_engine(&state, |engine| {
        engine.join_welcome(&request.room_id, &welcome)
    })
}

#[tauri::command]
pub(crate) fn mls_encrypt_application(
    request: EncryptRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<OutboundApplicationResponse, String> {
    let payload = decode(&request.payload)?;
    with_engine(&state, |engine| {
        engine.encrypt_application(
            &request.room_id,
            &request.message_id,
            &payload,
            request.authenticated_data,
        )
    })
    .and_then(|output| {
        Ok(OutboundApplicationResponse {
            message: STANDARD.encode(output.message),
            outbox_id: output.outbox_id,
            epoch: output.epoch,
            authenticated_data: String::from_utf8(output.authenticated_data)
                .map_err(|_| "MLS authenticated data encoding failed".to_string())?,
        })
    })
}

#[tauri::command]
pub(crate) fn mls_process_incoming(
    request: IncomingRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<Option<IncomingApplication>, String> {
    let message = decode(&request.message)?;
    let value = with_engine(&state, |engine| {
        engine.process_incoming(&request.room_id, &message)
    })?;
    value
        .map(|output| {
            Ok(IncomingApplication {
                sender_leaf: output.sender_leaf,
                epoch: output.epoch,
                authenticated_data: String::from_utf8(output.authenticated_data)
                    .map_err(|_| "MLS authenticated data is not valid UTF-8".to_string())?,
                payload: STANDARD.encode(output.payload),
            })
        })
        .transpose()
}

#[tauri::command]
pub(crate) fn mls_remove_member(
    request: RemoveRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<OutboundCommitResponse, String> {
    with_engine(&state, |engine| {
        engine.remove_member(&request.room_id, request.leaf)
    })
    .map(|output| OutboundCommitResponse {
        message: STANDARD.encode(output.message),
        outbox_id: output.outbox_id,
        parent_epoch: output.parent_epoch,
    })
}

#[tauri::command]
pub(crate) fn mls_transfer_host(
    request: TransferRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<OutboundCommitResponse, String> {
    with_engine(&state, |engine| {
        engine.transfer_host(
            &request.room_id,
            request.next_host_leaf,
            request.next_host_device_id,
        )
    })
    .map(|output| OutboundCommitResponse {
        message: STANDARD.encode(output.message),
        outbox_id: output.outbox_id,
        parent_epoch: output.parent_epoch,
    })
}

#[tauri::command]
pub(crate) fn mls_host_transfer_authorization(
    request: HostTransferAuthorizationRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<HostTransferAuthorizationResponse, String> {
    let authorization = with_engine(&state, |engine| {
        engine.host_transfer_authorization(&request.room_id, &request.commit_message_id)
    })?;
    let canonical = serde_json::to_vec(&authorization)
        .map_err(|_| "Host transfer authorization is invalid".to_string())?;
    let signer = state
        .signer
        .lock()
        .map_err(|_| "MLS signer is unavailable".to_string())?;
    let signature = signer
        .as_ref()
        .ok_or_else(|| "MLS identity is not initialized".to_string())?
        .sign_host_transfer(&canonical)
        .map_err(safe_error)?;
    Ok(HostTransferAuthorizationResponse {
        authorization,
        signature_der: STANDARD.encode(signature.signature_der),
        public_key_spki_der: STANDARD.encode(signature.public_key_spki_der),
    })
}

#[tauri::command]
pub(crate) fn mls_current_epoch(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<u64, String> {
    with_engine(&state, |engine| engine.current_epoch(&request.room_id))
}

#[tauri::command]
pub(crate) fn mls_group_open(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<u64, String> {
    match with_engine(&state, |engine| engine.open_group(&request.room_id)) {
        Err(error) if error == "MLS_REQUIRES_REJOIN" => {
            state
                .requires_rejoin_rooms
                .lock()
                .map_err(|_| "MLS rejoin state is unavailable".to_string())?
                .insert(request.room_id);
            Err(error)
        }
        result => result,
    }
}

#[tauri::command]
pub(crate) fn mls_forget_corrupt_group(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<(), String> {
    {
        let flagged = state
            .requires_rejoin_rooms
            .lock()
            .map_err(|_| "MLS rejoin state is unavailable".to_string())?;
        if !flagged.contains(&request.room_id) {
            return Err("MLS room is not authorized for corrupt-state cleanup".into());
        }
    }
    with_store(&state, |store| {
        store.delete_all_history_ciphertexts(&request.room_id)
    })?;
    with_engine(&state, |engine| {
        engine.forget_corrupt_group(&request.room_id)
    })?;
    state
        .requires_rejoin_rooms
        .lock()
        .map_err(|_| "MLS rejoin state is unavailable".to_string())?
        .remove(&request.room_id);
    Ok(())
}

#[tauri::command]
pub(crate) fn mls_publish_succeeded(
    request: PublishSucceededRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<u64, String> {
    let (epoch, capability_handle) = with_engine(&state, |engine| {
        let capability_handle = engine
            .invite_receipt_for_commit(&request.message_id)?
            .map(|receipt| receipt.capability_handle);
        let epoch = engine.publish_succeeded(&request.room_id, &request.message_id)?;
        Ok((epoch, capability_handle))
    })?;
    if let Some(handle) = capability_handle {
        if let Ok(entry) = keyring::Entry::new(
            MLS_KEYCHAIN_SERVICE,
            &format!("mls-invite-capability:{handle}"),
        ) {
            let _ = entry.delete_credential();
        }
    }
    Ok(epoch)
}

#[tauri::command]
pub(crate) fn mls_outbox_list(
    state: tauri::State<'_, MlsNativeState>,
) -> Result<Vec<OutboxPublic>, String> {
    let items = with_store(&state, |store| store.pending_outbox())?;
    items
        .into_iter()
        .map(|item| {
            let metadata = item
                .metadata
                .as_deref()
                .map(serde_json::from_slice)
                .transpose()
                .map_err(|_| "MLS outbox metadata is invalid".to_string())?;
            Ok(OutboxPublic {
                id: item.id,
                room_id: item.room_id,
                epoch: item.epoch,
                kind: item.kind,
                payload: STANDARD.encode(item.payload),
                metadata,
            })
        })
        .collect()
}

#[tauri::command]
pub(crate) fn mls_clear_pending_commit(
    request: ClearPendingRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<u64, String> {
    with_engine(&state, |engine| {
        engine.clear_pending_commit(&request.room_id, &request.expected_message_id)
    })
}

#[tauri::command]
pub(crate) fn mls_retire_stale_application(
    request: PublishSucceededRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> Result<u64, String> {
    with_engine(&state, |engine| {
        engine.retire_stale_application(&request.room_id, &request.message_id)
    })
}

fn with_engine<T>(
    state: &tauri::State<'_, MlsNativeState>,
    operation: impl FnOnce(&mut MlsEngine) -> Result<T, mls_core::EngineError>,
) -> Result<T, String> {
    let mut lock = state
        .engine
        .lock()
        .map_err(|_| "MLS state is unavailable".to_string())?;
    operation(
        lock.as_mut()
            .ok_or_else(|| "MLS identity is not initialized".to_string())?,
    )
    .map_err(engine_error)
}

fn engine_error(error: mls_core::EngineError) -> String {
    match error {
        mls_core::EngineError::RequiresRejoin => "MLS_REQUIRES_REJOIN".into(),
        other => safe_error(other),
    }
}

fn with_store<T>(
    state: &tauri::State<'_, MlsNativeState>,
    operation: impl FnOnce(&EncryptedStore) -> Result<T, mls_core::StoreError>,
) -> Result<T, String> {
    let lock = state
        .store
        .lock()
        .map_err(|_| "MLS store is unavailable".to_string())?;
    operation(
        lock.as_ref()
            .ok_or_else(|| "MLS identity is not initialized".to_string())?,
    )
    .map_err(safe_error)
}

fn decode(value: &str) -> Result<Vec<u8>, String> {
    if value.is_empty() || value.len() > MAX_B64_MESSAGE {
        return Err("MLS message is invalid".into());
    }
    let decoded = STANDARD
        .decode(value)
        .map_err(|_| "MLS message is invalid".to_string())?;
    if STANDARD.encode(&decoded) != value {
        return Err("MLS message is invalid".into());
    }
    Ok(decoded)
}

fn safe_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn quarantine_store(path: &std::path::Path) -> Result<(), String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Failed to quarantine corrupt MLS store".to_string())?
        .as_secs();
    let base = path.with_extension(format!("db.corrupt-{timestamp}"));
    for (source, target) in [
        (path.to_path_buf(), base.clone()),
        (
            std::path::PathBuf::from(format!("{}-wal", path.display())),
            std::path::PathBuf::from(format!("{}-wal", base.display())),
        ),
        (
            std::path::PathBuf::from(format!("{}-shm", path.display())),
            std::path::PathBuf::from(format!("{}-shm", base.display())),
        ),
    ] {
        if source.exists() {
            std::fs::rename(source, target)
                .map_err(|_| "Failed to quarantine corrupt MLS store".to_string())?;
        }
    }
    Ok(())
}

fn should_quarantine_store(path: &std::path::Path, wrapping_key: [u8; 32]) -> bool {
    let Err(error) = EncryptedStore::open(path, wrapping_key) else {
        return false;
    };
    is_corruption_error_message(&error.to_string())
}

fn is_corruption_error_message(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("file is not a database")
        || message.contains("database disk image is malformed")
        || message.contains("database malformed")
        || message.contains("not a database")
}

fn secure_store_permissions(path: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|_| "Failed to secure MLS store permissions".to_string())?;
    }
    Ok(())
}

fn load_or_create_signing_secret(github_user_id: &str, device_id: &str) -> Result<Vec<u8>, String> {
    let entry = keyring::Entry::new(MLS_KEYCHAIN_SERVICE, MLS_IDENTITY_ACCOUNT)
        .map_err(|_| "Failed to open MLS identity".to_string())?;
    match entry.get_password() {
        Ok(value) => decode_stored_signing_secret(&value, github_user_id, device_id),
        Err(keyring::Error::NoEntry) => {
            let secret = generate_device_signing_secret().map_err(safe_error)?;
            let stored = StoredMlsIdentity {
                version: 1,
                github_user_id: github_user_id.to_owned(),
                device_id: device_id.to_owned(),
                signing_secret: STANDARD.encode(&secret),
            };
            entry
                .set_password(
                    &serde_json::to_string(&stored)
                        .map_err(|_| "Failed to encode MLS identity".to_string())?,
                )
                .map_err(|_| "Failed to save MLS identity".to_string())?;
            Ok(secret)
        }
        Err(_) => Err("Failed to read MLS identity".to_string()),
    }
}

fn decode_stored_signing_secret(
    value: &str,
    github_user_id: &str,
    device_id: &str,
) -> Result<Vec<u8>, String> {
    let stored: StoredMlsIdentity =
        serde_json::from_str(value).map_err(|_| "Stored MLS identity is corrupt".to_string())?;
    if stored.version != 1
        || stored.github_user_id != github_user_id
        || stored.device_id != device_id
    {
        return Err("MLS identity belongs to another signed-in device identity".into());
    }
    fixed32(&stored.signing_secret).map(Vec::from)
}
fn load_or_create_store_wrapping_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(MLS_KEYCHAIN_SERVICE, "mls-store-wrap:v1")
        .map_err(|_| "Failed to open MLS store key".to_string())?;
    match entry.get_password() {
        Ok(value) => fixed32(&value),
        Err(keyring::Error::NoEntry) => {
            let bytes = generate_device_signing_secret().map_err(safe_error)?;
            let key: [u8; 32] = bytes
                .try_into()
                .map_err(|_| "Failed to generate MLS store key".to_string())?;
            entry
                .set_password(&STANDARD.encode(key))
                .map_err(|_| "Failed to save MLS store key".to_string())?;
            Ok(key)
        }
        Err(_) => Err("Failed to read MLS store key".into()),
    }
}

fn load_or_create_hpke_key_pair() -> Result<HpkeKeyPair, String> {
    let entry = keyring::Entry::new(MLS_KEYCHAIN_SERVICE, MLS_HPKE_ACCOUNT)
        .map_err(|_| "Failed to open HPKE identity".to_string())?;
    match entry.get_password() {
        Ok(value) => {
            let parts: Vec<&str> = value.split('.').collect();
            if parts.len() != 2 {
                return Err("Stored HPKE identity is corrupt".into());
            }
            HpkeKeyPair::from_bytes(
                STANDARD
                    .decode(parts[0])
                    .map_err(|_| "Stored HPKE identity is corrupt".to_string())?,
                STANDARD
                    .decode(parts[1])
                    .map_err(|_| "Stored HPKE identity is corrupt".to_string())?,
            )
            .map_err(safe_error)
        }
        Err(keyring::Error::NoEntry) => {
            let pair = generate_hpke_key_pair();
            entry
                .set_password(&format!(
                    "{}.{}",
                    STANDARD.encode(pair.private_key_bytes()),
                    STANDARD.encode(pair.public_key_bytes())
                ))
                .map_err(|_| "Failed to save HPKE identity".to_string())?;
            Ok(pair)
        }
        Err(_) => Err("Failed to read HPKE identity".into()),
    }
}
fn fingerprint(bytes: &[u8]) -> String {
    let hex = Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    format!(
        "sha256:{}",
        hex.as_bytes()
            .chunks(4)
            .map(|c| std::str::from_utf8(c).unwrap_or(""))
            .collect::<Vec<_>>()
            .join(":")
    )
}
fn fixed32(value: &str) -> Result<[u8; 32], String> {
    let decoded = STANDARD
        .decode(value)
        .map_err(|_| "Cryptographic value is invalid".to_string())?;
    if STANDARD.encode(&decoded) != value {
        return Err("Cryptographic value is invalid".into());
    }
    decoded
        .try_into()
        .map_err(|_| "Cryptographic value is invalid".to_string())
}

fn valid_capability_handle(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn fixed32_url(value: &str) -> Result<[u8; 32], String> {
    let decoded = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| "Cryptographic value is invalid".to_string())?;
    if URL_SAFE_NO_PAD.encode(&decoded) != value {
        return Err("Cryptographic value is invalid".into());
    }
    decoded
        .try_into()
        .map_err(|_| "Cryptographic value is invalid".to_string())
}

fn derive_capability_verifier(raw: &[u8; 32]) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"multaiplayer:invite-capability-verifier:v2\0");
    hash.update(raw);
    hash.finalize().into()
}

fn decision_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn validate_invite_response_pair(
    original: &CapabilityBinding,
    response: &CapabilityBinding,
) -> Result<(), String> {
    if original.phase != "request"
        || response.phase != "response"
        || !matches!(response.status.as_deref(), Some("approved" | "denied"))
        || response.decided_at.as_deref().is_none_or(str::is_empty)
    {
        return Err("Invite response is invalid".into());
    }
    let mut expected = original.clone();
    expected.phase = "response".into();
    expected.status = response.status.clone();
    expected.decided_at = response.decided_at.clone();
    if &expected != response {
        return Err("Invite response does not match its request".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        decision_timestamp, decode_stored_signing_secret, delete_all_history_native, engine_error,
        fingerprint, fixed32, fixed32_url, is_corruption_error_message, quarantine_store,
        validate_invite_response_pair, BasicAppCredential, CapabilityBinding, EncryptRequest,
        EncryptedStore, MlsEngine, PendingJoinAdmissionPublic, StoredMlsIdentity,
    };

    fn request_binding() -> CapabilityBinding {
        CapabilityBinding {
            version: 2,
            phase: "request".into(),
            invite_id: "invite".into(),
            team_id: "team".into(),
            room_id: "room".into(),
            key_epoch: 0,
            key_package_hash: "sha256:package".into(),
            request_id: "request".into(),
            request_nonce: "nonce".into(),
            requester_user_id: "joiner".into(),
            requester_device_id: "joiner-device".into(),
            host_user_id: "host".into(),
            host_device_id: "host-device".into(),
            expires_at: "2030-01-01T00:00:00Z".into(),
            status: None,
            decided_at: None,
        }
    }

    #[test]
    fn fingerprint_matches_protocol_grouping_vector() {
        assert_eq!(fingerprint(b"abc"), "sha256:ba78:16bf:8f01:cfea:4141:40de:5dae:2223:b003:61a3:9617:7a9c:b410:ff61:f200:15ad");
    }

    #[test]
    fn invite_capability_requires_canonical_unpadded_base64url() {
        let canonical = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        assert_eq!(fixed32_url(canonical).unwrap(), [0; 32]);
        assert!(fixed32_url(&format!("{canonical}=")).is_err());
        assert!(fixed32_url("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+").is_err());
        assert!(fixed32_url("short").is_err());
    }

    #[test]
    fn capability_authenticators_require_canonical_padded_base64() {
        let canonical = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
        assert_eq!(fixed32(canonical).unwrap(), [0; 32]);
        assert!(fixed32(canonical.trim_end_matches('=')).is_err());
        assert!(fixed32("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB=").is_err());
    }

    #[test]
    fn invite_response_must_rebind_the_exact_request() {
        let request = request_binding();
        let mut response = request.clone();
        response.phase = "response".into();
        response.status = Some("approved".into());
        response.decided_at = Some("2026-07-12T00:00:00Z".into());
        assert!(validate_invite_response_pair(&request, &response).is_ok());
        response.request_id = "substituted".into();
        assert!(validate_invite_response_pair(&request, &response).is_err());
        response = request.clone();
        response.phase = "response".into();
        response.status = Some("pending".into());
        response.decided_at = Some("2026-07-12T00:00:00Z".into());
        assert!(validate_invite_response_pair(&request, &response).is_err());
    }

    #[test]
    fn invite_decision_timestamp_is_canonical_utc_milliseconds() {
        let value = decision_timestamp();
        assert_eq!(value.len(), 24);
        assert!(value.ends_with('Z'));
        assert_eq!(&value[19..20], ".");
        assert!(value[20..23].bytes().all(|byte| byte.is_ascii_digit()));
    }

    #[test]
    fn native_delete_all_history_removes_ciphertext_and_epoch_secret() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.db");
        let key = [31; 32];
        let secret = mls_core::generate_device_signing_secret().unwrap();
        let mut engine = MlsEngine::open_persistent(
            BasicAppCredential {
                github_user_id: "1".into(),
                device_id: "history-device".into(),
            },
            secret,
            &path,
            key,
        )
        .unwrap();
        engine.create_group("history-room").unwrap();
        let encrypted = engine
            .encrypt_history("history-room", b"retained plaintext")
            .unwrap();
        let store = EncryptedStore::open(&path, key).unwrap();
        store
            .put_history_ciphertext(
                "history-room",
                encrypted.epoch,
                &serde_json::to_vec(&encrypted).unwrap(),
                30,
            )
            .unwrap();
        delete_all_history_native(&engine, &store, "history-room").unwrap();
        assert!(store
            .latest_history_ciphertext("history-room")
            .unwrap()
            .is_none());
        assert!(engine.decrypt_history("history-room", &encrypted).is_err());
    }

    #[test]
    fn stored_signing_identity_is_bound_to_user_and_device() {
        let encoded = serde_json::to_string(&StoredMlsIdentity {
            version: 1,
            github_user_id: "github:1".into(),
            device_id: "device-1".into(),
            signing_secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".into(),
        })
        .unwrap();
        assert_eq!(
            decode_stored_signing_secret(&encoded, "github:1", "device-1").unwrap(),
            vec![0; 32]
        );
        assert!(decode_stored_signing_secret(&encoded, "github:2", "device-1").is_err());
        assert!(decode_stored_signing_secret(&encoded, "github:1", "device-2").is_err());
    }

    #[test]
    fn pending_admission_ipc_contains_only_public_routing_fields() {
        let value = serde_json::to_value(PendingJoinAdmissionPublic {
            invite_id: "invite".into(),
            team_id: "team".into(),
            room_id: "room".into(),
            request_id: "request".into(),
            requester_user_id: "user".into(),
            requester_device_id: "device".into(),
        })
        .unwrap();
        assert_eq!(value.as_object().unwrap().len(), 6);
        assert!(value.get("responseHash").is_none());
        assert!(value.get("capabilityUrlValue").is_none());
        assert!(value.get("welcome").is_none());
        assert!(value.get("responseMac").is_none());
    }

    #[test]
    fn quarantine_moves_database_and_sidecars_together() {
        let dir = tempfile::tempdir().unwrap();
        let database = dir.path().join("mls-v2.db");
        std::fs::write(&database, b"bad").unwrap();
        std::fs::write(format!("{}-wal", database.display()), b"wal").unwrap();
        std::fs::write(format!("{}-shm", database.display()), b"shm").unwrap();
        quarantine_store(&database).unwrap();
        assert!(!database.exists());
        let names = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(names.len(), 3);
        assert!(names.iter().all(|name| name.contains(".corrupt-")));
    }

    #[test]
    fn quarantine_classification_rejects_transient_database_errors() {
        assert!(is_corruption_error_message("file is not a database"));
        assert!(is_corruption_error_message(
            "database disk image is malformed"
        ));
        assert!(!is_corruption_error_message("database is locked"));
        assert!(!is_corruption_error_message("disk I/O error"));
        assert_eq!(
            engine_error(mls_core::EngineError::RequiresRejoin),
            "MLS_REQUIRES_REJOIN"
        );
        assert_ne!(
            engine_error(mls_core::EngineError::Mls),
            "MLS_REQUIRES_REJOIN"
        );
    }

    #[test]
    fn application_encrypt_ipc_does_not_accept_a_caller_supplied_epoch() {
        let request = serde_json::json!({
            "roomId": "room-1",
            "messageId": "message-1",
            "payload": "YQ==",
            "authenticatedData": {
                "version": 1,
                "messageId": "message-1",
                "teamId": "team-1",
                "roomId": "room-1",
                "kind": "chat",
                "senderUserId": "github:1",
                "senderDeviceId": "device-1",
                "createdAt": "2026-07-12T00:00:00.000Z"
            }
        });
        assert!(serde_json::from_value::<EncryptRequest>(request.clone()).is_ok());
        let mut raced = request;
        raced["authenticatedData"]["epoch"] = serde_json::json!(0);
        assert!(serde_json::from_value::<EncryptRequest>(raced).is_err());
    }
}
