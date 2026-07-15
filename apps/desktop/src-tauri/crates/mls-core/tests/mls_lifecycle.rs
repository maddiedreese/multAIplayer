use mls_core::{crypto_provider, MLS_CIPHERSUITE};
use mls_core::{
    ApplicationAuthenticatedData, ApplicationAuthenticatedDataInput, BasicAppCredential,
    CapabilityBinding, EncryptedStore, EngineError, JoinAdmissionMetadata, MlsEngine,
    OutboxMetadata, WelcomeRetryMetadata,
};
use mls_rs::{
    extension::ExtensionType,
    identity::{
        basic::{BasicCredential, BasicIdentityProvider},
        SigningIdentity,
    },
    CipherSuiteProvider, Client, CryptoProvider, Extension, ExtensionList, MlsMessage,
};

fn engine(user: &str, device: &str) -> MlsEngine {
    MlsEngine::new(BasicAppCredential {
        github_user_id: user.into(),
        device_id: device.into(),
    })
    .unwrap()
}

fn application_aad(room_id: &str, message_id: &str) -> ApplicationAuthenticatedDataInput {
    ApplicationAuthenticatedDataInput {
        version: 1,
        message_id: message_id.into(),
        team_id: "team-1".into(),
        room_id: room_id.into(),
        kind: "chat".into(),
        sender_user_id: "1".into(),
        sender_device_id: "alice-mac".into(),
        created_at: "2026-07-12T00:00:00.000Z".into(),
    }
}

#[test]
fn three_client_lifecycle_enforces_authority_and_epoch_exclusion() {
    let mut alice = engine("1", "alice-mac");
    let mut bob = engine("2", "bob-mac");
    let mut carol = engine("3", "carol-mac");

    alice.create_group("room-1").unwrap();
    let pre_join_history = alice
        .encrypt_history("room-1", b"epoch-zero-history")
        .unwrap();
    let pre_join_blob = alice
        .encrypt_blob("room-1", b"draft-blob", b"epoch-zero-blob")
        .unwrap();
    let bob_add = alice
        .add_member("room-1", &bob.generate_key_package().unwrap())
        .unwrap();
    alice
        .publish_succeeded("room-1", &bob_add.commit_outbox_id)
        .unwrap();
    bob.join_welcome("room-1", &bob_add.welcome).unwrap();
    assert_eq!(
        alice.decrypt_history("room-1", &pre_join_history).unwrap(),
        b"epoch-zero-history"
    );
    assert!(bob.decrypt_history("room-1", &pre_join_history).is_err());
    assert_eq!(
        alice
            .decrypt_blob("room-1", b"draft-blob", &pre_join_blob)
            .unwrap(),
        b"epoch-zero-blob"
    );
    assert!(alice
        .decrypt_blob("room-1", b"other-blob", &pre_join_blob)
        .is_err());
    assert!(bob
        .decrypt_blob("room-1", b"draft-blob", &pre_join_blob)
        .is_err());

    let carol_add = alice
        .add_member("room-1", &carol.generate_key_package().unwrap())
        .unwrap();
    alice
        .publish_succeeded("room-1", &carol_add.commit_outbox_id)
        .unwrap();
    bob.process_incoming("room-1", &carol_add.commit).unwrap();
    carol.join_welcome("room-1", &carol_add.welcome).unwrap();
    assert_eq!(alice.roster("room-1").unwrap().len(), 3);
    assert_eq!(bob.self_leaf("room-1").unwrap(), 1);
    assert!(matches!(
        bob.remove_member("room-1", 2),
        Err(EngineError::NotHost)
    ));

    let chat = alice
        .encrypt_application(
            "room-1",
            "chat-1",
            b"hello",
            application_aad("room-1", "chat-1"),
        )
        .unwrap();
    let received = carol
        .process_incoming("room-1", &chat.message)
        .unwrap()
        .unwrap();
    assert_eq!(received.payload, b"hello");
    let received_aad: ApplicationAuthenticatedData =
        serde_json::from_slice(&received.authenticated_data).unwrap();
    assert_eq!(received_aad.epoch, chat.epoch);
    assert_eq!(received_aad.message_id, "chat-1");
    alice.publish_succeeded("room-1", &chat.outbox_id).unwrap();
    assert_eq!(
        alice.export_blob_key("room-1", b"blob-1").unwrap(),
        bob.export_blob_key("room-1", b"blob-1").unwrap()
    );

    let handoff = alice
        .transfer_host("room-1", 1, "bob-mac".into(), "handoff-1".into())
        .unwrap();
    let authorization = alice
        .host_transfer_authorization("room-1", &handoff.outbox_id)
        .unwrap();
    assert_eq!(authorization.commit_message_id, handoff.outbox_id);
    assert_eq!(authorization.parent_epoch, handoff.parent_epoch);
    assert_eq!(authorization.outgoing_host_device_id, "alice-mac");
    assert_eq!(authorization.next_host_device_id, "bob-mac");
    assert!(alice
        .host_transfer_authorization("room-1", &"0".repeat(64))
        .is_err());
    alice
        .publish_succeeded("room-1", &handoff.outbox_id)
        .unwrap();
    bob.process_incoming("room-1", &handoff.message).unwrap();
    carol.process_incoming("room-1", &handoff.message).unwrap();
    assert!(matches!(
        alice.remove_member("room-1", 2),
        Err(EngineError::NotHost)
    ));

    let removal = bob.remove_member("room-1", 2).unwrap();
    bob.publish_succeeded("room-1", &removal.outbox_id).unwrap();
    alice.process_incoming("room-1", &removal.message).unwrap();
    carol.process_incoming("room-1", &removal.message).unwrap();
    let post_remove = bob
        .encrypt_application(
            "room-1",
            "post-remove-1",
            b"excluded",
            application_aad("room-1", "post-remove-1"),
        )
        .unwrap();
    assert!(carol
        .process_incoming("room-1", &post_remove.message)
        .is_err());
    let received = alice
        .process_incoming("room-1", &post_remove.message)
        .unwrap()
        .unwrap();
    assert_eq!(received.payload, b"excluded");
}

