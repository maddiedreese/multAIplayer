use base64::{engine::general_purpose::STANDARD, Engine as _};
use mls_core::{
    generate_device_signing_secret, generate_hpke_key_pair, open, seal,
    ApplicationAuthenticatedDataInput, BasicAppCredential, CapabilityBinding, DeviceAuthSigner,
    ExporterCiphertext, HostTransferAuthorizationPayload, MlsEngine,
};
use serde::Serialize;
use sha2::{Digest, Sha256};

const ROOM: &str = "room-desktop";
const MARKER: &[u8] = b"MLS-PLAINTEXT-MUST-NEVER-REACH-RELAY";

fn application_aad(
    message_id: &str,
    kind: &str,
    user_id: &str,
    device_id: &str,
) -> ApplicationAuthenticatedDataInput {
    ApplicationAuthenticatedDataInput {
        version: 1,
        message_id: message_id.into(),
        team_id: "team-core".into(),
        room_id: ROOM.into(),
        kind: kind.into(),
        sender_user_id: user_id.into(),
        sender_device_id: device_id.into(),
        created_at: "2026-07-12T00:00:00.000Z".into(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceFixture {
    user_id: String,
    device_id: String,
    signature_public_key: String,
    signature_key_fingerprint: String,
    hpke_public_key: String,
    hpke_key_fingerprint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BlobFixture {
    version: u8,
    epoch: u64,
    nonce: String,
    ciphertext: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    host: DeviceFixture,
    next_host: DeviceFixture,
    key_package_id: String,
    key_package_hash: String,
    key_package: String,
    add_commit_id: String,
    add_commit: String,
    welcome: String,
    application_id: String,
    application_epoch: u64,
    application: String,
    sealed_blob: BlobFixture,
    sealed_request: String,
    handoff_commit_id: String,
    handoff_commit: String,
    handoff_parent_epoch: u64,
    host_transfer_authorization: HostTransferAuthorizationPayload,
    host_transfer_signature: String,
    host_transfer_public_key: String,
    removal_commit_id: String,
    removal_commit: String,
    removal_parent_epoch: u64,
    post_removal_application_id: String,
    post_removal_application_epoch: u64,
    post_removal_application: String,
    forbidden_values: Vec<String>,
}

fn device_fixture(
    signer: &DeviceAuthSigner,
    user_id: &str,
    device_id: &str,
    hpke_public_key: &[u8],
) -> Result<DeviceFixture, Box<dyn std::error::Error>> {
    let spki = signer.public_key_spki_der()?;
    let digest = Sha256::digest(&spki);
    let fingerprint = digest
        .chunks(2)
        .map(|chunk| {
            chunk
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join(":");
    let hpke_digest = Sha256::digest(hpke_public_key);
    let hpke_fingerprint = hpke_digest
        .chunks(2)
        .map(|chunk| {
            chunk
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join(":");
    Ok(DeviceFixture {
        user_id: user_id.to_owned(),
        device_id: device_id.to_owned(),
        signature_public_key: STANDARD.encode(spki),
        signature_key_fingerprint: format!("sha256:{fingerprint}"),
        hpke_public_key: STANDARD.encode(hpke_public_key),
        hpke_key_fingerprint: format!("sha256:{hpke_fingerprint}"),
    })
}

fn blob_fixture(value: ExporterCiphertext) -> BlobFixture {
    BlobFixture {
        version: value.version,
        epoch: value.epoch,
        nonce: STANDARD.encode(value.nonce),
        ciphertext: STANDARD.encode(value.ciphertext),
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let host_user = "github:maddiedreese";
    let host_device = "device-scan";
    let next_user = "github:alex";
    let next_device = "device-alex";
    let host_secret = generate_device_signing_secret()?;
    let next_secret = generate_device_signing_secret()?;
    let host_secret_marker = host_secret.clone();
    let next_secret_marker = next_secret.clone();
    let host_signer = DeviceAuthSigner::from_secret(
        host_secret.clone(),
        host_user.to_owned(),
        host_device.to_owned(),
    )?;
    let next_signer = DeviceAuthSigner::from_secret(
        next_secret.clone(),
        next_user.to_owned(),
        next_device.to_owned(),
    )?;
    let mut host = MlsEngine::from_signing_secret(
        BasicAppCredential {
            github_user_id: host_user.to_owned(),
            device_id: host_device.to_owned(),
        },
        host_secret,
    )?;
    let mut next = MlsEngine::from_signing_secret(
        BasicAppCredential {
            github_user_id: next_user.to_owned(),
            device_id: next_device.to_owned(),
        },
        next_secret,
    )?;

    host.create_group(ROOM)?;
    let key_package = next.generate_key_package()?;
    let add = host.add_member(ROOM, &key_package)?;
    host.publish_succeeded(ROOM, &add.commit_outbox_id)?;
    next.join_welcome(ROOM, &add.welcome)?;

    let application = host.encrypt_application(
        ROOM,
        "fixture-application-1",
        MARKER,
        application_aad(
            "fixture-application-1",
            "security.fixture",
            host_user,
            host_device,
        ),
    )?;
    let opened = next
        .process_incoming(ROOM, &application.message)?
        .ok_or("application output missing")?;
    if opened.payload != MARKER {
        return Err("MLS application plaintext mismatch".into());
    }
    host.publish_succeeded(ROOM, &application.outbox_id)?;

    let exporter_marker = host.export_blob_key(ROOM, b"fixture-blob")?;
    let blob = host.encrypt_blob(ROOM, b"fixture-blob", MARKER)?;
    if host.decrypt_blob(ROOM, b"fixture-blob", &blob)? != MARKER {
        return Err("exporter blob plaintext mismatch".into());
    }

    let hpke = generate_hpke_key_pair();
    let next_hpke = generate_hpke_key_pair();
    let binding = CapabilityBinding {
        version: 3,
        phase: "request".to_owned(),
        invite_id: "invite-fixture".to_owned(),
        team_id: "team-core".to_owned(),
        room_id: ROOM.to_owned(),
        key_epoch: application.epoch,
        key_package_hash: format!("sha256:{:x}", Sha256::digest(&key_package)),
        request_id: "request-fixture".to_owned(),
        request_nonce: "fixture-nonce".to_owned(),
        requester_user_id: next_user.to_owned(),
        requester_device_id: next_device.to_owned(),
        host_user_id: host_user.to_owned(),
        host_device_id: host_device.to_owned(),
        expires_at: "2026-07-13T12:00:00.000Z".to_owned(),
        status: None,
        decided_at: None,
    };
    let hpke_aad = serde_json::to_vec(&binding)?;
    let sealed_request = seal(
        hpke.public_key_bytes(),
        b"multaiplayer:invite-request:v2",
        &hpke_aad,
        MARKER,
    )?;
    if open(
        &hpke,
        b"multaiplayer:invite-request:v2",
        &hpke_aad,
        &sealed_request,
    )? != MARKER
    {
        return Err("HPKE plaintext mismatch".into());
    }

    let next_leaf = host
        .roster(ROOM)?
        .into_iter()
        .find(|member| member.credential.device_id == next_device)
        .ok_or("next host missing from roster")?
        .leaf;
    let handoff = host.transfer_host(ROOM, next_leaf, next_device.to_owned())?;
    let authorization = host.host_transfer_authorization(ROOM, &handoff.outbox_id)?;
    let canonical_authorization = serde_json::to_vec(&authorization)?;
    let signed = host_signer.sign_host_transfer(&canonical_authorization)?;
    next.process_incoming(ROOM, &handoff.message)?;
    host.publish_succeeded(ROOM, &handoff.outbox_id)?;

    let host_leaf = next
        .roster(ROOM)?
        .into_iter()
        .find(|member| member.credential.device_id == host_device)
        .ok_or("old host missing from roster")?
        .leaf;
    let removal = next.remove_member(ROOM, host_leaf)?;
    next.publish_succeeded(ROOM, &removal.outbox_id)?;
    let post_removal_marker = b"MLS-REMOVED-MEMBER-MUST-NOT-DECRYPT";
    let post_removal = next.encrypt_application(
        ROOM,
        "fixture-post-removal-1",
        post_removal_marker,
        application_aad(
            "fixture-post-removal-1",
            "security.post-removal",
            next_user,
            next_device,
        ),
    )?;
    if host.process_incoming(ROOM, &post_removal.message).is_ok() {
        return Err("removed member decrypted a post-removal application".into());
    }
    next.publish_succeeded(ROOM, &post_removal.outbox_id)?;
    let forbidden_values = vec![
        STANDARD.encode(host_secret_marker),
        STANDARD.encode(next_secret_marker),
        STANDARD.encode(hpke.private_key_bytes()),
        STANDARD.encode(next_hpke.private_key_bytes()),
        STANDARD.encode(exporter_marker),
    ];

    let fixture = Fixture {
        host: device_fixture(
            &host_signer,
            host_user,
            host_device,
            hpke.public_key_bytes(),
        )?,
        next_host: device_fixture(
            &next_signer,
            next_user,
            next_device,
            next_hpke.public_key_bytes(),
        )?,
        key_package_id: "key-package-fixture".to_owned(),
        key_package_hash: format!("sha256:{:x}", Sha256::digest(&key_package)),
        key_package: STANDARD.encode(key_package),
        add_commit_id: add.commit_outbox_id,
        add_commit: STANDARD.encode(add.commit),
        welcome: STANDARD.encode(add.welcome),
        application_id: application.outbox_id,
        application_epoch: application.epoch,
        application: STANDARD.encode(application.message),
        sealed_blob: blob_fixture(blob),
        sealed_request: serde_json::to_string(&sealed_request)?,
        handoff_commit_id: handoff.outbox_id,
        handoff_commit: STANDARD.encode(handoff.message),
        handoff_parent_epoch: handoff.parent_epoch,
        host_transfer_authorization: authorization,
        host_transfer_signature: STANDARD.encode(signed.signature_der),
        host_transfer_public_key: STANDARD.encode(signed.public_key_spki_der),
        removal_commit_id: removal.outbox_id,
        removal_commit: STANDARD.encode(removal.message),
        removal_parent_epoch: removal.parent_epoch,
        post_removal_application_id: post_removal.outbox_id,
        post_removal_application_epoch: post_removal.epoch,
        post_removal_application: STANDARD.encode(post_removal.message),
        forbidden_values,
    };
    println!("{}", serde_json::to_string(&fixture)?);
    Ok(())
}
