use super::*;

#[typed_tauri_command::command]
pub(crate) fn mls_device_auth_sign(
    request: DeviceAuthRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<DeviceAuthResponse> {
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

#[typed_tauri_command::command]
pub(crate) fn mls_generate_key_package(
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<KeyPackagePublish> {
    let engine = state
        .engine
        .lock()
        .map_err(|_| crate::command_error::CommandError::unavailable("MLS state is unavailable"))?;
    let engine = engine.as_ref().ok_or_else(|| {
        crate::command_error::CommandError::unavailable("MLS identity is not initialized")
    })?;
    let bytes = engine
        .generate_key_package()
        .map_err(|error| crate::command_error::CommandError::crypto(safe_error(error)))?;
    let id = uuid::Uuid::new_v4().to_string();
    let key_package_hash = format!("sha256:{:x}", Sha256::digest(&bytes));
    Ok(KeyPackagePublish {
        id,
        key_package: STANDARD.encode(bytes),
        key_package_hash,
        ciphersuite: 2,
    })
}

#[typed_tauri_command::command]
pub(crate) fn mls_create_group(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<u64> {
    Ok(with_engine(&state, |engine| {
        engine.create_group(&request.room_id)
    })?)
}

#[typed_tauri_command::command]
pub(crate) fn mls_join_welcome(
    request: JoinRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<u64> {
    let welcome = decode(&request.welcome)?;
    Ok(with_engine(&state, |engine| {
        engine.join_welcome(&request.room_id, &welcome)
    })?)
}

#[typed_tauri_command::command]
pub(crate) fn mls_encrypt_application(
    request: EncryptRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<OutboundApplicationResponse> {
    let payload = decode(&request.payload)?;
    let room_config = if request.authenticated_data.kind == "room.config" {
        Some(validate_room_config_payload(&payload)?)
    } else {
        None
    };
    if let Some(config) = room_config.as_ref() {
        let epoch = with_engine(&state, |engine| engine.current_epoch(&request.room_id))?;
        if config.emitting_epoch != epoch {
            return Err("Encrypted room configuration is invalid".into());
        }
        // Persist the validated local source of truth before constructing the
        // outbound record. A crash or relay restart can then retry the
        // post-Add snapshot without consulting relay metadata.
        with_store(&state, |store| {
            store.put_room_config(&request.room_id, &payload)
        })?;
    }
    Ok(with_engine(&state, |engine| {
        engine.encrypt_application(
            &request.room_id,
            &request.message_id,
            &payload,
            request.authenticated_data,
        )
    })?)
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

pub(super) fn validate_room_config_payload(payload: &[u8]) -> Result<RoomConfigPayload, String> {
    let config: RoomConfigPayload = serde_json::from_slice(payload)
        .map_err(|_| "Encrypted room configuration is invalid".to_string())?;
    let bounded_text = |value: &str, max: usize| {
        !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
    };
    let policy = |value: &str| matches!(value, "auto" | "pinned");
    let model_chars = config
        .codex_model
        .chars()
        .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | ':' | '/' | '-'));
    if config.event_type != "room.config"
        || config.config_revision == 0
        || !bounded_text(&config.project_path, 2_048)
        || !bounded_text(&config.codex_model, 80)
        || !config
            .codex_model
            .chars()
            .next()
            .is_some_and(|value| value.is_ascii_alphanumeric())
        || !model_chars
        || !policy(&config.codex_model_policy)
        || !matches!(
            config.codex_reasoning_effort.as_str(),
            "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
        )
        || !policy(&config.codex_reasoning_effort_policy)
        || !matches!(config.codex_speed.as_str(), "standard" | "fast")
        || !policy(&config.codex_service_tier_policy)
        || !matches!(
            config.codex_sandbox_level.as_str(),
            "read_only" | "workspace_write" | "workspace_write_network" | "danger_full_access"
        )
    {
        return Err("Encrypted room configuration is invalid".to_string());
    }
    let _ = config.codex_raw_reasoning_enabled;
    Ok(config)
}