#[test]
fn sqlcipher_group_reopens_with_same_identity_and_rejects_wrong_key() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("mls.db");
    let credential = BasicAppCredential {
        github_user_id: "1".into(),
        device_id: "alice-mac".into(),
    };
    let secret = mls_core::generate_device_signing_secret().unwrap();
    let mut first =
        MlsEngine::open_persistent(credential.clone(), secret.clone(), &path, [9; 32]).unwrap();
    assert_eq!(first.create_group("durable-room").unwrap(), 0);
    let outbound = first
        .encrypt_application(
            "durable-room",
            "restart-message-1",
            b"retry-after-restart",
            application_aad("durable-room", "restart-message-1"),
        )
        .unwrap();
    assert_eq!(outbound.outbox_id, "restart-message-1");
    assert!(first
        .encrypt_application(
            "durable-room",
            "restart-message-1",
            b"different-plaintext",
            application_aad("durable-room", "restart-message-1"),
        )
        .is_err());
    assert!(first
        .encrypt_application(
            "durable-room",
            "invalid id",
            b"payload",
            application_aad("durable-room", "invalid id"),
        )
        .is_err());
    assert_eq!(
        first
            .process_incoming("durable-room", &outbound.message)
            .unwrap(),
        None
    );
    assert_eq!(first.current_epoch("durable-room").unwrap(), 0);
    drop(first);
    let outbox = EncryptedStore::open(&path, [9; 32])
        .unwrap()
        .pending_outbox()
        .unwrap();
    assert_eq!(outbox.len(), 1);
    assert_eq!(outbox[0].payload, outbound.message);
    assert_eq!(outbox[0].id, outbound.outbox_id);
    assert_eq!(outbox[0].epoch, outbound.epoch);
    assert_eq!(
        serde_json::from_slice::<OutboxMetadata>(outbox[0].metadata.as_deref().unwrap()).unwrap(),
        OutboxMetadata::Application {
            authenticated_data: outbound.authenticated_data.clone()
        }
    );
    let mut reopened =
        MlsEngine::open_persistent(credential.clone(), secret.clone(), &path, [9; 32]).unwrap();
    assert_eq!(reopened.open_group("durable-room").unwrap(), 0);
    assert_eq!(reopened.self_leaf("durable-room").unwrap(), 0);
    reopened
        .publish_succeeded("durable-room", "restart-message-1")
        .unwrap();
    assert!(EncryptedStore::open(&path, [9; 32])
        .unwrap()
        .pending_outbox()
        .unwrap()
        .is_empty());
    drop(reopened);
    assert!(MlsEngine::open_persistent(credential, secret, &path, [8; 32]).is_err());
    let bytes = std::fs::read(path).unwrap();
    assert!(!bytes
        .windows(b"alice-mac".len())
        .any(|window| window == b"alice-mac"));
}

