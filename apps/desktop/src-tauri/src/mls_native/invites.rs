use super::*;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectedInviteRequestEnvelope<'a> {
    version: u8,
    binding: &'a CapabilityBinding,
    sealed_payload: &'a SealedPayload,
}

pub(super) fn serialize_directed_invite_request(
    binding: &CapabilityBinding,
    sealed_payload: &SealedPayload,
) -> Result<String, String> {
    serde_json::to_string(&DirectedInviteRequestEnvelope {
        version: 3,
        binding,
        sealed_payload,
    })
    .map_err(|_| "Invite request recovery is invalid".to_string())
}

#[tauri::command]
pub(crate) fn mls_invite_capability_issue(
) -> crate::command_error::CommandResult<CapabilityIssueResponse> {
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
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<InviteRequestSealResponse> {
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
    if request.key_package_id.is_empty()
        || request.key_package_id.len() > 128
        || !request
            .key_package_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Invite KeyPackage id is invalid".into());
    }
    let capability_url_value = request.capability_url_value.clone();
    let key_package_id = request.key_package_id.clone();
    let original_binding = request.binding.clone();
    ensure_pending_invite_identity(&state, &original_binding)?;
    let payload = InviteRequestPayload {
        capability_handle: request.capability_handle,
        mac: STANDARD.encode(mac_binding(&capability, &request.binding).map_err(safe_error)?),
        binding: request.binding,
        key_package: request.key_package,
    };
    let aad = encode_capability_binding(&payload.binding).map_err(safe_error)?;
    let sealed_payload = seal(
        &decode(&request.recipient_hpke_public_key)?,
        b"multaiplayer:invite-request:v3",
        &aad,
        &serde_json::to_vec(&payload)
            .map_err(|_| "Invite request payload is invalid".to_string())?,
    )
    .map_err(safe_error)?;
    let sealed_request = serialize_directed_invite_request(&original_binding, &sealed_payload)?;
    with_store(&state, |store| {
        store.put_pending_invite_request(&PendingInviteRequest {
            capability_url_value,
            original_binding,
            key_package_id,
            sealed_request: sealed_request.clone(),
        })
    })?;
    Ok(InviteRequestSealResponse {
        key_package_hash,
        sealed_request,
    })
}

