use base64::{engine::general_purpose::STANDARD, Engine as _};
use mls_core::{
    generate_device_signing_secret, generate_hpke_key_pair, ApplicationAuthenticatedDataInput,
    BasicAppCredential, DeviceAuthSigner, HpkeKeyPair, MlsEngine,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{self, BufRead, Write};

#[derive(Deserialize)]
#[serde(
    tag = "command",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Command {
    SetRoom {
        room_id: String,
    },
    SignChallenge {
        challenge: String,
    },
    CreateGroup,
    GenerateKeyPackage,
    AddMember {
        key_package: String,
    },
    JoinWelcome {
        welcome: String,
    },
    PublishSucceeded {
        message_id: String,
    },
    Encrypt {
        message_id: String,
        payload: String,
        authenticated_data: ApplicationAuthenticatedDataInput,
    },
    Process {
        message: String,
    },
    TransferHost {
        next_host_user_id: String,
        next_host_device_id: String,
    },
    AuthorizeTransfer {
        commit_message_id: String,
    },
}

struct Client {
    room_id: String,
    engine: MlsEngine,
    signer: DeviceAuthSigner,
    hpke: HpkeKeyPair,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let user_id = args.next().ok_or("user id argument missing")?;
    let device_id = args.next().ok_or("device id argument missing")?;
    let room_id = args.next().unwrap_or_else(|| "room-desktop".to_owned());
    if args.next().is_some() {
        return Err("unexpected argument".into());
    }
    let secret = generate_device_signing_secret()?;
    let signer = DeviceAuthSigner::from_secret(secret.clone(), user_id.clone(), device_id.clone())?;
    let hpke = generate_hpke_key_pair();
    let mut client = Client {
        room_id,
        engine: MlsEngine::from_signing_secret(
            BasicAppCredential {
                github_user_id: user_id.clone(),
                device_id: device_id.clone(),
            },
            secret,
        )?,
        signer,
        hpke,
    };
    write_response(&json!({
        "ok": true,
        "userId": user_id,
        "deviceId": device_id,
        "signaturePublicKey": STANDARD.encode(client.signer.public_key_spki_der()?),
        "signatureKeyFingerprint": fingerprint(&client.signer.public_key_spki_der()?),
        "hpkePublicKey": STANDARD.encode(client.hpke.public_key_bytes()),
        "hpkeKeyFingerprint": fingerprint(client.hpke.public_key_bytes())
    }))?;

    for line in io::stdin().lock().lines() {
        let result = line
            .map_err(|error| error.to_string())
            .and_then(|line| {
                serde_json::from_str::<Command>(&line).map_err(|error| error.to_string())
            })
            .and_then(|command| client.execute(command).map_err(|error| error.to_string()));
        match result {
            Ok(value) => write_response(&json!({ "ok": true, "value": value }))?,
            Err(error) => write_response(&json!({ "ok": false, "error": error }))?,
        }
    }
    Ok(())
}

impl Client {
    fn execute(&mut self, command: Command) -> Result<Value, Box<dyn std::error::Error>> {
        match command {
            Command::SetRoom { room_id } => {
                if room_id.is_empty()
                    || room_id.len() > 160
                    || room_id.chars().any(char::is_control)
                {
                    return Err("invalid room id".into());
                }
                self.room_id = room_id;
                Ok(Value::Null)
            }
            Command::SignChallenge { challenge } => {
                let signature = self.signer.sign(&decode(&challenge)?)?;
                Ok(json!({
                    "signature": STANDARD.encode(signature.signature_der),
                    "publicKey": STANDARD.encode(signature.public_key_spki_der)
                }))
            }
            Command::CreateGroup => {
                Ok(json!({ "epoch": self.engine.create_group(&self.room_id)? }))
            }
            Command::GenerateKeyPackage => {
                let key_package = self.engine.generate_key_package()?;
                Ok(json!({
                    "keyPackage": STANDARD.encode(&key_package),
                    "keyPackageHash": format!("sha256:{:x}", Sha256::digest(&key_package))
                }))
            }
            Command::AddMember { key_package } => {
                let key_package = decode(&key_package)?;
                let output = self.engine.add_member(&self.room_id, &key_package)?;
                Ok(json!({
                    "commit": STANDARD.encode(output.commit),
                    "commitOutboxId": output.commit_outbox_id,
                    "parentEpoch": output.epoch - 1,
                    "welcome": STANDARD.encode(output.welcome)
                }))
            }
            Command::JoinWelcome { welcome } => Ok(json!({
                "epoch": self.engine.join_welcome(&self.room_id, &decode(&welcome)?)?
            })),
            Command::PublishSucceeded { message_id } => {
                self.engine.publish_succeeded(&self.room_id, &message_id)?;
                Ok(Value::Null)
            }
            Command::Encrypt {
                message_id,
                payload,
                authenticated_data,
            } => {
                let output = self.engine.encrypt_application(
                    &self.room_id,
                    &message_id,
                    payload.as_bytes(),
                    authenticated_data,
                )?;
                Ok(json!({
                    "message": STANDARD.encode(output.message),
                    "messageId": output.outbox_id,
                    "epoch": output.epoch
                }))
            }
            Command::Process { message } => {
                let output = self
                    .engine
                    .process_incoming(&self.room_id, &decode(&message)?)?;
                Ok(match output {
                    Some(application) => json!({
                        "epoch": application.epoch,
                        "payload": String::from_utf8(application.payload)?,
                        "authenticatedData": STANDARD.encode(application.authenticated_data)
                    }),
                    None => Value::Null,
                })
            }
            Command::TransferHost {
                next_host_user_id,
                next_host_device_id,
            } => {
                let next = self
                    .engine
                    .roster(&self.room_id)?
                    .into_iter()
                    .find(|member| {
                        member.credential.github_user_id == next_host_user_id
                            && member.credential.device_id == next_host_device_id
                    })
                    .ok_or("next host missing from roster")?;
                let output = self.engine.transfer_host(
                    &self.room_id,
                    next.leaf,
                    next_host_device_id,
                    "integration-handoff".into(),
                )?;
                Ok(json!({
                    "message": STANDARD.encode(output.message),
                    "messageId": output.outbox_id,
                    "parentEpoch": output.parent_epoch
                }))
            }
            Command::AuthorizeTransfer { commit_message_id } => {
                let authorization = self
                    .engine
                    .host_transfer_authorization(&self.room_id, &commit_message_id)?;
                let signature = self
                    .signer
                    .sign_host_transfer(&serde_json::to_vec(&authorization)?)?;
                Ok(json!({
                    "authorization": authorization,
                    "signature": STANDARD.encode(signature.signature_der),
                    "publicKey": STANDARD.encode(signature.public_key_spki_der)
                }))
            }
        }
    }
}

fn decode(value: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let decoded = STANDARD.decode(value)?;
    if STANDARD.encode(&decoded) != value {
        return Err("base64 is not canonical padded encoding".into());
    }
    Ok(decoded)
}

fn fingerprint(value: &[u8]) -> String {
    format!(
        "sha256:{}",
        Sha256::digest(value)
            .chunks(2)
            .map(|chunk| chunk
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>())
            .collect::<Vec<_>>()
            .join(":")
    )
}

fn write_response(value: &Value) -> io::Result<()> {
    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, value)?;
    stdout.write_all(b"\n")?;
    stdout.flush()
}