#[test]
fn history_retention_policy_persists_across_epochs_restart_and_policy_change() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history-policy.db");
    let credential = BasicAppCredential {
        github_user_id: "1".into(),
        device_id: "history-host".into(),
    };
    let secret = mls_core::generate_device_signing_secret().unwrap();
    let mut host =
        MlsEngine::open_persistent(credential.clone(), secret.clone(), &path, [19; 32]).unwrap();
    host.create_group("history-policy-room").unwrap();
    assert_eq!(
        host.history_retention_days("history-policy-room").unwrap(),
        30
    );
    host.set_history_retention("history-policy-room", 7)
        .unwrap();
    let epoch_zero = host
        .encrypt_history("history-policy-room", b"epoch-zero")
        .unwrap();
    let joiner = engine("2", "history-joiner");
    let add = host
        .add_member(
            "history-policy-room",
            &joiner.generate_key_package().unwrap(),
        )
        .unwrap();
    host.publish_succeeded("history-policy-room", &add.commit_outbox_id)
        .unwrap();
    let epoch_one = host
        .encrypt_history("history-policy-room", b"epoch-one")
        .unwrap();
    drop(host);

    let mut reopened = MlsEngine::open_persistent(credential, secret, &path, [19; 32]).unwrap();
    reopened.open_group("history-policy-room").unwrap();
    assert_eq!(
        reopened
            .history_retention_days("history-policy-room")
            .unwrap(),
        7
    );
    assert_eq!(
        reopened
            .decrypt_history("history-policy-room", &epoch_zero)
            .unwrap(),
        b"epoch-zero"
    );
    assert_eq!(
        reopened
            .decrypt_history("history-policy-room", &epoch_one)
            .unwrap(),
        b"epoch-one"
    );
    reopened
        .set_history_retention("history-policy-room", 14)
        .unwrap();
    assert_eq!(
        reopened
            .history_retention_days("history-policy-room")
            .unwrap(),
        14
    );
    assert!(reopened
        .set_history_retention("history-policy-room", 0)
        .is_err());
}

