#[cfg(debug_assertions)]
mod debug_client {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use mls_core::ApplicationAuthenticatedDataInput;
    use multaiplayer_cli::{
        chat::{ProjectedEvent, RenderMode, TerminalRenderer},
        codex::{CodexProposal, ProposalMachine},
        identity::load_or_create_identity,
        invite::interoperability_persist_completed_admission_association,
        mls::MlsClientService,
        platform::JourneyFileStore,
        relay::WorkspaceSnapshot,
        room::{interoperability_validate_cli_host_role, RoomBackend, RoomError, RoomService},
    };
    use multaiplayer_protocol::{
        CodexQueueAction, CodexQueuePlaintextPayload, RoomEvent, RoomRecord, Validate,
    };
    use serde::Deserialize;
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use std::{
        fs,
        io::{self, BufRead, Write},
        path::PathBuf,
    };

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
        TransferHost {
            next_host_user_id: String,
            next_host_device_id: String,
        },
        AuthorizeTransfer {
            commit_message_id: String,
        },
        GroupSnapshot,
        Encrypt {
            message_id: String,
            payload: String,
            authenticated_data: ApplicationAuthenticatedDataInput,
        },
        Process {
            message: String,
        },
        ApproveProposal {
            proposal: CodexQueuePlaintextPayload,
            now_unix: i64,
        },
        ValidateHostRole {
            created_as_host: bool,
            is_active_host: bool,
        },
        RecordCompletedAdmission {
            relay_origin: String,
            room: RoomRecord,
        },
        OpenJoinedRoom {
            relay_origin: String,
            room: RoomRecord,
        },
    }

    struct Client {
        room_id: String,
        store: JourneyFileStore,
        identity: multaiplayer_cli::identity::DeviceIdentity,
        mls: MlsClientService,
        proposals: ProposalMachine,
    }

    pub fn run() -> Result<(), Box<dyn std::error::Error>> {
        let mut args = std::env::args().skip(1);
        let user_id = args.next().ok_or("user id argument missing")?;
        let display_name = args.next().ok_or("display name argument missing")?;
        let room_id = args.next().ok_or("room id argument missing")?;
        let state_dir = PathBuf::from(args.next().ok_or("state directory argument missing")?);
        if args.next().is_some() {
            return Err("unexpected argument".into());
        }
        fs::create_dir_all(&state_dir)?;
        let store = JourneyFileStore::new(state_dir.join("credentials.json"))?;
        let identity = load_or_create_identity(&store, &user_id, &display_name)?;
        let mls = MlsClientService::open(&store, &identity, &state_dir.join("mls.sqlite"))?;
        let proposals = ProposalMachine::new(&room_id)?;
        let mut client = Client {
            room_id,
            store,
            identity,
            mls,
            proposals,
        };
        write_response(&json!({
            "ok": true,
            "userId": client.identity.public.user_id,
            "deviceId": client.identity.public.device_id,
            "displayName": client.identity.public.display_name,
            "signaturePublicKey": client.identity.public.signature_public_key,
            "signatureKeyFingerprint": client.identity.public.signature_key_fingerprint,
            "hpkePublicKey": client.identity.public.hpke_public_key,
            "hpkeKeyFingerprint": client.identity.public.hpke_key_fingerprint,
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
                    self.proposals = ProposalMachine::new(&room_id)?;
                    self.room_id = room_id;
                    Ok(Value::Null)
                }
                Command::SignChallenge { challenge } => {
                    let signature = self.identity.signer.sign(&decode(&challenge)?)?;
                    Ok(json!({
                        "signature": STANDARD.encode(signature.signature_der),
                        "publicKey": STANDARD.encode(signature.public_key_spki_der),
                    }))
                }
                Command::CreateGroup => {
                    Ok(json!({ "epoch": self.mls.create_group_idempotent(&self.room_id)? }))
                }
                Command::GenerateKeyPackage => {
                    let key_package = self.mls.interoperability_generate_key_package()?;
                    Ok(json!({
                        "keyPackage": STANDARD.encode(&key_package),
                        "keyPackageHash": format!("sha256:{:x}", Sha256::digest(&key_package)),
                    }))
                }
                Command::AddMember { key_package } => {
                    let output = self
                        .mls
                        .interoperability_add_member(&self.room_id, &decode(&key_package)?)?;
                    Ok(json!({
                        "commit": STANDARD.encode(output.commit),
                        "commitOutboxId": output.commit_outbox_id,
                        "parentEpoch": output.epoch - 1,
                        "welcome": STANDARD.encode(output.welcome),
                    }))
                }
                Command::JoinWelcome { welcome } => Ok(json!({
                    "epoch": self
                        .mls
                        .interoperability_join_welcome(&self.room_id, &decode(&welcome)?)?,
                })),
                Command::PublishSucceeded { message_id } => Ok(json!({
                    "epoch": self
                        .mls
                        .interoperability_publish_succeeded(&self.room_id, &message_id)?,
                })),
                Command::TransferHost {
                    next_host_user_id,
                    next_host_device_id,
                } => {
                    let output = self.mls.interoperability_transfer_host(
                        &self.room_id,
                        &next_host_user_id,
                        &next_host_device_id,
                        "integration-handoff",
                    )?;
                    Ok(
                        json!({ "message": STANDARD.encode(output.message), "messageId": output.outbox_id, "parentEpoch": output.parent_epoch }),
                    )
                }
                Command::AuthorizeTransfer { commit_message_id } => {
                    let (authorization, signature) =
                        self.mls.interoperability_authorize_host_transfer(
                            &self.room_id,
                            &commit_message_id,
                        )?;
                    Ok(
                        json!({ "authorization": authorization, "signature": STANDARD.encode(signature.signature_der), "publicKey": STANDARD.encode(signature.public_key_spki_der) }),
                    )
                }
                Command::GroupSnapshot => {
                    let state = self.mls.group_snapshot(&self.room_id)?;
                    Ok(
                        json!({ "epoch": state.epoch, "hostLeaf": state.host_leaf, "hostDeviceId": state.host_device_id, "hostTransferId": state.host_transfer_id }),
                    )
                }
                Command::Encrypt {
                    message_id,
                    payload,
                    authenticated_data,
                } => {
                    let output = self.mls.interoperability_encrypt_application(
                        &self.room_id,
                        &message_id,
                        payload.as_bytes(),
                        authenticated_data,
                    )?;
                    Ok(json!({
                        "message": STANDARD.encode(output.message),
                        "messageId": output.outbox_id,
                        "epoch": output.epoch,
                    }))
                }
                Command::Process { message } => {
                    let Some(output) = self
                        .mls
                        .process_incoming(&self.room_id, &decode(&message)?)?
                    else {
                        return Ok(Value::Null);
                    };
                    let plaintext: Value = serde_json::from_slice(&output.payload)?;
                    let room_event =
                        RoomEvent::parse(&output.authenticated_data.kind, plaintext.clone())?;
                    let unsupported = match room_event {
                        RoomEvent::Unsupported { kind } => {
                            let projected = ProjectedEvent::Unsupported { kind };
                            Some(TerminalRenderer::new(RenderMode::Plain).render(&projected))
                        }
                        _ => None,
                    };
                    Ok(json!({
                        "payload": plaintext,
                        "authenticatedData": output.authenticated_data,
                        "unsupportedRendering": unsupported,
                    }))
                }
                Command::ApproveProposal { proposal, now_unix } => {
                    proposal.validate()?;
                    if proposal.action != CodexQueueAction::Queued {
                        return Err("only queued proposals can be approved".into());
                    }
                    let task = proposal.reason.clone().ok_or("proposal task is missing")?;
                    self.proposals.observe(
                        CodexProposal {
                            room_id: self.room_id.clone(),
                            proposal_id: proposal.turn_id.clone(),
                            proposer: proposal.requested_by,
                            proposer_user_id: proposal.requested_by_user_id,
                            task,
                            created_at: proposal.created_at,
                            expires_at_unix: now_unix + 300,
                        },
                        now_unix,
                    )?;
                    self.proposals
                        .approve(&self.room_id, &proposal.turn_id, now_unix, true)?;
                    self.proposals
                        .start(&self.room_id, &proposal.turn_id, true)?;
                    Ok(json!({ "phase": format!("{:?}", self.proposals.phase()) }))
                }
                Command::ValidateHostRole {
                    created_as_host,
                    is_active_host,
                } => {
                    interoperability_validate_cli_host_role(created_as_host, is_active_host)?;
                    Ok(Value::Null)
                }
                Command::RecordCompletedAdmission { relay_origin, room } => {
                    interoperability_persist_completed_admission_association(
                        &self.store,
                        &self.identity,
                        &relay_origin,
                        &room,
                    )?;
                    Ok(Value::Null)
                }
                Command::OpenJoinedRoom { relay_origin, room } => {
                    let mut backend = JourneyRoomBackend { room };
                    let mut service = RoomService::new(
                        &self.store,
                        &mut backend,
                        &mut self.mls,
                        &self.identity.public.user_id,
                        &self.identity.public.device_id,
                        &relay_origin,
                    );
                    let opened = service.open(&self.room_id)?;
                    let project_path = service.local_project_path(&self.room_id)?;
                    Ok(json!({
                        "roomId": opened.room.id,
                        "isActiveHost": opened.is_active_host,
                        "projectPath": project_path,
                    }))
                }
            }
        }
    }

    struct JourneyRoomBackend {
        room: RoomRecord,
    }

    impl RoomBackend for JourneyRoomBackend {
        fn workspace(&mut self) -> Result<WorkspaceSnapshot, RoomError> {
            Ok(WorkspaceSnapshot {
                teams: Vec::new(),
                rooms: vec![self.room.clone()],
            })
        }

        fn create_room(&mut self, _team_id: &str, _name: &str) -> Result<RoomRecord, RoomError> {
            Err(RoomError::RelayUnavailable)
        }

        fn establish_device_session(&mut self) -> Result<zeroize::Zeroizing<String>, RoomError> {
            Err(RoomError::RelayUnavailable)
        }

        fn join_room(
            &mut self,
            _room: &RoomRecord,
            _device_session: &str,
        ) -> Result<(), RoomError> {
            Err(RoomError::RelayUnavailable)
        }

        fn activate_host(
            &mut self,
            _room: &RoomRecord,
            _device_session: &str,
        ) -> Result<RoomRecord, RoomError> {
            Err(RoomError::RelayUnavailable)
        }
    }

    fn decode(value: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let decoded = STANDARD.decode(value)?;
        if STANDARD.encode(&decoded) != value {
            return Err("base64 is not canonical padded encoding".into());
        }
        Ok(decoded)
    }

    fn write_response(value: &Value) -> io::Result<()> {
        let mut stdout = io::stdout().lock();
        serde_json::to_writer(&mut stdout, value)?;
        stdout.write_all(b"\n")?;
        stdout.flush()
    }
}

#[cfg(debug_assertions)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    debug_client::run()
}

#[cfg(not(debug_assertions))]
fn main() {
    eprintln!("The interoperability client is available only in debug test builds.");
    std::process::exit(2);
}
