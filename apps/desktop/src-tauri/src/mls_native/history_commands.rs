use super::*;

#[typed_tauri_command::command]
pub(crate) fn mls_group_state(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<RosterPublic> {
    let mut lock = state
        .engine
        .lock()
        .map_err(|_| crate::command_error::CommandError::unavailable("MLS state is unavailable"))?;
    let engine = lock.as_mut().ok_or_else(|| {
        crate::command_error::CommandError::unavailable("MLS identity is not initialized")
    })?;
    (|| {
        let roster = engine.roster(&request.room_id)?;
        let self_leaf = engine.self_leaf(&request.room_id)?;
        let epoch = engine.current_epoch(&request.room_id)?;
        let host = engine.host_context(&request.room_id)?;
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
            host_leaf: host.host_leaf,
            host_device_id: host.host_device_id,
            host_transfer_id: host.transfer_id,
        })
    })()
    .map_err(group_state_command_error)
}

pub(super) fn group_state_command_error(
    error: mls_core::EngineError,
) -> crate::command_error::CommandError {
    match error {
        mls_core::EngineError::GroupNotFound => {
            crate::command_error::CommandError::not_found("MLS group is not open.")
        }
        mls_core::EngineError::RequiresRejoin { .. } => {
            crate::command_error::CommandError::requires_rejoin("MLS room requires rejoin.")
        }
        other => crate::command_error::CommandError::from(engine_error(other)),
    }
}

#[typed_tauri_command::command]
pub(crate) fn mls_blob_encrypt(
    request: BlobEncryptRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<ExporterCiphertext> {
    let plaintext = decode(&request.plaintext)?;
    Ok(with_engine(&state, |engine| {
        engine.encrypt_blob(&request.room_id, request.blob_id.as_bytes(), &plaintext)
    })?)
}
#[typed_tauri_command::command]
pub(crate) fn mls_blob_prepare(
    request: BlobPrepareRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<u64> {
    Ok(with_engine(&state, |engine| {
        engine.prepare_blob(&request.room_id, request.blob_id.as_bytes())
    })?)
}
#[typed_tauri_command::command]
pub(crate) fn mls_blob_decrypt(
    request: BlobDecryptRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<String> {
    Ok(with_engine(&state, |engine| {
        engine.decrypt_blob(&request.room_id, request.blob_id.as_bytes(), &request.value)
    })
    .map(|v| STANDARD.encode(v))?)
}

#[typed_tauri_command::command]
pub(crate) fn mls_history_save(
    request: HistorySaveRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<u64> {
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

#[typed_tauri_command::command]
pub(crate) fn mls_history_retention_set(
    request: HistoryRetentionRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<()> {
    with_engine(&state, |engine| {
        engine.set_history_retention(&request.room_id, request.retention_days)
    })?;
    Ok(with_store(&state, |store| {
        store.set_history_ciphertext_retention(&request.room_id, request.retention_days)
    })?)
}

#[typed_tauri_command::command]
pub(crate) fn mls_history_load(
    request: HistoryEpochRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<Option<String>> {
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
    Ok(with_engine(&state, |engine| {
        engine.decrypt_history(&request.room_id, &value)
    })
    .map(|value| Some(STANDARD.encode(value)))?)
}

#[typed_tauri_command::command]
pub(crate) fn mls_history_delete(
    request: HistoryEpochRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<()> {
    with_engine(&state, |engine| {
        engine.forget_history_epoch(&request.room_id, request.epoch)
    })?;
    Ok(with_store(&state, |store| {
        store.delete_history_ciphertext(&request.room_id, request.epoch)
    })?)
}

#[typed_tauri_command::command]
pub(crate) fn mls_history_load_latest(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<Option<String>> {
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
    Ok(with_engine(&state, |engine| {
        engine.decrypt_history(&request.room_id, &value)
    })
    .map(|value| Some(STANDARD.encode(value)))?)
}

#[typed_tauri_command::command]
pub(crate) fn mls_history_delete_all(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<()> {
    let engine = state
        .engine
        .lock()
        .map_err(|_| "MLS engine is unavailable".to_string())?;
    let store = state
        .store
        .lock()
        .map_err(|_| "MLS store is unavailable".to_string())?;
    Ok(delete_all_history_native(
        engine
            .as_ref()
            .ok_or_else(|| "MLS identity is not initialized".to_string())?,
        store
            .as_ref()
            .ok_or_else(|| "MLS identity is not initialized".to_string())?,
        &request.room_id,
    )?)
}

#[typed_tauri_command::command]
pub(crate) fn mls_room_local_data_delete(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<()> {
    let engine = state
        .engine
        .lock()
        .map_err(|_| "MLS engine is unavailable".to_string())?;
    let store = state
        .store
        .lock()
        .map_err(|_| "MLS store is unavailable".to_string())?;
    Ok(delete_room_local_data_native(
        engine
            .as_ref()
            .ok_or_else(|| "MLS identity is not initialized".to_string())?,
        store
            .as_ref()
            .ok_or_else(|| "MLS identity is not initialized".to_string())?,
        &request.room_id,
    )?)
}

pub(super) fn delete_all_history_native(
    engine: &MlsEngine,
    store: &EncryptedStore,
    room_id: &str,
) -> Result<(), String> {
    // The engine transaction removes both retained epoch secrets and ciphertext rows from the
    // shared SQLCipher KVS. The store deletion is an idempotent defense-in-depth pass for the
    // application-storage abstraction; running it second cannot orphan readable ciphertext.
    engine.forget_history(room_id).map_err(display_error)?;
    store
        .delete_all_history_ciphertexts(room_id)
        .map_err(display_error)
}

pub(super) fn delete_room_local_data_native(
    engine: &MlsEngine,
    store: &EncryptedStore,
    room_id: &str,
) -> Result<(), String> {
    delete_all_history_native(engine, store, room_id)?;
    store.delete_room_config(room_id).map_err(display_error)
}