#[test]
fn invite_approval_receipt_and_welcome_routing_survive_crash_before_cleanup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("mls.db");
    let key = [21; 32];
    let credential = BasicAppCredential {
        github_user_id: "1".into(),
        device_id: "alice-mac".into(),
    };
    let secret = mls_core::generate_device_signing_secret().unwrap();
    let joiner = engine("2", "bob-mac");
    let key_package = joiner.generate_key_package().unwrap();
    let metadata = WelcomeRetryMetadata {
        invite_id: "invite-1".into(),
        request_id: "request-1".into(),
        requester_user_id: "2".into(),
        requester_device_id: "bob-mac".into(),
        key_package_id: "kp-1".into(),
        key_package_hash: "sha256:bound-package".into(),
        response_binding: CapabilityBinding {
            version: 3,
            phase: "response".into(),
            invite_id: "invite-1".into(),
            team_id: "team-1".into(),
            room_id: "room-1".into(),
            key_epoch: 0,
            key_package_hash: "sha256:bound-package".into(),
            request_id: "request-1".into(),
            request_nonce: "nonce-1".into(),
            requester_user_id: "2".into(),
            requester_device_id: "bob-mac".into(),
            host_user_id: "1".into(),
            host_device_id: "alice-mac".into(),
            expires_at: "2030-01-01T00:00:00Z".into(),
            status: Some("approved".into()),
            decided_at: Some("2026-07-12T00:00:00Z".into()),
        },
        response_mac: "public-authenticator".into(),
    };
    let mut host =
        MlsEngine::open_persistent(credential.clone(), secret.clone(), &path, key).unwrap();
    host.create_group("room-1").unwrap();
    let output = host
        .add_member_for_invite(
            "room-1",
            &key_package,
            metadata.clone(),
            "cap-handle".into(),
            "a".repeat(64),
        )
        .unwrap();
    drop(host); // Simulates termination before Keychain verifier cleanup or network send.

    let mut reopened = MlsEngine::open_persistent(credential, secret, &path, key).unwrap();
    reopened.open_group("room-1").unwrap();
    let receipt = reopened.invite_receipt("cap-handle").unwrap().unwrap();
    assert_eq!(receipt.commit_outbox_id, output.commit_outbox_id);
    assert_eq!(receipt.welcome_outbox_id, output.welcome_outbox_id);
    let outbox = EncryptedStore::open(&path, key)
        .unwrap()
        .pending_outbox()
        .unwrap();
    let welcome = outbox
        .iter()
        .find(|item| item.id == receipt.welcome_outbox_id)
        .unwrap();
    assert_eq!(welcome.payload, output.welcome);
    assert_eq!(
        serde_json::from_slice::<OutboxMetadata>(welcome.metadata.as_deref().unwrap()).unwrap(),
        OutboxMetadata::Welcome(metadata.clone())
    );
    assert_eq!(
        reopened.invite_receipt("cap-handle").unwrap().unwrap(),
        receipt
    );
    reopened
        .clear_pending_commit("room-1", &output.commit_outbox_id)
        .unwrap();
    assert!(reopened.invite_receipt("cap-handle").unwrap().is_none());
    assert!(EncryptedStore::open(&path, key)
        .unwrap()
        .pending_outbox()
        .unwrap()
        .is_empty());
    assert!(reopened
        .add_member_for_invite(
            "room-1",
            &key_package,
            metadata,
            "cap-handle".into(),
            "a".repeat(64),
        )
        .is_ok());
}

#[test]
fn commit_creation_waits_for_durable_application_delivery() {
    let mut host = engine("1", "alice-mac");
    let joiner = engine("2", "bob-mac");
    host.create_group("ordered-room").unwrap();
    let application = host
        .encrypt_application(
            "ordered-room",
            "ordered-message-1",
            b"must-send-first",
            application_aad("ordered-room", "ordered-message-1"),
        )
        .unwrap();
    let key_package = joiner.generate_key_package().unwrap();
    assert!(matches!(
        host.add_member("ordered-room", &key_package),
        Err(EngineError::InvalidInput)
    ));
    host.publish_succeeded("ordered-room", &application.outbox_id)
        .unwrap();
    assert!(host.add_member("ordered-room", &key_package).is_ok());
}

#[test]
fn native_application_aad_uses_atomic_epoch_and_stale_retirement_is_exact() {
    let mut host = engine("1", "alice-mac");
    let joiner = engine("2", "bob-mac");
    host.create_group("aad-room").unwrap();
    let stale = host
        .encrypt_application(
            "aad-room",
            "stale-app-1",
            b"stale",
            application_aad("aad-room", "stale-app-1"),
        )
        .unwrap();
    assert!(host
        .retire_stale_application("other-room", &stale.outbox_id)
        .is_err());
    assert!(host
        .retire_stale_application("aad-room", "missing-app")
        .is_err());
    assert_eq!(
        host.retire_stale_application("aad-room", &stale.outbox_id)
            .unwrap(),
        0
    );
    let add = host
        .add_member("aad-room", &joiner.generate_key_package().unwrap())
        .unwrap();
    assert!(host
        .retire_stale_application("aad-room", &add.commit_outbox_id)
        .is_err());
    host.publish_succeeded("aad-room", &add.commit_outbox_id)
        .unwrap();
    let current = host
        .encrypt_application(
            "aad-room",
            "current-app-1",
            b"current",
            application_aad("aad-room", "current-app-1"),
        )
        .unwrap();
    let aad: ApplicationAuthenticatedData =
        serde_json::from_slice(&current.authenticated_data).unwrap();
    assert_eq!(current.epoch, 1);
    assert_eq!(aad.epoch, current.epoch);
    assert_eq!(aad.message_id, current.outbox_id);
}

