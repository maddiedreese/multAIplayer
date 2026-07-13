use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use mls_core::{
    derive_capability_verifier, encode_capability_binding, generate_device_signing_secret,
    generate_hpke_key_pair, issue_capability, mac_binding, mac_response_binding, open, seal,
    validate_credential, validate_key_package_upload, verify_request_binding,
    verify_response_binding, BasicAppCredential, CapabilityBinding, DeviceAuthSigner,
    EncryptedStore, ExporterCiphertext, HpkeKeyPair, JoinAdmissionMetadata, KeyPackageUpload,
    MlsEngine, WelcomeRetryMetadata,
};
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

mod types;

pub(crate) use types::*;

mod invites;

pub(crate) use invites::*;

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
        mls_core::EngineError::RequiresRejoin { .. } => "MLS_REQUIRES_REJOIN".into(),
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
#[cfg(test)]
mod tests;
