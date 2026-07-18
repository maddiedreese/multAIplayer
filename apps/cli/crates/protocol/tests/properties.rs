use multaiplayer_protocol::*;
use proptest::prelude::*;
use serde_json::{json, Value};

const AT: &str = "2026-07-18T12:34:56.000Z";

fn room(name: String) -> Value {
    json!({
        "id": "room-1",
        "teamId": "team-1",
        "name": name,
        "host": "Host",
        "hostUserId": "user-1",
        "activeHostDeviceId": "device-1",
        "hostStatus": "active",
        "approvalPolicy": "ask_every_turn"
    })
}

fn mls_message() -> Value {
    json!({
        "id": "message-1",
        "teamId": "team-1",
        "roomId": "room-1",
        "senderDeviceId": "device-1",
        "senderUserId": "user-1",
        "createdAt": AT,
        "messageType": "application",
        "epochHint": 0,
        "mlsMessage": "AA=="
    })
}

proptest! {
    #[test]
    fn room_name_bounds_count_javascript_utf16_code_units(length in 0usize..220) {
        let name = "😀".repeat(length);
        let json = room(name).to_string();
        prop_assert_eq!(from_json::<RoomRecord>(&json).is_ok(), (1..=80).contains(&length));
    }

    #[test]
    fn oversized_and_boundary_ascii_room_names_match_the_exported_limit(length in 0usize..220) {
        let json = room("r".repeat(length)).to_string();
        prop_assert_eq!(from_json::<RoomRecord>(&json).is_ok(), (1..=160).contains(&length));
    }

    #[test]
    fn arbitrary_unknown_top_level_fields_are_stripped_from_default_zod_objects(
        suffix in "[a-z0-9_]{1,24}",
        value in proptest::collection::vec(any::<u8>(), 0..32)
    ) {
        let key = format!("unknown_{suffix}");
        let mut source = room("Room".into());
        source.as_object_mut().unwrap().insert(key.clone(), json!(value));
        let parsed: RoomRecord = from_json(&source.to_string()).unwrap();
        let encoded = to_json(&parsed).unwrap();
        prop_assert!(!encoded.contains(&key));
    }

    #[test]
    fn malformed_base64_is_rejected(bytes in proptest::collection::vec(any::<u8>(), 1..80)) {
        let candidate = String::from_utf8_lossy(&bytes).into_owned();
        if candidate == "AA==" { return Ok(()); }
        let mut source = mls_message();
        source["mlsMessage"] = json!(candidate);
        let accepted_by_pattern = regex_like_canonical_base64(source["mlsMessage"].as_str().unwrap());
        prop_assert_eq!(from_json::<MlsRelayMessage>(&source.to_string()).is_ok(), accepted_by_pattern);
    }
}