#[test]
fn denial_decision_is_one_shot_and_retryable_after_outbox_ack() {
    let mut host = engine("1", "alice-mac");
    let joiner = engine("2", "bob-mac");
    host.create_group("denial-room").unwrap();
    let response_binding = CapabilityBinding {
        version: 3,
        phase: "response".into(),
        invite_id: "invite-denied".into(),
        team_id: "team-1".into(),
        room_id: "denial-room".into(),
        key_epoch: 0,
        key_package_hash: "sha256:package".into(),
        request_id: "request-denied".into(),
        request_nonce: "nonce-denied".into(),
        requester_user_id: "2".into(),
        requester_device_id: "bob-mac".into(),
        host_user_id: "1".into(),
        host_device_id: "alice-mac".into(),
        expires_at: "2030-01-01T00:00:00Z".into(),
        status: Some("denied".into()),
        decided_at: Some("2026-07-12T00:00:00Z".into()),
    };
    let denial_id = host
        .deny_invite(
            "denied-handle".into(),
            "b".repeat(64),
            "sha256:package".into(),
            response_binding.clone(),
            "response-mac".into(),
        )
        .unwrap();
    host.publish_succeeded("denial-room", &denial_id).unwrap();
    let (receipt, binding, mac) = host
        .denied_invite_response("denied-handle")
        .unwrap()
        .unwrap();
    assert_eq!(receipt.response_outbox_id, denial_id);
    assert_eq!(binding, response_binding);
    assert_eq!(mac, "response-mac");
    let welcome_metadata = WelcomeRetryMetadata {
        invite_id: "invite-denied".into(),
        request_id: "request-denied".into(),
        requester_user_id: "2".into(),
        requester_device_id: "bob-mac".into(),
        key_package_id: "kp-denied".into(),
        key_package_hash: "sha256:package".into(),
        response_binding: binding,
        response_mac: mac,
    };
    assert!(host
        .add_member_for_invite(
            "denial-room",
            &joiner.generate_key_package().unwrap(),
            welcome_metadata,
            "denied-handle".into(),
            "b".repeat(64),
        )
        .is_err());
}

#[test]
fn pending_commit_discard_requires_exact_durable_outbox_id_and_allows_retry() {
    let mut alice = engine("1", "alice-discard");
    let bob = engine("2", "bob-discard");
    alice.create_group("discard-room").unwrap();
    let package = bob.generate_key_package().unwrap();
    let first = alice.add_member("discard-room", &package).unwrap();
    assert!(alice
        .publish_succeeded("discard-room", &"0".repeat(64))
        .is_err());
    assert!(alice
        .publish_succeeded("other-room", &first.commit_outbox_id)
        .is_err());
    assert!(alice
        .clear_pending_commit("discard-room", "0".repeat(64).as_str())
        .is_err());
    assert_eq!(
        alice
            .clear_pending_commit("discard-room", &first.commit_outbox_id)
            .unwrap(),
        0
    );
    assert!(alice
        .clear_pending_commit("discard-room", &first.commit_outbox_id)
        .is_err());
    assert!(alice
        .publish_succeeded("discard-room", &first.commit_outbox_id)
        .is_err());
    assert!(alice.add_member("discard-room", &package).is_ok());
}

