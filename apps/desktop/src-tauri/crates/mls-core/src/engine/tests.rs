use super::{EngineError, ExporterCiphertext, MlsEngine, OutboxMetadata};
use crate::BasicAppCredential;

#[test]
fn operation_failures_retain_structured_internal_causes_but_redact_display() {
    let source = serde_json::from_str::<BasicAppCredential>("{not-json}").unwrap_err();
    let error = EngineError::operation_failed(
        super::EngineErrorCategory::Serialization,
        "decode_member_credential",
        source,
    );

    assert_eq!(
        error.category(),
        Some(super::EngineErrorCategory::Serialization)
    );
    assert_eq!(error.operation(), Some("decode_member_credential"));
    assert!(error
        .cause_detail()
        .is_some_and(|cause| cause.contains("expected") || cause.contains("key")));
    assert_eq!(
        error.to_string(),
        "MLS serialization operation decode_member_credential failed"
    );
    assert!(!error.to_string().contains("not-json"));

    let oversized = EngineError::operation_failed(
        super::EngineErrorCategory::Internal,
        "bounded_diagnostic",
        "🦀".repeat(2_000),
    );
    let retained = oversized.cause_detail().unwrap();
    assert_eq!(retained.chars().count(), 1_024);
    assert!(retained.ends_with('…'));
    assert!(!oversized.to_string().contains('🦀'));
}

#[test]
fn exporter_ciphertext_uses_canonical_padded_base64() {
    let value = ExporterCiphertext {
        version: 1,
        epoch: 4,
        nonce: vec![0; 12],
        ciphertext: vec![1, 2],
    };
    let encoded = serde_json::to_value(&value).unwrap();
    assert_eq!(encoded["nonce"], "AAAAAAAAAAAAAAAA");
    assert_eq!(encoded["ciphertext"], "AQI=");
    assert_eq!(
        serde_json::from_value::<ExporterCiphertext>(encoded).unwrap(),
        value
    );
    assert!(serde_json::from_str::<ExporterCiphertext>(
        r#"{"version":1,"epoch":4,"nonce":"AAAAAAAAAAAAAAAA","ciphertext":"AQI"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<ExporterCiphertext>(
        r#"{"version":1,"epoch":4,"nonce":[],"ciphertext":[]}"#
    )
    .is_err());
}

#[test]
fn outbox_metadata_uses_camel_case_at_the_native_boundary() {
    let commit = OutboxMetadata::Commit { parent_epoch: 7 };
    assert_eq!(
        serde_json::to_value(&commit).unwrap(),
        serde_json::json!({ "type": "commit", "parentEpoch": 7 })
    );
    assert!(serde_json::from_value::<OutboxMetadata>(
        serde_json::json!({ "type": "commit", "parent_epoch": 7 })
    )
    .is_err());

    let application = OutboxMetadata::Application {
        authenticated_data: vec![1, 2, 3],
    };
    assert_eq!(
        serde_json::to_value(&application).unwrap(),
        serde_json::json!({ "type": "application", "authenticatedData": [1, 2, 3] })
    );
    assert!(serde_json::from_value::<OutboxMetadata>(
        serde_json::json!({ "type": "application", "authenticated_data": [1, 2, 3] })
    )
    .is_err());
}

#[test]
fn corrupt_serialized_group_requires_rejoin_but_missing_group_does_not() {
    let mut engine = MlsEngine::new(BasicAppCredential {
        github_user_id: "1".into(),
        device_id: "device".into(),
    })
    .unwrap();
    engine.create_group("corrupt-room").unwrap();
    engine.groups.remove("corrupt-room");
    engine.hosts.remove("corrupt-room");
    engine
        .group_storage
        .corrupt_group_snapshot_for_test(b"corrupt-room");
    let rejoin = engine.open_group("corrupt-room").unwrap_err();
    assert!(rejoin.is_requires_rejoin());
    assert_eq!(rejoin.category(), Some(super::EngineErrorCategory::Storage));
    assert_eq!(rejoin.operation(), Some("load_group"));
    assert!(rejoin.cause_detail().is_some_and(|cause| !cause.is_empty()));
    assert_eq!(
        engine.open_group("missing-room"),
        Err(EngineError::GroupNotFound)
    );
    engine.forget_corrupt_group("corrupt-room").unwrap();
    assert_eq!(
        engine.open_group("corrupt-room"),
        Err(EngineError::GroupNotFound)
    );
    assert!(engine.forget_corrupt_group("missing-room").is_err());

    let package = engine.generate_key_package().unwrap();
    let mut fresh_host = MlsEngine::new(BasicAppCredential {
        github_user_id: "2".into(),
        device_id: "fresh-host".into(),
    })
    .unwrap();
    fresh_host.create_group("corrupt-room").unwrap();
    let add = fresh_host.add_member("corrupt-room", &package).unwrap();
    fresh_host
        .publish_succeeded("corrupt-room", &add.commit_outbox_id)
        .unwrap();
    assert_eq!(engine.join_welcome("corrupt-room", &add.welcome), Ok(1));
}
