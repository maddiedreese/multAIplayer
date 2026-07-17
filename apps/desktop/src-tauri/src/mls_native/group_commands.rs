use super::*;

#[typed_tauri_command::command]
pub(crate) fn mls_room_config_load(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<Option<RoomConfigPayload>> {
    let payload = with_store(&state, |store| store.room_config(&request.room_id))?;
    payload
        .map(|value| validate_room_config_payload(&value))
        .transpose()
        .map_err(Into::into)
}

#[typed_tauri_command::command]
pub(crate) fn mls_process_incoming(
    request: IncomingRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<Option<IncomingApplication>> {
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

#[typed_tauri_command::command]
pub(crate) fn mls_remove_member(
    request: RemoveRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<OutboundCommitResponse> {
    Ok(with_engine(&state, |engine| {
        engine.remove_member(&request.room_id, request.leaf)
    })?)
    .map(|output| OutboundCommitResponse {
        message: STANDARD.encode(output.message),
        outbox_id: output.outbox_id,
        parent_epoch: output.parent_epoch,
    })
}

#[typed_tauri_command::command]
pub(crate) fn mls_transfer_host(
    request: TransferRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<OutboundCommitResponse> {
    Ok(with_engine(&state, |engine| {
        engine.transfer_host(
            &request.room_id,
            request.next_host_leaf,
            request.next_host_device_id,
            request.transfer_id,
        )
    })?)
    .map(|output| OutboundCommitResponse {
        message: STANDARD.encode(output.message),
        outbox_id: output.outbox_id,
        parent_epoch: output.parent_epoch,
    })
}

#[typed_tauri_command::command]
pub(crate) fn mls_host_transfer_authorization(
    request: HostTransferAuthorizationRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<HostTransferAuthorizationResponse> {
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
        .map_err(display_error)?;
    Ok(HostTransferAuthorizationResponse {
        authorization,
        signature_der: STANDARD.encode(signature.signature_der),
        public_key_spki_der: STANDARD.encode(signature.public_key_spki_der),
    })
}

#[typed_tauri_command::command]
pub(crate) fn mls_current_epoch(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<u64> {
    Ok(with_engine(&state, |engine| {
        engine.current_epoch(&request.room_id)
    })?)
}

#[typed_tauri_command::command]
pub(crate) fn mls_group_open(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<u64> {
    match with_engine(&state, |engine| engine.open_group(&request.room_id)) {
        Err(error) if error == "MLS_REQUIRES_REJOIN" => {
            state
                .requires_rejoin_rooms
                .lock()
                .map_err(|_| "MLS rejoin state is unavailable".to_string())?
                .insert(request.room_id);
            Err(crate::command_error::CommandError::requires_rejoin(error))
        }
        result => Ok(result?),
    }
}

#[typed_tauri_command::command]
pub(crate) fn mls_forget_corrupt_group(
    request: RoomRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<()> {
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

#[typed_tauri_command::command]
pub(crate) fn mls_publish_succeeded(
    request: PublishSucceededRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<u64> {
    let capability_handle = with_engine(&state, |engine| {
        Ok(engine
            .invite_receipt_for_commit(&request.message_id)?
            .map(|receipt| receipt.capability_handle))
    })?;
    if let Some(handle) = capability_handle {
        delete_invite_verifier(&handle)?;
    }
    Ok(with_engine(&state, |engine| {
        engine.publish_succeeded(&request.room_id, &request.message_id)
    })?)
}

#[typed_tauri_command::command]
pub(crate) fn mls_outbox_list(
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<Vec<OutboxPublic>> {
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

#[typed_tauri_command::command]
pub(crate) fn mls_clear_pending_commit(
    request: ClearPendingRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<u64> {
    Ok(with_engine(&state, |engine| {
        engine.clear_pending_commit(&request.room_id, &request.expected_message_id)
    })?)
}

#[typed_tauri_command::command]
pub(crate) fn mls_retire_stale_application(
    request: PublishSucceededRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<u64> {
    Ok(with_engine(&state, |engine| {
        engine.retire_stale_application(&request.room_id, &request.message_id)
    })?)
}
