use super::invites::{
    decision_timestamp, fixed32, fixed32_url, serialize_directed_invite_request,
    validate_invite_response_pair,
};
use super::{
    decode_stored_signing_secret, delete_all_history_native, engine_error, fingerprint,
    is_corruption_error_message, quarantine_store, validate_room_config_payload,
    BasicAppCredential, CapabilityBinding, EncryptRequest, EncryptedStore, MlsEngine,
    PendingInviteRequestPublic, PendingJoinAdmissionPublic, StoredMlsIdentity,
};

fn request_binding() -> CapabilityBinding {
    CapabilityBinding {
        version: 3,
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
    assert_eq!(
        fingerprint(b"abc"),
        "sha256:ba78:16bf:8f01:cfea:4141:40de:5dae:2223:b003:61a3:9617:7a9c:b410:ff61:f200:15ad"
    );
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
fn directed_invite_request_uses_the_relay_canonical_field_order() {
    let encoded = serialize_directed_invite_request(
        &request_binding(),
        &mls_core::SealedPayload {
            version: 1,
            kem_id: 16,
            kdf_id: 1,
            aead_id: 1,
            encapsulated_key: vec![0; 65],
            ciphertext: vec![0; 16],
        },
    )
    .unwrap();
    assert!(encoded.starts_with(
        r#"{"version":3,"binding":{"version":3,"phase":"request","inviteId":"invite","teamId":"team","roomId":"room","keyEpoch":0,"keyPackageHash":"sha256:package","requestId":"request","requestNonce":"nonce","requesterUserId":"joiner","requesterDeviceId":"joiner-device","hostUserId":"host","hostDeviceId":"host-device","expiresAt":"2030-01-01T00:00:00Z","status":null,"decidedAt":null},"sealedPayload":{"version":1,"kem_id":16,"kdf_id":1,"aead_id":1,"encapsulated_key":"#
    ));
    assert!(encoded.ends_with(&format!(
        r#","ciphertext":[{}]}}}}"#,
        vec!["0"; 16].join(",")
    )));
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
fn pending_invite_recovery_ipc_keeps_the_bearer_capability_native_only() {
    let value = serde_json::to_value(PendingInviteRequestPublic {
        invite_id: "invite".into(),
        team_id: "team".into(),
        room_id: "room".into(),
        request_id: "request".into(),
        requester_user_id: "user".into(),
        requester_device_id: "device".into(),
        key_package_id: "package".into(),
        key_package_hash: "hash".into(),
        expires_at: "2030-01-01T00:00:00.000Z".into(),
        sealed_request: "opaque".into(),
    })
    .unwrap();
    assert_eq!(value.as_object().unwrap().len(), 10);
    assert!(value.get("capabilityUrlValue").is_none());
    assert!(value.get("originalBinding").is_none());
    assert_eq!(
        value.get("sealedRequest").and_then(|value| value.as_str()),
        Some("opaque")
    );
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
        engine_error(mls_core::EngineError::requires_rejoin(
            "load_group",
            "corrupt snapshot",
        )),
        "MLS_REQUIRES_REJOIN"
    );
    let failure = mls_core::EngineError::operation_failed(
        mls_core::EngineErrorCategory::Storage,
        "load_group_snapshot",
        "secret database path /Users/private/rooms.db",
    );
    assert_eq!(
        failure.category(),
        Some(mls_core::EngineErrorCategory::Storage)
    );
    assert_eq!(failure.operation(), Some("load_group_snapshot"));
    assert!(failure
        .cause_detail()
        .is_some_and(|cause| cause.contains("/Users/private/rooms.db")));
    let ipc_error = engine_error(failure);
    assert_eq!(
        ipc_error,
        "MLS storage operation load_group_snapshot failed"
    );
    assert!(!ipc_error.contains("private"));
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

#[test]
fn native_room_config_validation_is_strict_and_bounded() {
    let valid = serde_json::json!({
        "eventType": "room.config", "configRevision": 1, "emittingEpoch": 4,
        "projectPath": "/Users/example/project", "codexModel": "gpt-5.4",
        "codexModelPolicy": "pinned", "codexReasoningEffort": "high",
        "codexReasoningEffortPolicy": "pinned", "codexRawReasoningEnabled": false,
        "codexSpeed": "standard", "codexServiceTierPolicy": "pinned",
        "codexSandboxLevel": "workspace_write"
    });
    assert_eq!(
        validate_room_config_payload(&serde_json::to_vec(&valid).unwrap()),
        Ok(4)
    );
    let mut unknown = valid.clone();
    unknown["accessToken"] = serde_json::json!("must-not-enter-mls");
    assert!(validate_room_config_payload(&serde_json::to_vec(&unknown).unwrap()).is_err());
    let mut oversized = valid.clone();
    oversized["projectPath"] = serde_json::json!("x".repeat(2_049));
    assert!(validate_room_config_payload(&serde_json::to_vec(&oversized).unwrap()).is_err());
    let mut invalid_model = valid;
    invalid_model["codexModel"] = serde_json::json!("model with spaces");
    assert!(validate_room_config_payload(&serde_json::to_vec(&invalid_model).unwrap()).is_err());
}