#[test]
fn strict_and_stripping_unknown_field_policies_match_typescript() {
    let mut strict = mls_message();
    strict["unknown"] = json!(true);
    assert!(from_json::<MlsRelayMessage>(&strict.to_string()).is_err());

    let client = json!({
        "type": "join", "teamId": "team-1", "roomId": "room-1", "userId": "user-1",
        "deviceId": "device-1", "unknown": true
    });
    let parsed: RelayClientMessage = from_json(&client.to_string()).unwrap();
    assert!(!to_json(&parsed).unwrap().contains("unknown"));

    assert!(from_json::<RelayServerMessage>(r#"{"type":"future.record"}"#).is_err());
}

#[test]
fn supported_versions_are_exact_and_unknown_versions_fail_closed() {
    let authenticated = json!({
        "version": 1, "epoch": 7, "messageId": "message-1", "teamId": "team-1", "roomId": "room-1",
        "kind": "chat.message", "senderUserId": "user-1", "senderDeviceId": "device-1", "createdAt": AT
    });
    assert!(from_json::<MlsAuthenticatedData>(&authenticated.to_string()).is_ok());
    let mut unsupported = authenticated.clone();
    unsupported["version"] = json!(2);
    assert!(from_json::<MlsAuthenticatedData>(&unsupported.to_string()).is_err());
    unsupported["version"] = json!(1);
    unsupported["downgrade"] = json!(true);
    assert!(from_json::<MlsAuthenticatedData>(&unsupported.to_string()).is_err());

    let mut handoff = mls_message();
    handoff["messageType"] = json!("commit");
    handoff["commitEffect"] = json!("host_handoff");
    handoff["nextHostUserId"] = json!("user-2");
    handoff["nextHostDeviceId"] = json!("device-2");
    handoff["hostTransferAuthorization"] = json!({
        "version": 2, "transferId": "transfer-1", "roomId": "room-1", "commitMessageId": "a".repeat(64),
        "parentEpoch": 7, "outgoingHostUserId": "user-1", "outgoingHostDeviceId": "device-1",
        "nextHostUserId": "user-2", "nextHostDeviceId": "device-2", "nextHostLeaf": 1,
        "signatureDer": "AA==", "publicKeySpkiDer": "AA=="
    });
    assert!(from_json::<MlsRelayMessage>(&handoff.to_string()).is_ok());
    handoff["hostTransferAuthorization"]["version"] = json!(3);
    assert!(from_json::<MlsRelayMessage>(&handoff.to_string()).is_err());

    let binding = json!({
        "version": 3, "phase": "response", "inviteId": "invite-1", "teamId": "team-1", "roomId": "room-1",
        "keyEpoch": 7, "keyPackageHash": format!("sha256:{}", "b".repeat(64)), "requestId": "request-1",
        "requestNonce": "nonce-1", "requesterUserId": "user-2", "requesterDeviceId": "device-2",
        "hostUserId": "user-1", "hostDeviceId": "device-1", "expiresAt": AT, "status": "approved", "decidedAt": AT
    });
    assert!(from_json::<InviteResponseBinding>(&binding.to_string()).is_ok());
    let mut unsupported_binding = binding;
    unsupported_binding["version"] = json!(4);
    assert!(from_json::<InviteResponseBinding>(&unsupported_binding.to_string()).is_err());
}

#[test]
fn malformed_oversized_boundary_and_cross_field_inputs_fail() {
    assert!(from_json::<RoomRecord>("{").is_err());
    assert!(from_json::<RoomRecord>("null").is_err());
    assert!(from_json::<RoomRecord>(&room("r".repeat(160)).to_string()).is_ok());
    assert!(from_json::<RoomRecord>(&room("r".repeat(161)).to_string()).is_err());
    let mut offset_datetime = room("Room".into());
    offset_datetime["archivedAt"] = json!("2026-07-18T12:34:56+00:00");
    assert!(from_json::<RoomRecord>(&offset_datetime.to_string()).is_err());
    let mut explicit_null = room("Room".into());
    explicit_null["archivedAt"] = Value::Null;
    assert!(from_json::<RoomRecord>(&explicit_null.to_string()).is_err());
    explicit_null.as_object_mut().unwrap().remove("archivedAt");
    explicit_null["unknown"] = Value::Null;
    assert!(from_json::<RoomRecord>(&explicit_null.to_string()).is_ok());

    let mut float_integer = room("Room".into());
    float_integer["acceptedMlsEpoch"] = json!(1.0);
    assert!(from_json::<RoomRecord>(&float_integer.to_string()).is_ok());

    let mut incomplete_handoff = mls_message();
    incomplete_handoff["commitEffect"] = json!("host_handoff");
    assert!(from_json::<MlsRelayMessage>(&incomplete_handoff.to_string()).is_err());

    let queue = json!({
        "eventType": "codex.queue", "queueEventId": "queue-1", "turnId": "turn-1", "action": "queued",
        "requestedBy": "Maddie", "requestedByUserId": "user-1", "queueSize": 1, "createdAt": AT
    });
    assert!(from_json::<CodexQueuePlaintextPayload>(&queue.to_string()).is_err());

    let nullable_result = json!({
        "eventType": "terminal.result", "requestId": "request-1", "command": "true", "cwd": "/tmp/project",
        "exitStatus": null, "stdout": "", "stderr": "", "ranBy": "Maddie", "ranByUserId": "user-1",
        "startedAt": AT, "finishedAt": AT
    });
    assert!(from_json::<TerminalResultPlaintextPayload>(&nullable_result.to_string()).is_ok());
    let mut missing_nullable = nullable_result;
    missing_nullable
        .as_object_mut()
        .unwrap()
        .remove("exitStatus");
    assert!(from_json::<TerminalResultPlaintextPayload>(&missing_nullable.to_string()).is_err());
}

#[test]
fn unknown_room_kinds_degrade_without_retaining_untrusted_payloads() {
    let payload = json!({ "secret": "must not be retained", "nested": [1, 2, 3] });
    assert_eq!(
        RoomEvent::parse("future.desktop.event", payload).unwrap(),
        RoomEvent::Unsupported {
            kind: "future.desktop.event".into()
        }
    );
    assert!(RoomEvent::parse(&"x".repeat(129), json!({})).is_err());
    assert!(
        RoomEvent::parse("chat.message", json!({ "body": "missing required fields" })).is_err()
    );
}

fn regex_like_canonical_base64(value: &str) -> bool {
    if value.len() < 4 || !value.is_ascii() || value.len() % 4 != 0 {
        return false;
    }
    let bytes = value.as_bytes();
    let padding = if value.ends_with("==") {
        2
    } else if value.ends_with('=') {
        1
    } else {
        0
    };
    bytes[..bytes.len() - padding]
        .iter()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/'))
        && bytes[bytes.len() - padding..]
            .iter()
            .all(|byte| *byte == b'=')
        && match padding {
            0 => true,
            1 => bytes.len() >= 4,
            2 => bytes.len() >= 4,
            _ => false,
        }
}