#[test]
fn welcome_is_bound_to_its_mls_room_id_and_host_cannot_remove_itself() {
    let mut host = engine("1", "room-bound-host");
    let mut joiner = engine("2", "room-bound-joiner");
    host.create_group("bound-room").unwrap();
    assert!(host.remove_member("bound-room", 0).is_err());
    let add = host
        .add_member("bound-room", &joiner.generate_key_package().unwrap())
        .unwrap();
    assert!(joiner.join_welcome("other-room", &add.welcome).is_err());
    assert!(joiner.join_welcome("bound-room", &add.welcome).is_ok());
}

#[test]
fn invite_welcome_acceptance_is_idempotent_and_replay_bound() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("join-retry.db");
    let credential = BasicAppCredential {
        github_user_id: "2".into(),
        device_id: "retry-joiner".into(),
    };
    let secret = mls_core::generate_device_signing_secret().unwrap();
    let mut host = engine("1", "retry-host");
    let mut joiner =
        MlsEngine::open_persistent(credential.clone(), secret.clone(), &path, [25; 32]).unwrap();
    host.create_group("retry-room").unwrap();
    let add = host
        .add_member("retry-room", &joiner.generate_key_package().unwrap())
        .unwrap();
    let exact_hash = "c".repeat(64);
    let admission = JoinAdmissionMetadata {
        invite_id: "retry-invite".into(),
        team_id: "retry-team".into(),
        room_id: "retry-room".into(),
        request_id: "retry-request".into(),
        requester_user_id: "2".into(),
        requester_device_id: "retry-joiner".into(),
    };
    let epoch = joiner
        .join_welcome_for_invite(&add.welcome, admission.clone(), exact_hash.clone())
        .unwrap();
    drop(joiner); // Crash after the atomic group-state/receipt write but before relay ACK.
    let mut joiner = MlsEngine::open_persistent(credential, secret, &path, [25; 32]).unwrap();
    assert_eq!(
        joiner
            .join_welcome_for_invite(&add.welcome, admission.clone(), exact_hash.clone())
            .unwrap(),
        epoch
    );
    assert!(joiner
        .join_welcome_for_invite(&add.welcome, admission, "d".repeat(64))
        .is_err());
    let pending = joiner.pending_join_admissions().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].invite_id, "retry-invite");
    assert_eq!(pending[0].team_id, "retry-team");
    assert!(joiner
        .complete_join_admission("other-room", "retry-request")
        .is_err());
    joiner
        .complete_join_admission("retry-room", "retry-request")
        .unwrap();
    assert!(joiner.pending_join_admissions().unwrap().is_empty());
}

#[test]
fn pending_commit_state_and_two_outbox_records_survive_restart_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("atomic.db");
    let credential = BasicAppCredential {
        github_user_id: "1".into(),
        device_id: "atomic-host".into(),
    };
    let secret = mls_core::generate_device_signing_secret().unwrap();
    let mut host =
        MlsEngine::open_persistent(credential.clone(), secret.clone(), &path, [7; 32]).unwrap();
    host.create_group("atomic-room").unwrap();
    assert!(host.add_member("atomic-room", b"invalid").is_err());
    assert!(EncryptedStore::open(&path, [7; 32])
        .unwrap()
        .pending_outbox()
        .unwrap()
        .is_empty());
    let joiner = engine("2", "atomic-joiner");
    let add = host
        .add_member("atomic-room", &joiner.generate_key_package().unwrap())
        .unwrap();
    assert_eq!(
        host.process_incoming("atomic-room", &add.commit).unwrap(),
        None
    );
    assert_eq!(host.current_epoch("atomic-room").unwrap(), 0);
    drop(host);
    let outbox = EncryptedStore::open(&path, [7; 32])
        .unwrap()
        .pending_outbox()
        .unwrap();
    assert_eq!(outbox.len(), 2);
    assert!(outbox.iter().any(|item| item.id == add.commit_outbox_id));
    assert!(outbox.iter().any(|item| item.id == add.welcome_outbox_id));
    let mut reopened = MlsEngine::open_persistent(credential, secret, &path, [7; 32]).unwrap();
    reopened.open_group("atomic-room").unwrap();
    assert_eq!(
        reopened
            .publish_succeeded("atomic-room", &add.commit_outbox_id)
            .unwrap(),
        1
    );
    let remaining = EncryptedStore::open(&path, [7; 32])
        .unwrap()
        .pending_outbox()
        .unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, add.welcome_outbox_id);
}