#[tauri::command]
pub(crate) fn mls_invite_request_open(
    request: InviteRequestOpenRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<InviteRequestOpenResponse> {
    let aad = encode_capability_binding(&request.binding).map_err(safe_error)?;
    let hpke = state
        .hpke
        .lock()
        .map_err(|_| "MLS HPKE state is unavailable".to_string())?;
    let plaintext = open(
        hpke.as_ref()
            .ok_or_else(|| "MLS identity is not initialized".to_string())?,
        b"multaiplayer:invite-request:v3",
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
) -> crate::command_error::CommandResult<InviteApproveResponse> {
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
        Sha256::digest(encode_capability_binding(&request.binding).map_err(safe_error)?)
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
    verify_request_binding(&verifier, &request.binding, &mac).map_err(safe_error)?;
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
) -> crate::command_error::CommandResult<InviteDenyResponse> {
    let _approval = state
        .invite_approval
        .lock()
        .map_err(|_| "Invite approval is unavailable".to_string())?;
    if !valid_capability_handle(&request.capability_handle) || request.binding.phase != "request" {
        return Err("Invite denial is invalid".into());
    }
    let binding_hash = format!(
        "{:x}",
        Sha256::digest(encode_capability_binding(&request.binding).map_err(safe_error)?)
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
    verify_request_binding(&verifier, &request.binding, &fixed32(&request.mac)?)
        .map_err(safe_error)?;
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
) -> crate::command_error::CommandResult<InviteResponseAcceptResponse> {
    Ok(accept_invite_response(request, &state)?)
}

fn accept_invite_response(
    request: InviteResponseAcceptRequest,
    state: &tauri::State<'_, MlsNativeState>,
) -> Result<InviteResponseAcceptResponse, String> {
    let raw = fixed32_url(&request.capability_url_value)?;
    validate_invite_response_pair(&request.original_binding, &request.response_binding)?;
    verify_response_binding(
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
            Some(with_engine(state, |engine| {
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
pub(crate) fn mls_pending_invite_requests_list(
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<Vec<PendingInviteRequestPublic>> {
    Ok(with_store(&state, |store| store.pending_invite_requests())
        .map(|requests| {
            requests
                .into_iter()
                .map(|request| {
                    ensure_pending_invite_identity(&state, &request.original_binding)?;
                    Ok(PendingInviteRequestPublic {
                        invite_id: request.original_binding.invite_id,
                        team_id: request.original_binding.team_id,
                        room_id: request.original_binding.room_id,
                        request_id: request.original_binding.request_id,
                        requester_user_id: request.original_binding.requester_user_id,
                        requester_device_id: request.original_binding.requester_device_id,
                        key_package_id: request.key_package_id,
                        key_package_hash: request.original_binding.key_package_hash,
                        expires_at: request.original_binding.expires_at,
                        sealed_request: request.sealed_request,
                    })
                })
                .collect::<Result<Vec<_>, String>>()
        })
        .and_then(|requests| requests)?)
}

#[tauri::command]
pub(crate) fn mls_pending_invite_response_accept(
    request: PendingInviteResponseAcceptRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<InviteResponseAcceptResponse> {
    let pending = with_store(&state, |store| {
        store.pending_invite_request(&request.request_id)
    })?
    .ok_or_else(|| "Pending invite request is unavailable".to_string())?;
    if pending.original_binding.request_id != request.request_id {
        return Err("Pending invite request does not match recovery metadata".into());
    }
    ensure_pending_invite_identity(&state, &pending.original_binding)?;
    Ok(accept_invite_response(
        InviteResponseAcceptRequest {
            capability_url_value: pending.capability_url_value,
            original_binding: pending.original_binding,
            response_binding: request.response_binding,
            response_mac: request.response_mac,
            welcome: request.welcome,
        },
        &state,
    )?)
}

#[tauri::command]
pub(crate) fn mls_pending_invite_complete(
    request: PendingInviteCompleteRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<()> {
    let Some(pending) = with_store(&state, |store| {
        store.pending_invite_request(&request.request_id)
    })?
    else {
        return Ok(());
    };
    if pending.original_binding.room_id != request.room_id {
        return Err("Pending invite request does not match its room".into());
    }
    ensure_pending_invite_identity(&state, &pending.original_binding)?;
    Ok(with_store(&state, |store| {
        store.delete_pending_invite_request(&request.request_id)
    })?)
}

fn ensure_pending_invite_identity(
    state: &tauri::State<'_, MlsNativeState>,
    binding: &CapabilityBinding,
) -> Result<(), String> {
    let identity = state
        .identity
        .lock()
        .map_err(|_| "MLS identity state is unavailable".to_string())?;
    let (user_id, device_id, _) = identity
        .as_ref()
        .ok_or_else(|| "MLS identity is not initialized".to_string())?;
    if user_id != &binding.requester_user_id || device_id != &binding.requester_device_id {
        return Err("Pending invite request does not belong to this MLS identity".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn mls_join_admissions_list(
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<Vec<PendingJoinAdmissionPublic>> {
    Ok(
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
        })?,
    )
}

#[tauri::command]
pub(crate) fn mls_join_admission_complete(
    request: JoinAdmissionCompleteRequest,
    state: tauri::State<'_, MlsNativeState>,
) -> crate::command_error::CommandResult<()> {
    Ok(with_engine(&state, |engine| {
        engine.complete_join_admission(&request.room_id, &request.request_id)
    })?)
}

pub(super) fn fixed32(value: &str) -> Result<[u8; 32], String> {
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

pub(super) fn fixed32_url(value: &str) -> Result<[u8; 32], String> {
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

pub(super) fn decision_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub(super) fn validate_invite_response_pair(
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