#[test]
fn host_transfer_must_name_the_credential_at_the_target_leaf() {
    let mut alice = engine("1", "alice-mac");
    let mut bob = engine("2", "bob-mac");
    alice.create_group("room-2").unwrap();
    let add = alice
        .add_member("room-2", &bob.generate_key_package().unwrap())
        .unwrap();
    alice
        .publish_succeeded("room-2", &add.commit_outbox_id)
        .unwrap();
    bob.join_welcome("room-2", &add.welcome).unwrap();
    assert!(matches!(
        alice.transfer_host("room-2", 1, "mallory-mac".into(), "handoff-2".into()),
        Err(EngineError::InvalidInput)
    ));
}

#[test]
fn duplicate_device_label_cannot_impersonate_the_host_leaf() {
    let mut host = engine("1", "shared-device-label");
    let mut member = engine("2", "shared-device-label");
    host.create_group("duplicate-label-room").unwrap();
    let add = host
        .add_member(
            "duplicate-label-room",
            &member.generate_key_package().unwrap(),
        )
        .unwrap();
    host.publish_succeeded("duplicate-label-room", &add.commit_outbox_id)
        .unwrap();
    member
        .join_welcome("duplicate-label-room", &add.welcome)
        .unwrap();
    assert!(matches!(
        member.remove_member("duplicate-label-room", 0),
        Err(EngineError::NotHost)
    ));
}

fn welcome_with_extensions(joiner_package: &[u8], extensions: ExtensionList) -> Vec<u8> {
    let provider = crypto_provider();
    let suite = provider.cipher_suite_provider(MLS_CIPHERSUITE).unwrap();
    let (secret, public) = suite.signature_key_generate().unwrap();
    let credential = serde_json::to_vec(&BasicAppCredential {
        github_user_id: "raw-host".into(),
        device_id: "raw-host-device".into(),
    })
    .unwrap();
    let client = Client::builder()
        .identity_provider(BasicIdentityProvider::new())
        .crypto_provider(provider)
        .extension_type(ExtensionType::new(0xff01))
        .signing_identity(
            SigningIdentity::new(BasicCredential::new(credential).into_credential(), public),
            secret,
            MLS_CIPHERSUITE,
        )
        .build();
    let mut group = client
        .create_group_with_id(b"bad-room".to_vec(), extensions, Default::default(), None)
        .unwrap();
    let package = MlsMessage::from_bytes(joiner_package).unwrap();
    group
        .commit_builder()
        .add_member(package)
        .unwrap()
        .build()
        .unwrap()
        .welcome_messages[0]
        .to_bytes()
        .unwrap()
}

#[test]
fn welcome_without_mandatory_host_context_is_rejected() {
    let mut joiner = engine("2", "joiner");
    let welcome = welcome_with_extensions(
        &joiner.generate_key_package().unwrap(),
        ExtensionList::default(),
    );
    assert!(matches!(
        joiner.join_welcome("bad-room", &welcome),
        Err(EngineError::InvalidInput)
    ));
}

#[test]
fn welcome_with_malformed_host_context_is_rejected() {
    let mut joiner = engine("2", "joiner-malformed");
    let extensions: ExtensionList = core::iter::once(Extension::new(
        ExtensionType::new(0xff01),
        b"not-json".to_vec(),
    ))
    .collect();
    let welcome = welcome_with_extensions(&joiner.generate_key_package().unwrap(), extensions);
    assert!(matches!(
        joiner.join_welcome("bad-room", &welcome),
        Err(EngineError::InvalidInput)
    ));
}
