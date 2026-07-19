use multaiplayer_cli::{
    auth::{AuthClient, DevicePollResult},
    chat::{RecoveringChatRoomSession, RenderMode, TerminalRenderer},
    codex::{
        build_bounded_context, cancellation_flag, hosted_turn_interaction, probe_codex_process,
        proposal_expiry_from_rfc3339, resolve_turn_settings, run_hosted_turn_with_interaction,
        CodexProposal, CodexTurnSettings, HostPreview, HostedTurnEvent, HostedTurnInteraction,
        HostedTurnRequest, HostedTurnResult, PrivilegedDecision, PrivilegedRequestPrompt,
        ProposalError, ProposalMachine,
    },
    identity::load_or_create_identity,
    invite::{parse_invite_code, InviteError, InviteService, RelayInviteBackend},
    mls::MlsClientService,
    platform::{KeychainStore, MacOsUrlOpener, ReqwestHttpClient},
    relay::{
        ReconnectPolicy, RelayConnector, RetrySleeper, ThreadSleeper, TungsteniteConnector,
        WorkspaceClient, WorkspaceSnapshot,
    },
    room::{opened_room_message, CreateRoomRequest, RelayRoomBackend, RoomService},
    GITHUB_CLIENT_ID, RELAY_HTTP_ORIGIN,
};
use multaiplayer_protocol::{
    ChatPlaintextPayload, CodexEventPlaintextPayload, CodexQueueAction, CodexQueuePlaintextPayload,
    CodexTurnStatus, RoomRecord,
};
use std::{
    collections::BTreeSet,
    io::{BufRead, IsTerminal, Read, Write},
    path::PathBuf,
    process::ExitCode,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, TryRecvError},
        Arc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use zeroize::Zeroizing;

const MAX_INVITE_CODE_BYTES: u64 = 12_288;
const ADMISSION_WAIT_LIMIT: Duration = Duration::from_secs(300);

const HELP: &str = concat!(
    "multAIplayer ",
    env!("CARGO_PKG_VERSION"),
    "\n\n",
    "Usage: multAIplayer [OPTIONS]\n",
    "       multAIplayer auth <COMMAND>\n",
    "       multAIplayer room <COMMAND>\n\n",
    "Auth commands:\n",
    "  login [--open]  Sign in with GitHub's device flow\n",
    "  status          Restore and report the current relay session\n",
    "  logout          Clear auth credentials; retain device and room keys\n\n",
    "Room commands:\n",
    "  list            List authenticated workspace rooms\n",
    "  create --name <NAME> --project <PATH> [--team <TEAM>]\n",
    "                  Create and host a room with a local project\n",
    "  open <ROOM> [--plain]\n",
    "                  Open a locally associated room and enter encrypted chat\n\n",
    "                  In-room: @codex <TASK>, /approve <ID>, /deny <ID>,\n",
    "                  /respond <REQUEST-ID> <JSON>, /quit\n\n",
    "  leave <ROOM>    Leave locally while retaining encrypted room data\n",
    "  forget <ROOM>   Destructively forget local association and history\n",
    "  invite <ROOM>   Create and display a secret invite code\n",
    "  join            Read a secret invite code from stdin and wait for its host\n",
    "  finish <REQUEST-ID>\n",
    "                  Finish a durable pending join after interruption\n",
    "  admissions <ROOM> <INVITE-ID>\n",
    "                  Review requests with an explicit approve/deny prompt\n",
    "  revoke <ROOM>   Revoke outstanding invites for a hosted room\n\n",
    "Options:\n",
    "  -h, --help       Print help\n",
    "  -V, --version    Print version\n",
);
const VERSION: &str = concat!("multAIplayer ", env!("CARGO_PKG_VERSION"), "\n");
const UNSUPPORTED: &str = "error: unsupported arguments\n\nRun 'multAIplayer --help' for usage.\n";

#[derive(Debug, Eq, PartialEq)]
enum Command {
    Help,
    Version,
    AuthLogin { open: bool },
    AuthStatus,
    AuthLogout,
    RoomList,
    RoomCreate(CreateRoomRequest),
    RoomOpen { selector: String, plain: bool },
    RoomLeave { selector: String },
    RoomForget { selector: String },
    RoomInvite { selector: String },
    RoomJoin,
    RoomFinish { request_id: String },
    RoomAdmissions { selector: String, invite_id: String },
    RoomRevoke { selector: String },
}

fn parse_args<I, S>(args: I) -> Result<Command, ()>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let args: Vec<S> = args.into_iter().collect();
    match args.as_slice() {
        [] => Ok(Command::Help),
        [arg] if matches!(arg.as_ref(), "-h" | "--help") => Ok(Command::Help),
        [arg] if matches!(arg.as_ref(), "-V" | "--version") => Ok(Command::Version),
        [auth, login] if auth.as_ref() == "auth" && login.as_ref() == "login" => {
            Ok(Command::AuthLogin { open: false })
        }
        [auth, login, open]
            if auth.as_ref() == "auth"
                && login.as_ref() == "login"
                && open.as_ref() == "--open" =>
        {
            Ok(Command::AuthLogin { open: true })
        }
        [auth, status] if auth.as_ref() == "auth" && status.as_ref() == "status" => {
            Ok(Command::AuthStatus)
        }
        [auth, logout] if auth.as_ref() == "auth" && logout.as_ref() == "logout" => {
            Ok(Command::AuthLogout)
        }
        [room, list] if room.as_ref() == "room" && list.as_ref() == "list" => Ok(Command::RoomList),
        [room, open, selector] if room.as_ref() == "room" && open.as_ref() == "open" => {
            Ok(Command::RoomOpen {
                selector: selector.as_ref().to_owned(),
                plain: false,
            })
        }
        [room, open, selector, plain]
            if room.as_ref() == "room"
                && open.as_ref() == "open"
                && plain.as_ref() == "--plain" =>
        {
            Ok(Command::RoomOpen {
                selector: selector.as_ref().to_owned(),
                plain: true,
            })
        }
        [room, leave, selector] if room.as_ref() == "room" && leave.as_ref() == "leave" => {
            Ok(Command::RoomLeave {
                selector: selector.as_ref().to_owned(),
            })
        }
        [room, forget, selector] if room.as_ref() == "room" && forget.as_ref() == "forget" => {
            Ok(Command::RoomForget {
                selector: selector.as_ref().to_owned(),
            })
        }
        [room, invite, selector] if room.as_ref() == "room" && invite.as_ref() == "invite" => {
            Ok(Command::RoomInvite {
                selector: selector.as_ref().to_owned(),
            })
        }
        [room, join] if room.as_ref() == "room" && join.as_ref() == "join" => Ok(Command::RoomJoin),
        [room, finish, request_id]
            if room.as_ref() == "room"
                && finish.as_ref() == "finish"
                && bounded_cli_token(request_id.as_ref()) =>
        {
            Ok(Command::RoomFinish {
                request_id: request_id.as_ref().to_owned(),
            })
        }
        [room, admissions, selector, invite_id]
            if room.as_ref() == "room"
                && admissions.as_ref() == "admissions"
                && bounded_cli_token(invite_id.as_ref()) =>
        {
            Ok(Command::RoomAdmissions {
                selector: selector.as_ref().to_owned(),
                invite_id: invite_id.as_ref().to_owned(),
            })
        }
        [room, revoke, selector] if room.as_ref() == "room" && revoke.as_ref() == "revoke" => {
            Ok(Command::RoomRevoke {
                selector: selector.as_ref().to_owned(),
            })
        }
        values
            if values.first().is_some_and(|value| value.as_ref() == "room")
                && values
                    .get(1)
                    .is_some_and(|value| value.as_ref() == "create") =>
        {
            parse_room_create(&values[2..])
        }
        _ => Err(()),
    }
}

fn parse_room_create<S: AsRef<str>>(args: &[S]) -> Result<Command, ()> {
    let mut name = None;
    let mut project = None;
    let mut team = None;
    let mut index = 0;
    while index < args.len() {
        let key = args[index].as_ref();
        let value = args.get(index + 1).ok_or(())?.as_ref();
        let target = match key {
            "--name" => &mut name,
            "--project" => &mut project,
            "--team" => &mut team,
            _ => return Err(()),
        };
        if target.is_some() || value.is_empty() {
            return Err(());
        }
        *target = Some(value.to_owned());
        index += 2;
    }
    Ok(Command::RoomCreate(CreateRoomRequest {
        team,
        name: name.ok_or(())?,
        project: project.ok_or(())?,
    }))
}

fn main() -> ExitCode {
    #[cfg(debug_assertions)]
    {
        let debug_args: Vec<_> = std::env::args_os().skip(1).collect();
        if debug_args.len() == 2 && debug_args[0] == "__chat-journey" {
            return run_debug_chat_journey(std::path::Path::new(&debug_args[1]));
        }
    }
    let command = parse_args(
        std::env::args_os()
            .skip(1)
            .map(|arg| arg.to_string_lossy().into_owned()),
    );
    match command {
        Ok(Command::Help) => {
            print!("{HELP}");
            ExitCode::SUCCESS
        }
        Ok(Command::Version) => {
            print!("{VERSION}");
            ExitCode::SUCCESS
        }
        Ok(command @ (Command::AuthLogin { .. } | Command::AuthStatus | Command::AuthLogout)) => {
            run_auth(command)
        }
        Ok(
            command @ (Command::RoomList
            | Command::RoomCreate(_)
            | Command::RoomOpen { .. }
            | Command::RoomLeave { .. }
            | Command::RoomForget { .. }),
        ) => run_room(command),
        Ok(
            command @ (Command::RoomInvite { .. }
            | Command::RoomJoin
            | Command::RoomFinish { .. }
            | Command::RoomAdmissions { .. }
            | Command::RoomRevoke { .. }),
        ) => run_invite(command),
        Err(()) => {
            eprint!("{UNSUPPORTED}");
            ExitCode::from(2)
        }
    }
}

enum RoomLoopDirective {
    Idle,
    Wait,
    Disconnect,
    Send(String),
    Propose(String),
    Approve(String),
    Deny(String),
    Respond(String, serde_json::Value),
    Quit,
}

trait RoomLoopAdapter {
    fn start(&mut self) -> Result<(), ()> {
        Ok(())
    }
    fn directive(&mut self, projected_chat_count: usize) -> Result<RoomLoopDirective, ()>;
    fn emit(&mut self, event: &multaiplayer_cli::chat::ProjectedEvent);
    fn trusted_codex_preview(&mut self, _preview: &HostPreview) {}
    fn trusted_codex_request(&mut self, _request: &PrivilegedRequestPrompt) {}
    fn complete(&self, projected_chat_count: usize) -> Result<bool, ()>;
}

fn drive_room_loop<C: RelayConnector, R: RetrySleeper>(
    chat: &mut RecoveringChatRoomSession<'_, C, R>,
    adapter: &mut impl RoomLoopAdapter,
    mut codex: Option<&mut CodexRoomController>,
) -> Result<(), ()> {
    let mut projected_chat_count = 0;
    let joined_at = utc_timestamp().map_err(|_| ())?;
    let joined = chat.join(&joined_at).map_err(|_| {
        eprintln!("room loop: join failed safely");
    })?;
    for event in joined {
        if matches!(event, multaiplayer_cli::chat::ProjectedEvent::Chat(_)) {
            projected_chat_count += 1;
        }
        emit_room_event(chat, adapter, codex.as_deref_mut(), event)?;
    }
    adapter.start().map_err(|()| {
        eprintln!("room loop: adapter start failed safely");
    })?;
    loop {
        let directive = adapter.directive(projected_chat_count).map_err(|()| {
            eprintln!("room loop: input adapter failed safely");
        })?;
        let poll_after_directive = matches!(
            &directive,
            RoomLoopDirective::Send(_)
                | RoomLoopDirective::Propose(_)
                | RoomLoopDirective::Approve(_)
                | RoomLoopDirective::Deny(_)
                | RoomLoopDirective::Respond(_, _)
        );
        let events = match directive {
            RoomLoopDirective::Quit => {
                chat.leave();
                return Ok(());
            }
            RoomLoopDirective::Send(body) => {
                if body.is_empty() {
                    Vec::new()
                } else {
                    let created_at = utc_timestamp().map_err(|_| ())?;
                    let display_time = created_at.get(11..16).unwrap_or("--:--");
                    let message_id = format!("chat-{}", uuid::Uuid::new_v4());
                    chat.send_chat(&message_id, &body, &created_at, display_time)
                        .map_err(|error| {
                            eprintln!("room loop: encrypted send failed safely: {error:?}");
                        })?
                }
            }
            RoomLoopDirective::Propose(task) => {
                if task.trim().is_empty() {
                    Vec::new()
                } else if codex
                    .as_deref()
                    .is_none_or(|controller| !controller.can_propose())
                {
                    eprintln!("room loop: this room already has a pending proposal or active turn");
                    Vec::new()
                } else {
                    let created_at = utc_timestamp().map_err(|_| ())?;
                    let proposal_id = format!("proposal-{}", uuid::Uuid::new_v4());
                    let envelope_id = format!("queue-{}", uuid::Uuid::new_v4());
                    chat.send_codex_proposal(&envelope_id, &proposal_id, task.trim(), &created_at)
                        .map_err(|_| {
                            eprintln!("room loop: encrypted proposal failed safely");
                        })?
                }
            }
            RoomLoopDirective::Approve(proposal_id) => codex
                .as_deref_mut()
                .ok_or(())?
                .approve(chat, &proposal_id, unix_now())
                .map_err(|_| {
                    eprintln!("room loop: proposal approval failed safely");
                })?,
            RoomLoopDirective::Deny(proposal_id) => codex
                .as_deref_mut()
                .ok_or(())?
                .deny(chat, &proposal_id, unix_now())
                .map_err(|_| {
                    eprintln!("room loop: proposal denial failed safely");
                })?,
            RoomLoopDirective::Respond(request_key, response) => codex
                .as_deref_mut()
                .ok_or(())?
                .respond_privileged(chat, &request_key, PrivilegedDecision::Respond(response))
                .map_err(|_| {
                    eprintln!("room loop: privileged response failed safely");
                })?,
            RoomLoopDirective::Wait => {
                thread::sleep(Duration::from_millis(10));
                Vec::new()
            }
            RoomLoopDirective::Disconnect => {
                chat.leave();
                Vec::new()
            }
            RoomLoopDirective::Idle => {
                let polled_at = utc_timestamp().map_err(|_| ())?;
                chat.poll(Duration::from_millis(100), &polled_at)
                    .map_err(|_| {
                        eprintln!("room loop: relay projection failed safely");
                    })?
            }
        };
        for event in events {
            if matches!(event, multaiplayer_cli::chat::ProjectedEvent::Chat(_)) {
                projected_chat_count += 1;
            }
            emit_room_event(chat, adapter, codex.as_deref_mut(), event)?;
        }
        if poll_after_directive {
            let polled_at = utc_timestamp().map_err(|_| ())?;
            for event in chat
                .poll(Duration::from_millis(1), &polled_at)
                .map_err(|_| {
                    eprintln!("room loop: relay projection failed safely");
                })?
            {
                if matches!(event, multaiplayer_cli::chat::ProjectedEvent::Chat(_)) {
                    projected_chat_count += 1;
                }
                emit_room_event(chat, adapter, codex.as_deref_mut(), event)?;
            }
        }
        if let Some(controller) = codex.as_deref_mut() {
            let events = controller.tick(chat).map_err(|_| {
                eprintln!("room loop: hosted Codex turn failed safely");
            })?;
            for event in events {
                emit_room_event(chat, adapter, Some(controller), event)?;
            }
            if let Some(request) = controller.take_privileged_prompt() {
                adapter.trusted_codex_request(&request);
            }
        }
        if adapter.complete(projected_chat_count).map_err(|()| {
            eprintln!("room loop: completion check failed safely");
        })? {
            chat.leave();
            return Ok(());
        }
    }
}

fn emit_room_event<C: RelayConnector, R: RetrySleeper>(
    chat: &RecoveringChatRoomSession<'_, C, R>,
    adapter: &mut impl RoomLoopAdapter,
    codex: Option<&mut CodexRoomController>,
    event: multaiplayer_cli::chat::ProjectedEvent,
) -> Result<(), ()> {
    if let Some(controller) = codex {
        if let Some(preview) = controller.observe(&event, unix_now(), chat.is_active_host())? {
            adapter.trusted_codex_preview(&preview);
        }
    }
    adapter.emit(&event);
    Ok(())
}

struct InteractiveRoomLoop {
    receiver: mpsc::Receiver<Result<String, std::io::Error>>,
    renderer: TerminalRenderer,
}

impl RoomLoopAdapter for InteractiveRoomLoop {
    fn directive(&mut self, _projected_chat_count: usize) -> Result<RoomLoopDirective, ()> {
        match self.receiver.try_recv() {
            Ok(Ok(line)) if line == "/quit" => Ok(RoomLoopDirective::Quit),
            Ok(Ok(line)) if line.to_ascii_lowercase().starts_with("@codex ") => {
                Ok(RoomLoopDirective::Propose(line[7..].to_owned()))
            }
            Ok(Ok(line)) if line.starts_with("/approve ") => {
                Ok(RoomLoopDirective::Approve(line[9..].trim().to_owned()))
            }
            Ok(Ok(line)) if line.starts_with("/deny ") => {
                Ok(RoomLoopDirective::Deny(line[6..].trim().to_owned()))
            }
            Ok(Ok(line)) if line.starts_with("/respond ") => {
                let remainder = line[9..].trim();
                let (request_key, response) = remainder.split_once(' ').ok_or(())?;
                let response = serde_json::from_str(response).map_err(|_| ())?;
                Ok(RoomLoopDirective::Respond(request_key.to_owned(), response))
            }
            Ok(Ok(line)) => Ok(RoomLoopDirective::Send(line)),
            Ok(Err(_)) | Err(TryRecvError::Disconnected) => Ok(RoomLoopDirective::Quit),
            Err(TryRecvError::Empty) => Ok(RoomLoopDirective::Idle),
        }
    }

    fn emit(&mut self, event: &multaiplayer_cli::chat::ProjectedEvent) {
        println!("{}", self.renderer.render(event));
    }

    fn trusted_codex_preview(&mut self, preview: &HostPreview) {
        eprintln!("{}", self.renderer.trusted_prompt(&preview.trusted_text()));
    }

    fn trusted_codex_request(&mut self, request: &PrivilegedRequestPrompt) {
        eprintln!("{}", self.renderer.trusted_prompt(&request.trusted_text()));
    }

    fn complete(&self, _projected_chat_count: usize) -> Result<bool, ()> {
        Ok(false)
    }
}

struct ActiveHostedTurn {
    proposal_id: String,
    cancelled: Arc<AtomicBool>,
    receiver: mpsc::Receiver<Result<HostedTurnResult, multaiplayer_cli::codex::HostedTurnError>>,
    authority_lost: bool,
    interaction: HostedTurnInteraction,
}

struct CodexRoomController {
    room_id: String,
    room_name: String,
    project_path: PathBuf,
    host_name: String,
    host_user_id: String,
    settings: CodexTurnSettings,
    settings_resolved: bool,
    machine: ProposalMachine,
    current_wire_proposal: Option<CodexQueuePlaintextPayload>,
    previewed_proposal_id: Option<String>,
    history: Vec<ChatPlaintextPayload>,
    participants: BTreeSet<String>,
    previous_thread_id: Option<String>,
    active: Option<ActiveHostedTurn>,
    pending_privileged_request: Option<PrivilegedRequestPrompt>,
    privileged_prompt_ready: bool,
}

impl CodexRoomController {
    fn new(
        room: &RoomRecord,
        project_path: PathBuf,
        host_name: &str,
        host_user_id: &str,
        previous_thread_id: Option<String>,
    ) -> Result<Self, ()> {
        let mut participants = BTreeSet::new();
        participants.insert(host_name.to_owned());
        Ok(Self {
            room_id: room.id.clone(),
            room_name: room.name.clone(),
            project_path,
            host_name: host_name.to_owned(),
            host_user_id: host_user_id.to_owned(),
            settings: CodexTurnSettings::default(),
            settings_resolved: false,
            machine: ProposalMachine::new(&room.id).map_err(|_| ())?,
            current_wire_proposal: None,
            previewed_proposal_id: None,
            history: Vec::new(),
            participants,
            previous_thread_id,
            active: None,
            pending_privileged_request: None,
            privileged_prompt_ready: false,
        })
    }

    fn observe(
        &mut self,
        event: &multaiplayer_cli::chat::ProjectedEvent,
        now_unix: i64,
        active_host: bool,
    ) -> Result<Option<HostPreview>, ()> {
        match event {
            multaiplayer_cli::chat::ProjectedEvent::Chat(chat) => {
                self.participants.insert(chat.author.clone());
                self.history.push(chat.clone());
                if self.history.len() > 100 {
                    self.history.remove(0);
                }
                Ok(None)
            }
            multaiplayer_cli::chat::ProjectedEvent::Presence { display_name, .. } => {
                self.participants.insert(display_name.clone());
                Ok(None)
            }
            multaiplayer_cli::chat::ProjectedEvent::CodexProposal(wire)
                if wire.action == CodexQueueAction::Queued =>
            {
                let Ok(expires_at_unix) = proposal_expiry_from_rfc3339(&wire.created_at, now_unix)
                else {
                    return Ok(None);
                };
                let proposal = CodexProposal {
                    room_id: self.room_id.clone(),
                    proposal_id: wire.turn_id.clone(),
                    proposer: wire.requested_by.clone(),
                    proposer_user_id: wire.requested_by_user_id.clone(),
                    task: wire.reason.clone().ok_or(())?,
                    created_at: wire.created_at.clone(),
                    expires_at_unix,
                };
                let is_new = match self.machine.observe(proposal, now_unix) {
                    Ok(is_new) => is_new,
                    Err(ProposalError::Expired | ProposalError::Busy) => return Ok(None),
                    Err(_) => return Err(()),
                };
                if is_new {
                    self.current_wire_proposal = Some(wire.clone());
                }
                let needs_preview = active_host
                    && self.machine.pending().is_some_and(|pending| {
                        pending.proposal_id == wire.turn_id
                            && self.previewed_proposal_id.as_deref()
                                != Some(pending.proposal_id.as_str())
                    });
                if needs_preview {
                    if !self.settings_resolved {
                        let process = probe_codex_process("codex").map_err(|_| ())?;
                        let cancelled = AtomicBool::new(false);
                        self.settings = resolve_turn_settings(&process, &self.settings, &cancelled)
                            .map_err(|_| ())?;
                        self.settings_resolved = true;
                    }
                    self.previewed_proposal_id = Some(wire.turn_id.clone());
                    self.preview().map(Some)
                } else {
                    Ok(None)
                }
            }
            multaiplayer_cli::chat::ProjectedEvent::CodexProposal(wire)
                if wire.action == CodexQueueAction::Cancelled =>
            {
                if self
                    .machine
                    .pending()
                    .is_some_and(|proposal| proposal.proposal_id == wire.turn_id)
                {
                    let _ = self.machine.cancel(&self.room_id, &wire.turn_id);
                }
                self.current_wire_proposal = None;
                self.previewed_proposal_id = None;
                Ok(None)
            }
            multaiplayer_cli::chat::ProjectedEvent::CodexTurn(turn)
                if turn.status == CodexTurnStatus::Started =>
            {
                self.machine
                    .observe_started(&self.room_id, &turn.turn_id)
                    .map_err(|_| ())?;
                Ok(None)
            }
            multaiplayer_cli::chat::ProjectedEvent::CodexTurn(turn)
                if turn.status == CodexTurnStatus::Completed =>
            {
                self.history.clear();
                Ok(None)
            }
            _ => Ok(None),
        }
    }

    fn can_propose(&self) -> bool {
        self.machine.pending().is_none() && self.active.is_none()
    }

    fn preview(&self) -> Result<HostPreview, ()> {
        let proposal = self.machine.pending().ok_or(())?;
        let context = build_bounded_context(
            proposal,
            &self.history,
            &self.participants.iter().cloned().collect::<Vec<_>>(),
            "auto",
        )
        .map_err(|_| ())?;
        Ok(HostPreview {
            proposal_id: proposal.proposal_id.clone(),
            proposer: proposal.proposer.clone(),
            task: proposal.task.clone(),
            room_name: self.room_name.clone(),
            project_association: "associated on this host device".to_owned(),
            context_extent: context.extent,
            effective_model: self.settings.model.clone(),
            service_tier: self.settings.service_tier().to_owned(),
            reasoning_effort: self.settings.reasoning_label().to_owned(),
            sandbox: self.settings.sandbox_label().to_owned(),
        })
    }

    fn approve<C: RelayConnector, R: RetrySleeper>(
        &mut self,
        chat: &mut RecoveringChatRoomSession<'_, C, R>,
        proposal_id: &str,
        now_unix: i64,
    ) -> Result<Vec<multaiplayer_cli::chat::ProjectedEvent>, ()> {
        if self
            .pending_privileged_request
            .as_ref()
            .is_some_and(|request| request.request_key == proposal_id)
        {
            return self.respond_privileged(chat, proposal_id, PrivilegedDecision::Approve);
        }
        let active_host = chat.is_active_host();
        let approved = self
            .machine
            .approve(&self.room_id, proposal_id, now_unix, active_host)
            .map_err(|_| ())?;
        if !approved {
            return Ok(Vec::new());
        }
        let proposal = self.machine.pending().cloned().ok_or(())?;
        let context = build_bounded_context(
            &proposal,
            &self.history,
            &self.participants.iter().cloned().collect::<Vec<_>>(),
            "auto",
        )
        .map_err(|_| ())?;
        self.machine
            .start(&self.room_id, proposal_id, chat.is_active_host())
            .map_err(|_| ())?;

        let created_at = utc_timestamp().map_err(|_| ())?;
        let started = CodexEventPlaintextPayload {
            event_type: "codex.turn".to_owned(),
            turn_id: proposal_id.to_owned(),
            status: CodexTurnStatus::Started,
            message: "Host approved and started the Codex turn.".to_owned(),
            model: self.settings.model.clone(),
            thread_id: self.previous_thread_id.clone(),
            event_name: Some("hosted_turn_started".to_owned()),
            consumed_message_ids: None,
            risk_flags: None,
            host: self.host_name.clone(),
            host_user_id: self.host_user_id.clone(),
            created_at: created_at.clone(),
        };
        let mut projected = chat
            .send_codex_turn(&format!("turn-start-{}", uuid::Uuid::new_v4()), started)
            .map_err(|_| ())?;

        let (sender, receiver) = mpsc::channel();
        let (interaction, mut worker_interaction) = hosted_turn_interaction(
            &self.room_id,
            proposal_id,
            &self.host_name,
            &self.host_user_id,
        )
        .map_err(|_| ())?;
        let cancelled = cancellation_flag();
        let worker_cancelled = cancelled.clone();
        let request = HostedTurnRequest {
            project_path: self.project_path.clone(),
            input: context.input,
            settings: self.settings.clone(),
            previous_thread_id: self.previous_thread_id.clone(),
            timeout: Duration::from_secs(30 * 60),
        };
        thread::spawn(move || {
            let result = probe_codex_process("codex").and_then(|config| {
                run_hosted_turn_with_interaction(
                    &config,
                    &request,
                    &worker_cancelled,
                    &mut worker_interaction,
                )
            });
            let _ = sender.send(result);
        });
        self.active = Some(ActiveHostedTurn {
            proposal_id: proposal_id.to_owned(),
            cancelled,
            receiver,
            authority_lost: false,
            interaction,
        });
        projected.shrink_to_fit();
        Ok(projected)
    }

    fn deny<C: RelayConnector, R: RetrySleeper>(
        &mut self,
        chat: &mut RecoveringChatRoomSession<'_, C, R>,
        proposal_id: &str,
        _now_unix: i64,
    ) -> Result<Vec<multaiplayer_cli::chat::ProjectedEvent>, ()> {
        if self
            .pending_privileged_request
            .as_ref()
            .is_some_and(|request| request.request_key == proposal_id)
        {
            return self.respond_privileged(chat, proposal_id, PrivilegedDecision::Deny);
        }
        if !chat.is_active_host() {
            return Err(());
        }
        let wire = self.current_wire_proposal.clone().ok_or(())?;
        if wire.turn_id != proposal_id {
            return Err(());
        }
        self.machine
            .cancel(&self.room_id, proposal_id)
            .map_err(|_| ())?;
        self.current_wire_proposal = None;
        self.previewed_proposal_id = None;
        let created_at = utc_timestamp().map_err(|_| ())?;
        chat.send_codex_cancelled(
            &format!("queue-cancel-{}", uuid::Uuid::new_v4()),
            &wire,
            "The active host denied this proposal.",
            &created_at,
        )
        .map_err(|_| ())
    }

    fn respond_privileged<C: RelayConnector, R: RetrySleeper>(
        &mut self,
        chat: &RecoveringChatRoomSession<'_, C, R>,
        request_key: &str,
        decision: PrivilegedDecision,
    ) -> Result<Vec<multaiplayer_cli::chat::ProjectedEvent>, ()> {
        let request = self.pending_privileged_request.as_ref().ok_or(())?;
        if request.request_key != request_key || request.room_id != self.room_id {
            return Err(());
        }
        let active_host = chat.is_active_host();
        if !active_host {
            return Err(());
        }
        let response = request.response(decision, active_host).map_err(|_| ())?;
        self.active
            .as_ref()
            .ok_or(())?
            .interaction
            .respond(response)
            .map_err(|_| ())?;
        self.pending_privileged_request = None;
        self.privileged_prompt_ready = false;
        Ok(Vec::new())
    }

    fn take_privileged_prompt(&mut self) -> Option<PrivilegedRequestPrompt> {
        if !self.privileged_prompt_ready {
            return None;
        }
        self.privileged_prompt_ready = false;
        self.pending_privileged_request.clone()
    }

    fn tick<C: RelayConnector, R: RetrySleeper>(
        &mut self,
        chat: &mut RecoveringChatRoomSession<'_, C, R>,
    ) -> Result<Vec<multaiplayer_cli::chat::ProjectedEvent>, ()> {
        let Some(active) = self.active.as_mut() else {
            return Ok(Vec::new());
        };
        let mut projected = Vec::new();
        if !chat.is_active_host() {
            active.authority_lost = true;
            active.cancelled.store(true, Ordering::Release);
            self.pending_privileged_request = None;
            self.privileged_prompt_ready = false;
        }
        loop {
            match active.interaction.try_recv() {
                Ok(HostedTurnEvent::PrivilegedRequest(request)) => {
                    if !chat.is_active_host()
                        || request.room_id != self.room_id
                        || self.pending_privileged_request.is_some()
                    {
                        active.authority_lost = true;
                        active.cancelled.store(true, Ordering::Release);
                        continue;
                    }
                    self.pending_privileged_request = Some(request);
                    self.privileged_prompt_ready = true;
                }
                Ok(HostedTurnEvent::Activity(activity)) => {
                    if !chat.is_active_host() || activity.turn_id != active.proposal_id {
                        active.authority_lost = true;
                        active.cancelled.store(true, Ordering::Release);
                        continue;
                    }
                    projected.extend(
                        chat.send_codex_activity(
                            &format!("activity-{}", uuid::Uuid::new_v4()),
                            *activity,
                        )
                        .map_err(|_| ())?,
                    );
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => break,
            }
        }
        let result = match active.receiver.try_recv() {
            Ok(result) => result,
            Err(TryRecvError::Empty) => return Ok(projected),
            Err(TryRecvError::Disconnected) => {
                Err(multaiplayer_cli::codex::HostedTurnError::Failed)
            }
        };
        let active = self.active.take().ok_or(())?;
        self.pending_privileged_request = None;
        self.privileged_prompt_ready = false;
        if active.authority_lost || !chat.is_active_host() {
            let _ = self.machine.cancel(&self.room_id, &active.proposal_id);
            return Ok(projected);
        }
        let created_at = utc_timestamp().map_err(|_| ())?;
        let display_time = created_at.get(11..16).unwrap_or("--:--");
        match result {
            Ok(result) => {
                projected.extend(
                    chat.send_assistant_message(
                        &format!("assistant-{}", uuid::Uuid::new_v4()),
                        &result.assistant_message,
                        &created_at,
                        display_time,
                    )
                    .map_err(|_| ())?,
                );
                if !chat.is_active_host() {
                    let _ = self.machine.cancel(&self.room_id, &active.proposal_id);
                    return Ok(projected);
                }
                chat.save_codex_thread_id(&result.thread_id)
                    .map_err(|_| ())?;
                let completed = CodexEventPlaintextPayload {
                    event_type: "codex.turn".to_owned(),
                    turn_id: active.proposal_id.clone(),
                    status: CodexTurnStatus::Completed,
                    message: "Codex turn completed.".to_owned(),
                    model: self.settings.model.clone(),
                    thread_id: Some(result.thread_id.clone()),
                    event_name: Some("hosted_turn_completed".to_owned()),
                    consumed_message_ids: None,
                    risk_flags: None,
                    host: self.host_name.clone(),
                    host_user_id: self.host_user_id.clone(),
                    created_at: created_at.clone(),
                };
                projected.extend(
                    chat.send_codex_turn(
                        &format!("turn-complete-{}", uuid::Uuid::new_v4()),
                        completed,
                    )
                    .map_err(|_| ())?,
                );
                self.machine
                    .complete(&self.room_id, &active.proposal_id, chat.is_active_host())
                    .map_err(|_| ())?;
                self.previous_thread_id = Some(result.thread_id);
                self.current_wire_proposal = None;
                self.previewed_proposal_id = None;
                Ok(projected)
            }
            Err(error) => {
                self.machine
                    .fail(&self.room_id, &active.proposal_id)
                    .map_err(|_| ())?;
                self.current_wire_proposal = None;
                self.previewed_proposal_id = None;
                let failed = CodexEventPlaintextPayload {
                    event_type: "codex.turn".to_owned(),
                    turn_id: active.proposal_id,
                    status: CodexTurnStatus::Failed,
                    message: error.to_string(),
                    model: self.settings.model.clone(),
                    thread_id: self.previous_thread_id.clone(),
                    event_name: Some("hosted_turn_failed".to_owned()),
                    consumed_message_ids: None,
                    risk_flags: None,
                    host: self.host_name.clone(),
                    host_user_id: self.host_user_id.clone(),
                    created_at,
                };
                projected.extend(
                    chat.send_codex_turn(&format!("turn-failed-{}", uuid::Uuid::new_v4()), failed)
                        .map_err(|_| ())?,
                );
                Ok(projected)
            }
        }
    }
}

#[cfg(debug_assertions)]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DebugChatJourneyConfig {
    credential_path: PathBuf,
    mls_path: PathBuf,
    websocket_url: String,
    relay_session: String,
    device_session: String,
    room: RoomRecord,
    user_id: String,
    display_name: String,
    role: u8,
    coordination_dir: PathBuf,
    start_gate: PathBuf,
    #[serde(default)]
    delay_reconnect_until: Option<PathBuf>,
    #[serde(default)]
    crash_after_chat_count: Option<usize>,
}

#[cfg(debug_assertions)]
struct DebugJourneyRoomLoop {
    role: u8,
    coordination_dir: PathBuf,
    renderer: TerminalRenderer,
    bodies: Vec<String>,
    sent: bool,
    disconnected: bool,
    start_gate: PathBuf,
    delay_reconnect_until: Option<PathBuf>,
    crash_after_chat_count: Option<usize>,
    deadline: Instant,
}

#[cfg(debug_assertions)]
impl RoomLoopAdapter for DebugJourneyRoomLoop {
    fn start(&mut self) -> Result<(), ()> {
        std::fs::create_dir_all(&self.coordination_dir).map_err(|_| ())?;
        std::fs::write(
            self.coordination_dir.join(format!("ready-{}", self.role)),
            b"ready",
        )
        .map_err(|_| ())?;
        let deadline = Instant::now() + Duration::from_secs(10);
        while (0..3).any(|role| {
            !self
                .coordination_dir
                .join(format!("ready-{role}"))
                .is_file()
        }) {
            if Instant::now() >= deadline {
                return Err(());
            }
            thread::sleep(Duration::from_millis(10));
        }
        Ok(())
    }

    fn directive(&mut self, projected_chat_count: usize) -> Result<RoomLoopDirective, ()> {
        if Instant::now() >= self.deadline {
            return Err(());
        }
        if !self.start_gate.is_file() {
            return Ok(RoomLoopDirective::Wait);
        }
        if !self.disconnected {
            if let Some(path) = &self.delay_reconnect_until {
                if !path.is_file() {
                    return Ok(RoomLoopDirective::Wait);
                }
                self.disconnected = true;
                return Ok(RoomLoopDirective::Disconnect);
            }
        }
        let should_send = !self.sent
            && match self.role {
                0 => projected_chat_count == 0,
                1 => projected_chat_count == 1,
                2 => projected_chat_count == 2,
                _ => return Err(()),
            };
        if should_send {
            self.sent = true;
            Ok(RoomLoopDirective::Send(
                match self.role {
                    0 => "FIRST-PROCESS-PLAINTEXT-MUST-STAY-ENCRYPTED",
                    1 => "SECOND-PROCESS-CHAT",
                    2 => "THIRD-PROCESS-CHAT",
                    _ => return Err(()),
                }
                .to_owned(),
            ))
        } else {
            Ok(RoomLoopDirective::Idle)
        }
    }

    fn emit(&mut self, event: &multaiplayer_cli::chat::ProjectedEvent) {
        if let multaiplayer_cli::chat::ProjectedEvent::Chat(chat) = event {
            self.bodies.push(chat.body.clone());
            let own_body = match self.role {
                0 => "FIRST-PROCESS-PLAINTEXT-MUST-STAY-ENCRYPTED",
                1 => "SECOND-PROCESS-CHAT",
                2 => "THIRD-PROCESS-CHAT",
                _ => "",
            };
            if chat.body == own_body {
                let _ = std::fs::write(
                    self.coordination_dir.join(format!("sent-{}", self.role)),
                    b"sent",
                );
            }
            if self.crash_after_chat_count == Some(self.bodies.len()) {
                std::process::exit(86);
            }
        }
        println!("{}", self.renderer.render(event));
    }

    fn complete(&self, projected_chat_count: usize) -> Result<bool, ()> {
        if projected_chat_count < 3 {
            return Ok(false);
        }
        Ok(self.bodies
            == [
                "FIRST-PROCESS-PLAINTEXT-MUST-STAY-ENCRYPTED",
                "SECOND-PROCESS-CHAT",
                "THIRD-PROCESS-CHAT",
            ])
    }
}

#[cfg(debug_assertions)]
fn run_debug_chat_journey(path: &std::path::Path) -> ExitCode {
    use multaiplayer_cli::platform::JourneyFileStore;
    let config = match std::fs::read(path)
        .ok()
        .filter(|bytes| bytes.len() <= 65_536)
        .and_then(|bytes| serde_json::from_slice::<DebugChatJourneyConfig>(&bytes).ok())
    {
        Some(config) if config.role < 3 => config,
        _ => {
            eprintln!("debug journey: invalid bounded configuration");
            return ExitCode::from(1);
        }
    };
    let store = match JourneyFileStore::new(&config.credential_path) {
        Ok(store) => store,
        Err(_) => {
            eprintln!("debug journey: credential store unavailable");
            return ExitCode::from(1);
        }
    };
    let identity = match load_or_create_identity(&store, &config.user_id, &config.display_name) {
        Ok(identity) => identity,
        Err(_) => {
            eprintln!("debug journey: identity unavailable");
            return ExitCode::from(1);
        }
    };
    let mut mls = match MlsClientService::open(&store, &identity, &config.mls_path) {
        Ok(mls) => mls,
        Err(_) => {
            eprintln!("debug journey: MLS state unavailable");
            return ExitCode::from(1);
        }
    };
    if mls.open_group(&config.room.id).is_err() {
        eprintln!("debug journey: MLS room unavailable");
        return ExitCode::from(1);
    }
    let connector = match TungsteniteConnector::from_loopback_test_url(
        &config.websocket_url,
        &config.relay_session,
    ) {
        Ok(connector) => connector,
        Err(_) => {
            eprintln!("debug journey: loopback connector unavailable");
            return ExitCode::from(1);
        }
    };
    let mut chat = match RecoveringChatRoomSession::connect(
        connector,
        ThreadSleeper,
        ReconnectPolicy::default(),
        &mut mls,
        config.room,
        &config.user_id,
        &identity.public.device_id,
        &config.display_name,
        &identity.public.signature_key_fingerprint,
        &config.device_session,
    ) {
        Ok(chat) => chat,
        Err(_) => {
            eprintln!("debug journey: room session unavailable");
            return ExitCode::from(1);
        }
    };
    let mut adapter = DebugJourneyRoomLoop {
        role: config.role,
        coordination_dir: config.coordination_dir,
        renderer: TerminalRenderer::new(RenderMode::Plain),
        bodies: Vec::new(),
        sent: false,
        disconnected: false,
        start_gate: config.start_gate,
        delay_reconnect_until: config.delay_reconnect_until,
        crash_after_chat_count: config.crash_after_chat_count,
        deadline: Instant::now() + Duration::from_secs(30),
    };
    match drive_room_loop(&mut chat, &mut adapter, None) {
        Ok(()) => ExitCode::SUCCESS,
        Err(()) => {
            eprintln!("debug journey: shared room loop failed safely");
            ExitCode::from(1)
        }
    }
}

fn run_room(command: Command) -> ExitCode {
    let store = KeychainStore;
    let http = match ReqwestHttpClient::new() {
        Ok(http) => http,
        Err(error) => return auth_error(error),
    };
    let auth = match AuthClient::new(&store, &http, GITHUB_CLIENT_ID, RELAY_HTTP_ORIGIN) {
        Ok(client) => client,
        Err(error) => return auth_error(error),
    };
    let session = match auth.restore_session() {
        Ok(Some(session)) => session,
        Ok(None) => {
            eprintln!("error: Sign in with GitHub before using rooms.");
            return ExitCode::from(1);
        }
        Err(error) => return auth_error(error),
    };
    if command == Command::RoomList {
        return match WorkspaceClient::new(&store, &http, RELAY_HTTP_ORIGIN)
            .and_then(|client| client.load())
        {
            Ok(workspace) => {
                for room in workspace
                    .rooms
                    .into_iter()
                    .filter(|room| room.deleted_at.is_none())
                {
                    let status = match room.host_status {
                        multaiplayer_cli::room::HostStatus::Active => "active",
                        multaiplayer_cli::room::HostStatus::Offline => "offline",
                    };
                    println!("{}\t{}\t{status}", room.id, safe_terminal_text(&room.name));
                }
                ExitCode::SUCCESS
            }
            Err(error) => auth_error(error),
        };
    }
    let display_name = session.user.name.as_deref().unwrap_or(&session.user.login);
    let identity = match load_or_create_identity(&store, &session.user.id, display_name) {
        Ok(identity) => identity,
        Err(error) => return auth_error(error),
    };
    let mls_path = match cli_mls_path() {
        Ok(path) => path,
        Err(()) => {
            eprintln!("error: The CLI state directory is unavailable.");
            return ExitCode::from(1);
        }
    };
    let mut mls = match MlsClientService::open(&store, &identity, &mls_path) {
        Ok(mls) => mls,
        Err(error) => {
            eprintln!("error: {error}");
            return ExitCode::from(1);
        }
    };
    let mut backend =
        match RelayRoomBackend::new(&store, &http, RELAY_HTTP_ORIGIN, &session, &identity) {
            Ok(backend) => backend,
            Err(error) => return room_error(error),
        };
    let chat_mode = match &command {
        Command::RoomOpen { plain, .. } => Some(
            if *plain || !std::io::stdout().is_terminal() || std::env::var_os("NO_COLOR").is_some()
            {
                RenderMode::Plain
            } else {
                RenderMode::Color
            },
        ),
        _ => None,
    };
    enum Outcome {
        Opened(multaiplayer_cli::room::OpenedRoom, Option<PathBuf>),
        Left(RoomRecord),
        Forgotten(String),
    }
    let result = {
        let mut service = RoomService::new(
            &store,
            &mut backend,
            &mut mls,
            &session.user.id,
            &identity.public.device_id,
            RELAY_HTTP_ORIGIN,
        );
        match command {
            Command::RoomCreate(request) => service.create(&request).and_then(|opened| {
                let project = service
                    .local_project_path(&opened.room.id)?
                    .ok_or(multaiplayer_cli::room::RoomError::LocalStateUnavailable)?;
                Ok(Outcome::Opened(opened, Some(project)))
            }),
            Command::RoomOpen { selector, .. } => service.open(&selector).and_then(|opened| {
                let project = service.local_project_path(&opened.room.id)?;
                Ok(Outcome::Opened(opened, project))
            }),
            Command::RoomLeave { selector } => service.leave(&selector).map(Outcome::Left),
            Command::RoomForget { selector } => service.forget(&selector).map(Outcome::Forgotten),
            _ => unreachable!("room runner received non-room command"),
        }
    };
    match result {
        Ok(Outcome::Opened(opened, project_path)) => {
            println!("{}", opened_room_message(&opened));
            match chat_mode {
                Some(mode) => run_opened_room_chat(
                    &store,
                    &mut backend,
                    &mut mls,
                    &opened.room,
                    &session.user.id,
                    &identity.public.device_id,
                    display_name,
                    &identity.public.signature_key_fingerprint,
                    project_path,
                    mode,
                ),
                None => ExitCode::SUCCESS,
            }
        }
        Ok(Outcome::Left(room)) => {
            println!(
                "Left {} ({}) locally. Encrypted room data is retained until forget.",
                safe_terminal_text(&room.name),
                room.id
            );
            ExitCode::SUCCESS
        }
        Ok(Outcome::Forgotten(room_id)) => {
            println!("Forgot {room_id} on this device.");
            ExitCode::SUCCESS
        }
        Err(error) => room_error(error),
    }
}

#[allow(clippy::too_many_arguments)]
fn run_opened_room_chat<S, H>(
    store: &S,
    backend: &mut RelayRoomBackend<'_, S, H>,
    mls: &mut MlsClientService,
    room: &RoomRecord,
    user_id: &str,
    device_id: &str,
    display_name: &str,
    public_key_fingerprint: &str,
    project_path: Option<PathBuf>,
    mode: RenderMode,
) -> ExitCode
where
    S: multaiplayer_cli::platform::CredentialStore,
    H: multaiplayer_cli::platform::HttpClient,
{
    let device_session = match backend.establish_device_session_for_invites() {
        Ok(session) => session,
        Err(error) => return room_error(error),
    };
    let connector = match TungsteniteConnector::from_store(store, RELAY_HTTP_ORIGIN) {
        Ok(connector) => connector,
        Err(error) => {
            eprintln!("error: {error}");
            return ExitCode::from(1);
        }
    };
    let mut chat = match RecoveringChatRoomSession::connect(
        connector,
        ThreadSleeper,
        ReconnectPolicy::default(),
        mls,
        room.clone(),
        user_id,
        device_id,
        display_name,
        public_key_fingerprint,
        device_session.as_str(),
    ) {
        Ok(chat) => chat,
        Err(error) => {
            eprintln!("error: {error}");
            return ExitCode::from(1);
        }
    };
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            if sender.send(line).is_err() {
                return;
            }
        }
    });
    let mut adapter = InteractiveRoomLoop {
        receiver,
        renderer: TerminalRenderer::new(mode),
    };
    let previous_thread_id = chat.codex_thread_id();
    let mut codex = if chat.is_active_host() {
        let Some(project_path) = project_path else {
            eprintln!("error: The active host has no local project association.");
            return ExitCode::from(1);
        };
        match CodexRoomController::new(
            room,
            project_path,
            display_name,
            user_id,
            previous_thread_id,
        ) {
            Ok(controller) => Some(controller),
            Err(()) => {
                eprintln!("error: The Codex room controller could not start safely.");
                return ExitCode::from(1);
            }
        }
    } else {
        None
    };
    for event in chat.persisted_history() {
        if codex
            .as_mut()
            .is_some_and(|controller| controller.observe(&event, unix_now(), false).is_err())
        {
            eprintln!("error: The persisted Codex room state is invalid.");
            return ExitCode::from(1);
        }
    }
    match drive_room_loop(&mut chat, &mut adapter, codex.as_mut()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(()) => {
            eprintln!("error: The encrypted room loop failed safely.");
            ExitCode::from(1)
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
enum InviteCliError {
    Core(multaiplayer_cli::CliError),
    Room(multaiplayer_cli::room::RoomError),
    Invite(InviteError),
    Input,
    Output,
    State,
    RoomSelection,
    TimedOut,
    Denied,
}

impl std::fmt::Display for InviteCliError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Core(error) => error.fmt(formatter),
            Self::Room(error) => error.fmt(formatter),
            Self::Invite(error) => error.fmt(formatter),
            Self::Input => {
                formatter.write_str("The invite input is missing, invalid, or too large.")
            }
            Self::Output => formatter.write_str("The trusted terminal output is unavailable."),
            Self::State => formatter.write_str("The CLI state directory is unavailable."),
            Self::RoomSelection => {
                formatter.write_str("The room selector is missing or ambiguous.")
            }
            Self::TimedOut => {
                formatter.write_str("The host did not decide before the bounded wait ended.")
            }
            Self::Denied => formatter.write_str("The host denied this admission request."),
        }
    }
}

fn run_invite(command: Command) -> ExitCode {
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    let stderr = std::io::stderr();
    let mut trusted_prompt = stderr.lock();
    match run_invite_command(command, &mut input, &mut output, &mut trusted_prompt) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::from(1)
        }
    }
}

fn run_invite_command<R: BufRead, W: Write, P: Write>(
    command: Command,
    input: &mut R,
    output: &mut W,
    trusted_prompt: &mut P,
) -> Result<(), InviteCliError> {
    let store = KeychainStore;
    let http = ReqwestHttpClient::new().map_err(InviteCliError::Core)?;
    let auth = AuthClient::new(&store, &http, GITHUB_CLIENT_ID, RELAY_HTTP_ORIGIN)
        .map_err(InviteCliError::Core)?;
    let session = auth
        .restore_session()
        .map_err(InviteCliError::Core)?
        .ok_or(InviteCliError::Invite(InviteError::AuthenticationRequired))?;
    let display_name = session.user.name.as_deref().unwrap_or(&session.user.login);
    let identity = load_or_create_identity(&store, &session.user.id, display_name)
        .map_err(InviteCliError::Core)?;
    let mls_path = cli_mls_path().map_err(|()| InviteCliError::State)?;
    run_authenticated_invite_command(
        command,
        &store,
        &http,
        RELAY_HTTP_ORIGIN,
        &session,
        &identity,
        &mls_path,
        input,
        output,
        trusted_prompt,
    )
}

#[allow(clippy::too_many_arguments)]
fn run_authenticated_invite_command<S, H, R, W, P>(
    command: Command,
    store: &S,
    http: &H,
    relay_origin: &str,
    session: &multaiplayer_cli::auth::RestoredSession,
    identity: &multaiplayer_cli::identity::DeviceIdentity,
    mls_path: &std::path::Path,
    input: &mut R,
    output: &mut W,
    trusted_prompt: &mut P,
) -> Result<(), InviteCliError>
where
    S: multaiplayer_cli::platform::CredentialStore,
    H: multaiplayer_cli::platform::HttpClient,
    R: BufRead,
    W: Write,
    P: Write,
{
    let mut mls = MlsClientService::open(store, identity, mls_path)
        .map_err(|error| InviteCliError::Invite(error.into()))?;

    let device_session = {
        let mut backend = RelayRoomBackend::new(store, http, relay_origin, session, identity)
            .map_err(InviteCliError::Room)?;
        backend
            .establish_device_session_for_invites()
            .map_err(InviteCliError::Room)?
    };
    let room = match &command {
        Command::RoomInvite { selector }
        | Command::RoomAdmissions { selector, .. }
        | Command::RoomRevoke { selector } => {
            let workspace = WorkspaceClient::new(store, http, relay_origin)
                .and_then(|client| client.load())
                .map_err(InviteCliError::Core)?;
            Some(select_invite_room(&workspace, selector)?)
        }
        Command::RoomJoin | Command::RoomFinish { .. } => None,
        _ => unreachable!("invite runner received non-invite command"),
    };
    if matches!(
        &command,
        Command::RoomInvite { .. } | Command::RoomAdmissions { .. }
    ) {
        let room = room.as_ref().ok_or(InviteCliError::RoomSelection)?;
        let epoch = mls
            .open_group(&room.id)
            .map_err(|error| InviteCliError::Invite(error.into()))?;
        if room.accepted_mls_epoch != Some(epoch) {
            return Err(InviteCliError::Invite(InviteError::RecoveryRequired));
        }
    }
    let mut backend = RelayInviteBackend::new(store, http, relay_origin, session, identity)
        .map_err(InviteCliError::Invite)?;
    let mut service = InviteService::new(store, &mut backend);
    match command {
        Command::RoomInvite { .. } => {
            let room = room.as_ref().ok_or(InviteCliError::RoomSelection)?;
            let code = Zeroizing::new(
                service
                    .issue(room, identity)
                    .map_err(InviteCliError::Invite)?,
            );
            let parsed = parse_invite_code(code.as_str())
                .map_err(|_| InviteCliError::Invite(InviteError::Unavailable))?;
            writeln!(output, "Invite ID: {}", parsed.invite_id)
                .map_err(|_| InviteCliError::Output)?;
            writeln!(
                output,
                "Invite code (secret; share only with the intended participant):"
            )
            .map_err(|_| InviteCliError::Output)?;
            writeln!(output, "{}", code.as_str()).map_err(|_| InviteCliError::Output)?;
        }
        Command::RoomRevoke { .. } => {
            let room = room.as_ref().ok_or(InviteCliError::RoomSelection)?;
            let revoked = service
                .revoke(room, identity)
                .map_err(InviteCliError::Invite)?;
            writeln!(output, "Revoked {revoked} outstanding invite(s).")
                .map_err(|_| InviteCliError::Output)?;
        }
        Command::RoomAdmissions { invite_id, .. } => {
            let room = room.as_ref().ok_or(InviteCliError::RoomSelection)?;
            let now = utc_timestamp()?;
            let requests = service
                .review_requests(
                    &invite_id,
                    room,
                    identity,
                    device_session.as_str(),
                    &now,
                    &mls,
                )
                .map_err(InviteCliError::Invite)?;
            if requests.is_empty() {
                writeln!(output, "No pending admission requests.")
                    .map_err(|_| InviteCliError::Output)?;
            }
            for request in requests {
                let decided_at = utc_timestamp()?;
                let Some(decision) = service
                    .decide_from_trusted_prompt(
                        &request,
                        room,
                        identity,
                        device_session.as_str(),
                        &decided_at,
                        &mut mls,
                        input,
                        trusted_prompt,
                    )
                    .map_err(InviteCliError::Invite)?
                else {
                    continue;
                };
                writeln!(
                    output,
                    "Admission request {} was {}.",
                    safe_terminal_text(&request.record.request_id),
                    decision.status
                )
                .map_err(|_| InviteCliError::Output)?;
            }
        }
        Command::RoomJoin => {
            let code = read_invite_code(input)?;
            let now = utc_timestamp()?;
            let request = service
                .request_admission(code.as_str(), identity, device_session.as_str(), &now, &mls)
                .map_err(InviteCliError::Invite)?;
            writeln!(
                output,
                "Admission requested. Waiting for the active host to approve or deny."
            )
            .map_err(|_| InviteCliError::Output)?;
            output.flush().map_err(|_| InviteCliError::Output)?;
            let started = Instant::now();
            let epoch = loop {
                let now = utc_timestamp()?;
                match service.finish_admission_and_record_at(
                    &request,
                    device_session.as_str(),
                    relay_origin,
                    &now,
                    &mut mls,
                ) {
                    Ok(epoch) => break epoch,
                    Err(InviteError::Pending) if started.elapsed() < ADMISSION_WAIT_LIMIT => {
                        thread::sleep(Duration::from_secs(1));
                    }
                    Err(InviteError::Pending) => return Err(InviteCliError::TimedOut),
                    Err(error) => return Err(InviteCliError::Invite(error)),
                }
            };
            if let Some(epoch) = epoch {
                writeln!(output, "Admission approved. Joined MLS epoch {epoch}.")
                    .map_err(|_| InviteCliError::Output)?;
            } else {
                return Err(InviteCliError::Denied);
            }
            return Ok(());
        }
        Command::RoomFinish { request_id } => {
            let pending = mls
                .pending_invite_admission(&request_id)
                .map_err(|error| InviteCliError::Invite(error.into()))?
                .ok_or(InviteCliError::Invite(InviteError::Unavailable))?;
            let now = utc_timestamp()?;
            let epoch = service
                .finish_pending_admission_and_record(
                    &pending,
                    device_session.as_str(),
                    relay_origin,
                    &now,
                    &mut mls,
                )
                .map_err(InviteCliError::Invite)?;
            if let Some(epoch) = epoch {
                writeln!(output, "Admission approved. Joined MLS epoch {epoch}.")
                    .map_err(|_| InviteCliError::Output)?;
            } else {
                return Err(InviteCliError::Denied);
            }
            return Ok(());
        }
        _ => unreachable!("invite runner received non-invite command"),
    }
    Ok(())
}

fn select_invite_room(
    workspace: &WorkspaceSnapshot,
    selector: &str,
) -> Result<RoomRecord, InviteCliError> {
    let matches = workspace
        .rooms
        .iter()
        .filter(|room| room.deleted_at.is_none() && (room.id == selector || room.name == selector))
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(InviteCliError::RoomSelection);
    }
    Ok(matches[0].clone())
}

fn read_invite_code(input: &mut impl Read) -> Result<Zeroizing<String>, InviteCliError> {
    let mut bytes = Zeroizing::new(Vec::new());
    input
        .take(MAX_INVITE_CODE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| InviteCliError::Input)?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_INVITE_CODE_BYTES {
        return Err(InviteCliError::Input);
    }
    let value = Zeroizing::new(
        String::from_utf8(std::mem::take(&mut *bytes)).map_err(|_| InviteCliError::Input)?,
    );
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_whitespace) {
        return Err(InviteCliError::Input);
    }
    Ok(Zeroizing::new(trimmed.to_owned()))
}

fn utc_timestamp() -> Result<String, InviteCliError> {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| InviteCliError::State)?
        .as_secs();
    let days = i64::try_from(seconds / 86_400).map_err(|_| InviteCliError::State)?;
    let second_of_day = seconds % 86_400;
    let (year, month, day) = civil_date(days);
    Ok(format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.000Z",
        second_of_day / 3_600,
        (second_of_day % 3_600) / 60,
        second_of_day % 60
    ))
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_secs()).ok())
        .unwrap_or(i64::MAX)
}

fn civil_date(days_since_epoch: i64) -> (i64, i64, i64) {
    let shifted = days_since_epoch + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

fn bounded_cli_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn cli_mls_path() -> Result<PathBuf, ()> {
    let home = std::env::var_os("HOME").ok_or(())?;
    let directory = PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("com.multaiplayer.cli");
    std::fs::create_dir_all(&directory).map_err(|_| ())?;
    Ok(directory.join("mls.db"))
}

fn safe_terminal_text(value: &str) -> String {
    value
        .chars()
        .take(120)
        .map(|character| {
            if character.is_control() {
                '�'
            } else {
                character
            }
        })
        .collect()
}

fn room_error(error: multaiplayer_cli::room::RoomError) -> ExitCode {
    eprintln!("error: {error}");
    ExitCode::from(1)
}

fn run_auth(command: Command) -> ExitCode {
    let store = KeychainStore;
    let http = match ReqwestHttpClient::new() {
        Ok(http) => http,
        Err(error) => return auth_error(error),
    };
    let client = match AuthClient::new(&store, &http, GITHUB_CLIENT_ID, RELAY_HTTP_ORIGIN) {
        Ok(client) => client,
        Err(error) => return auth_error(error),
    };
    let result = match command {
        Command::AuthLogin { open } => login(&client, open),
        Command::AuthStatus => match client.restore_session() {
            Ok(Some(session)) => {
                println!(
                    "Signed in as {} ({})",
                    session.user.login, session.relay_origin
                );
                Ok(())
            }
            Ok(None) => {
                println!("Not signed in.");
                Ok(())
            }
            Err(error) => Err(error),
        },
        Command::AuthLogout => client.logout().map(|()| {
            println!("Signed out. Device identity and room keys were retained.");
        }),
        Command::Help
        | Command::Version
        | Command::RoomList
        | Command::RoomCreate(_)
        | Command::RoomOpen { .. }
        | Command::RoomLeave { .. }
        | Command::RoomForget { .. }
        | Command::RoomInvite { .. }
        | Command::RoomJoin
        | Command::RoomFinish { .. }
        | Command::RoomAdmissions { .. }
        | Command::RoomRevoke { .. } => unreachable!("auth runner received non-auth command"),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => auth_error(error),
    }
}

fn login<S, H>(client: &AuthClient<'_, S, H>, open: bool) -> Result<(), multaiplayer_cli::CliError>
where
    S: multaiplayer_cli::platform::CredentialStore,
    H: multaiplayer_cli::platform::HttpClient,
{
    let pending = client.start_login()?;
    println!("{}", pending.instructions());
    if open {
        client.open_login_url(&pending, &MacOsUrlOpener)?;
    }
    let mut interval = pending.interval;
    loop {
        thread::sleep(pending.next_poll_delay(interval));
        match client.poll_login(&pending)? {
            DevicePollResult::Pending => {}
            DevicePollResult::SlowDown {
                retry_after_seconds,
            } => interval = interval.saturating_add(retry_after_seconds),
            DevicePollResult::Complete(session) => {
                println!(
                    "Signed in as {}. Registered device {}.",
                    session.user.login, session.device.device_id
                );
                return Ok(());
            }
        }
    }
}

fn auth_error(error: multaiplayer_cli::CliError) -> ExitCode {
    eprintln!("error: {error}");
    ExitCode::from(1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use multaiplayer_cli::invite::{read_trusted_admission_decision, AdmissionPromptDecision};
    use multaiplayer_cli::platform::{CredentialStore, HttpClient, HttpResponse};
    use serde_json::{json, Value};
    use std::{
        collections::{BTreeMap, HashMap},
        fs,
        io::BufReader,
        process::{Child, ChildStdout, Command as ProcessCommand, Stdio},
        sync::{Arc, Mutex},
    };

    #[derive(Clone, Default)]
    struct ThreadStore(Arc<Mutex<HashMap<String, String>>>);

    impl CredentialStore for ThreadStore {
        fn get(&self, account: &str) -> Result<Option<String>, multaiplayer_cli::CliError> {
            Ok(self.0.lock().unwrap().get(account).cloned())
        }

        fn set(&self, account: &str, value: &str) -> Result<(), multaiplayer_cli::CliError> {
            self.0
                .lock()
                .unwrap()
                .insert(account.to_owned(), value.to_owned());
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<(), multaiplayer_cli::CliError> {
            self.0.lock().unwrap().remove(account);
            Ok(())
        }
    }

    #[derive(Clone)]
    struct RewritingHttp {
        client: reqwest::blocking::Client,
        expected_origin: String,
        actual_origin: String,
    }

    impl RewritingHttp {
        fn new(expected_origin: &str, actual_origin: &str) -> Self {
            Self {
                client: reqwest::blocking::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .unwrap(),
                expected_origin: expected_origin.into(),
                actual_origin: actual_origin.into(),
            }
        }

        fn send(
            &self,
            method: reqwest::Method,
            expected_url: &str,
            headers: &[(&str, &str)],
            body: Option<Vec<u8>>,
        ) -> Result<HttpResponse, multaiplayer_cli::CliError> {
            let actual_url = expected_url.replacen(&self.expected_origin, &self.actual_origin, 1);
            let mut request = self.client.request(method, actual_url);
            for (name, value) in headers {
                request = request.header(*name, *value);
            }
            if let Some(body) = body {
                request = request
                    .header("content-type", "application/json")
                    .body(body);
            }
            let response = request
                .send()
                .map_err(|_| multaiplayer_cli::CliError::RelayUnavailable)?;
            let status = response.status().as_u16();
            let response_headers: BTreeMap<_, _> = response
                .headers()
                .iter()
                .filter_map(|(name, value)| {
                    value
                        .to_str()
                        .ok()
                        .map(|value| (name.as_str().to_owned(), value.to_owned()))
                })
                .collect();
            let mut response_body = Vec::new();
            response
                .take(1_048_577)
                .read_to_end(&mut response_body)
                .map_err(|_| multaiplayer_cli::CliError::RelayUnavailable)?;
            if response_body.len() > 1_048_576 {
                return Err(multaiplayer_cli::CliError::RelayUnavailable);
            }
            Ok(HttpResponse {
                status,
                final_url: expected_url.into(),
                headers: response_headers,
                body: response_body,
            })
        }
    }

    impl HttpClient for RewritingHttp {
        fn get(
            &self,
            url: &str,
            headers: &[(&str, &str)],
        ) -> Result<HttpResponse, multaiplayer_cli::CliError> {
            self.send(reqwest::Method::GET, url, headers, None)
        }

        fn post_json(
            &self,
            url: &str,
            headers: &[(&str, &str)],
            body: &Value,
        ) -> Result<HttpResponse, multaiplayer_cli::CliError> {
            self.send(
                reqwest::Method::POST,
                url,
                headers,
                Some(serde_json::to_vec(body).unwrap()),
            )
        }

        fn post_json_bytes(
            &self,
            url: &str,
            headers: &[(&str, &str)],
            body: &[u8],
        ) -> Result<HttpResponse, multaiplayer_cli::CliError> {
            self.send(reqwest::Method::POST, url, headers, Some(body.to_vec()))
        }

        fn patch_json(
            &self,
            url: &str,
            headers: &[(&str, &str)],
            body: &Value,
        ) -> Result<HttpResponse, multaiplayer_cli::CliError> {
            self.send(
                reqwest::Method::PATCH,
                url,
                headers,
                Some(serde_json::to_vec(body).unwrap()),
            )
        }

        fn delete(
            &self,
            url: &str,
            headers: &[(&str, &str)],
        ) -> Result<HttpResponse, multaiplayer_cli::CliError> {
            self.send(reqwest::Method::DELETE, url, headers, None)
        }
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct BinaryRelayInfo {
        base_url: String,
        temp_dir: PathBuf,
    }

    struct BinaryRelay {
        child: Option<Child>,
        _stdout: BufReader<ChildStdout>,
        info: BinaryRelayInfo,
    }

    impl BinaryRelay {
        fn start(active_host_device_id: &str) -> Self {
            let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .parent()
                .unwrap()
                .to_path_buf();
            let fixture =
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/real-relay-fixture.ts");
            let mut child = ProcessCommand::new("node")
                .arg("--import")
                .arg("tsx")
                .arg(fixture)
                .current_dir(root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .unwrap();
            child
                .stdin
                .as_mut()
                .unwrap()
                .write_all(
                    format!(
                        "{}\n",
                        json!({
                            "forbidden": "binary-invite-reflection-sentinel",
                            "activeHostDeviceId": active_host_device_id,
                        })
                    )
                    .as_bytes(),
                )
                .unwrap();
            let mut stdout = BufReader::new(child.stdout.take().unwrap());
            let mut line = String::new();
            stdout.read_line(&mut line).unwrap();
            Self {
                child: Some(child),
                _stdout: stdout,
                info: serde_json::from_str(&line).unwrap(),
            }
        }
    }

    impl Drop for BinaryRelay {
        fn drop(&mut self) {
            if let Some(mut child) = self.child.take() {
                let _ = child.stdin.take().unwrap().write_all(b"stop\n");
                let _ = child.wait();
            }
            let _ = fs::remove_dir_all(&self.info.temp_dir);
        }
    }

    fn debug_session(relay: &BinaryRelay, user_id: &str, login: &str) -> String {
        let response = reqwest::blocking::Client::new()
            .post(format!("{}/debug/auth-session", relay.info.base_url))
            .json(&json!({
                "id": user_id,
                "login": login,
                "name": login,
            }))
            .send()
            .unwrap();
        assert_eq!(response.status().as_u16(), 201);
        response
            .headers()
            .get("set-cookie")
            .unwrap()
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .strip_prefix("multaiplayer_session=")
            .unwrap()
            .to_owned()
    }

    fn prepare_binary_identity(
        relay: &BinaryRelay,
        store: &ThreadStore,
        http: &RewritingHttp,
        expected_origin: &str,
        user_id: &str,
        login: &str,
    ) -> (
        multaiplayer_cli::auth::RestoredSession,
        multaiplayer_cli::identity::DeviceIdentity,
    ) {
        let relay_session = debug_session(relay, user_id, login);
        store
            .set(
                multaiplayer_cli::auth::RELAY_SESSION_ACCOUNT,
                &json!({
                    "version": 1,
                    "relay_origin": expected_origin,
                    "session": relay_session,
                })
                .to_string(),
            )
            .unwrap();
        let identity = load_or_create_identity(store, user_id, login).unwrap();
        let response = http
            .post_json(
                &format!("{expected_origin}/devices"),
                &[("cookie", &format!("multaiplayer_session={relay_session}"))],
                &json!({
                    "deviceId": identity.public.device_id,
                    "displayName": identity.public.display_name,
                    "signaturePublicKey": identity.public.signature_public_key,
                    "signatureKeyFingerprint": identity.public.signature_key_fingerprint,
                    "hpkePublicKey": identity.public.hpke_public_key,
                    "hpkeKeyFingerprint": identity.public.hpke_key_fingerprint,
                }),
            )
            .unwrap();
        assert!(matches!(response.status, 200 | 201));
        (
            multaiplayer_cli::auth::RestoredSession {
                user: multaiplayer_cli::auth::SignedInUser {
                    id: user_id.into(),
                    login: login.into(),
                    name: Some(login.into()),
                    avatar_url: None,
                },
                relay_origin: expected_origin.into(),
            },
            identity,
        )
    }

    #[test]
    fn accepts_only_help_and_version_forms() {
        assert_eq!(parse_args([] as [&str; 0]), Ok(Command::Help));
        assert_eq!(parse_args(["-h"]), Ok(Command::Help));
        assert_eq!(parse_args(["--help"]), Ok(Command::Help));
        assert_eq!(parse_args(["-V"]), Ok(Command::Version));
        assert_eq!(parse_args(["--version"]), Ok(Command::Version));
        assert_eq!(
            parse_args(["auth", "login"]),
            Ok(Command::AuthLogin { open: false })
        );
        assert_eq!(
            parse_args(["auth", "login", "--open"]),
            Ok(Command::AuthLogin { open: true })
        );
        assert_eq!(parse_args(["auth", "status"]), Ok(Command::AuthStatus));
        assert_eq!(parse_args(["auth", "logout"]), Ok(Command::AuthLogout));
        assert_eq!(parse_args(["room", "list"]), Ok(Command::RoomList));
        assert_eq!(
            parse_args([
                "room",
                "create",
                "--project",
                "/tmp/project",
                "--name",
                "Compiler work",
                "--team",
                "Core"
            ]),
            Ok(Command::RoomCreate(CreateRoomRequest {
                team: Some("Core".into()),
                name: "Compiler work".into(),
                project: "/tmp/project".into()
            }))
        );
        assert_eq!(
            parse_args(["room", "open", "room-core"]),
            Ok(Command::RoomOpen {
                selector: "room-core".into(),
                plain: false
            })
        );
        assert_eq!(
            parse_args(["room", "open", "room-core", "--plain"]),
            Ok(Command::RoomOpen {
                selector: "room-core".into(),
                plain: true
            })
        );
        assert_eq!(
            parse_args(["room", "leave", "room-core"]),
            Ok(Command::RoomLeave {
                selector: "room-core".into()
            })
        );
        assert_eq!(
            parse_args(["room", "forget", "room-core"]),
            Ok(Command::RoomForget {
                selector: "room-core".into()
            })
        );
        assert_eq!(
            parse_args(["room", "invite", "room-core"]),
            Ok(Command::RoomInvite {
                selector: "room-core".into()
            })
        );
        assert_eq!(parse_args(["room", "join"]), Ok(Command::RoomJoin));
        assert_eq!(
            parse_args(["room", "finish", "request_123"]),
            Ok(Command::RoomFinish {
                request_id: "request_123".into()
            })
        );
        assert_eq!(
            parse_args(["room", "admissions", "room-core", "invite_123"]),
            Ok(Command::RoomAdmissions {
                selector: "room-core".into(),
                invite_id: "invite_123".into()
            })
        );
        assert_eq!(
            parse_args(["room", "revoke", "room-core"]),
            Ok(Command::RoomRevoke {
                selector: "room-core".into()
            })
        );
        assert_eq!(
            parse_args(["room", "join", "secret-capability-bearing-code"]),
            Err(())
        );
        assert_eq!(parse_args(["auth", "login", "--token", "secret"]), Err(()));
        assert_eq!(parse_args(["--help", "extra"]), Err(()));
    }

    #[test]
    fn all_output_is_fixed_and_bounded() {
        for output in [HELP, VERSION, UNSUPPORTED] {
            assert!(output.len() <= 2048);
        }
        assert!(!HELP.contains("<invite-code>"));
        assert!(HELP.contains("Read a secret invite code from stdin"));
        assert!(!HELP.contains("--yes"));
        assert!(!HELP.contains("auto-approve"));
    }

    #[test]
    fn interactive_privileged_response_requires_an_exact_key_and_valid_json() {
        let (sender, receiver) = mpsc::channel();
        let mut adapter = InteractiveRoomLoop {
            receiver,
            renderer: TerminalRenderer::new(RenderMode::Plain),
        };
        sender
            .send(Ok(
                "/respond rpc-7-1 {\"answers\":{\"q\":{\"answers\":[\"yes\"]}}}".to_owned(),
            ))
            .unwrap();
        match adapter.directive(0).unwrap() {
            RoomLoopDirective::Respond(key, response) => {
                assert_eq!(key, "rpc-7-1");
                assert_eq!(response["answers"]["q"]["answers"][0], "yes");
            }
            _ => panic!("expected a privileged response"),
        }
        sender
            .send(Ok("/respond rpc-7-1 not-json".to_owned()))
            .unwrap();
        assert!(adapter.directive(0).is_err());
    }

    #[test]
    fn invite_code_intake_is_stdin_only_bounded_and_zeroizing() {
        let mut input = std::io::Cursor::new("https://open.multaiplayer.com/invite#code\n");
        let code = read_invite_code(&mut input).unwrap();
        assert_eq!(code.as_str(), "https://open.multaiplayer.com/invite#code");
        assert_eq!(
            read_invite_code(&mut std::io::Cursor::new("one two")),
            Err(InviteCliError::Input)
        );
        let oversized = vec![b'a'; MAX_INVITE_CODE_BYTES as usize + 1];
        assert_eq!(
            read_invite_code(&mut std::io::Cursor::new(oversized)),
            Err(InviteCliError::Input)
        );
    }

    #[test]
    fn trusted_host_prompt_requires_an_exact_explicit_decision() {
        use mls_core::CapabilityBinding;
        use multaiplayer_cli::{invite::AdmissionRequest, mls::OpenedInviteRequest};
        use multaiplayer_protocol::InviteJoinRequestRecord;

        let binding = CapabilityBinding {
            version: 3,
            phase: "request".into(),
            invite_id: "invite_123".into(),
            team_id: "team-core".into(),
            room_id: "room-core".into(),
            key_epoch: 0,
            key_package_hash: format!("sha256:{}", "00".repeat(32)),
            request_id: "request_123".into(),
            request_nonce: "nonce".into(),
            requester_user_id: "github:guest".into(),
            requester_device_id: "device_guest".into(),
            host_user_id: "github:host".into(),
            host_device_id: "device_host".into(),
            expires_at: "2026-07-19T12:34:56.000Z".into(),
            status: None,
            decided_at: None,
        };
        let request = AdmissionRequest {
            record: InviteJoinRequestRecord {
                request_id: "request_123\u{1b}[31m".into(),
                invite_id: "invite_123".into(),
                requester_user_id: "github:guest".into(),
                requester_device_id: "device_guest".into(),
                key_package_id: "key_package_123".into(),
                key_package_hash: binding.key_package_hash.clone(),
                sealed_request: "sealed".into(),
                created_at: "2026-07-18T12:34:56.000Z".into(),
            },
            requester_display_name: "github:guest\u{1b}[2J".into(),
            requester_device_fingerprint: format!("sha256:{}", vec!["abcd"; 16].join(":")),
            opened: OpenedInviteRequest {
                capability_handle: "secret-handle".into(),
                binding,
                key_package: "secret-key-package".into(),
                key_package_id: "key_package_123".into(),
                mac: "secret-mac".into(),
                requester_signature_public_key: "public-key".into(),
                requester_signature_key_fingerprint: "fingerprint".into(),
            },
        };
        let mut output = Vec::new();
        let decision = read_trusted_admission_decision(
            &mut std::io::Cursor::new("approve\n"),
            &mut output,
            &request,
        )
        .unwrap();
        assert_eq!(decision, AdmissionPromptDecision::Approve);
        let output = String::from_utf8(output).unwrap();
        assert!(output.starts_with("=== multAIplayer trusted admission prompt ===\n"));
        assert!(output.contains("GitHub identity: github:guest�[2J"));
        assert!(output.contains(&request.requester_device_fingerprint));
        assert!(!output.contains('\u{1b}'));
        assert!(!output.contains("secret-handle"));
        assert!(!output.contains("secret-key-package"));
        assert!(!output.contains("secret-mac"));
        assert!(read_trusted_admission_decision(
            &mut std::io::Cursor::new("yes\n"),
            &mut Vec::new(),
            &request,
        )
        .is_err());
    }

    #[test]
    fn utc_calendar_conversion_is_stable_without_a_dependency() {
        assert_eq!(civil_date(0), (1970, 1, 1));
        assert_eq!(civil_date(20_454), (2026, 1, 1));
    }

    #[test]
    fn only_active_host_receives_exact_trusted_codex_preview_and_duplicates_are_idempotent() {
        let room: RoomRecord = multaiplayer_protocol::from_json(
            r#"{"id":"room-codex","teamId":"team-codex","acceptedMlsEpoch":0,"name":"Codex room","host":"Host","hostUserId":"github:host","activeHostDeviceId":"device-host","hostStatus":"active","approvalPolicy":"ask_every_turn"}"#,
        )
        .unwrap();
        let proposal =
            multaiplayer_cli::chat::ProjectedEvent::CodexProposal(CodexQueuePlaintextPayload {
                event_type: "codex.queue".into(),
                queue_event_id: "queue-1".into(),
                turn_id: "proposal-1".into(),
                action: CodexQueueAction::Queued,
                requested_by: "Guest".into(),
                requested_by_user_id: "github:guest".into(),
                trigger_message_id: None,
                reason: Some("Review the implementation".into()),
                queue_position: Some(1),
                queue_size: 1,
                created_at: "2026-07-19T12:00:00.000Z".into(),
            });
        let mut participant =
            CodexRoomController::new(&room, std::env::temp_dir(), "Guest", "github:guest", None)
                .unwrap();
        assert_eq!(
            participant
                .observe(&proposal, 1_784_462_400, false)
                .unwrap(),
            None
        );

        let mut host =
            CodexRoomController::new(&room, std::env::temp_dir(), "Host", "github:host", None)
                .unwrap();
        host.settings_resolved = true;
        let preview = host
            .observe(&proposal, 1_784_462_400, true)
            .unwrap()
            .unwrap();
        let trusted = preview.trusted_text();
        for required in [
            "proposal-1",
            "Guest",
            "Review the implementation",
            "Context:",
            "gpt-5.6-sol",
            "default",
            "medium",
            "workspace_write",
        ] {
            assert!(trusted.contains(required));
        }
        assert_eq!(host.observe(&proposal, 1_784_462_400, true).unwrap(), None);
    }

    #[test]
    fn future_and_stale_proposal_timestamps_never_hold_the_pending_slot() {
        let room: RoomRecord = multaiplayer_protocol::from_json(
            r#"{"id":"room-codex","teamId":"team-codex","acceptedMlsEpoch":0,"name":"Codex room","host":"Host","hostUserId":"github:host","activeHostDeviceId":"device-host","hostStatus":"active","approvalPolicy":"ask_every_turn"}"#,
        )
        .unwrap();
        let proposal_at = |id: &str, created_at: &str| {
            multaiplayer_cli::chat::ProjectedEvent::CodexProposal(CodexQueuePlaintextPayload {
                event_type: "codex.queue".into(),
                queue_event_id: format!("queue-{id}"),
                turn_id: id.into(),
                action: CodexQueueAction::Queued,
                requested_by: "Authenticated member".into(),
                requested_by_user_id: "github:member".into(),
                trigger_message_id: None,
                reason: Some("Review timestamp bounds".into()),
                queue_position: Some(1),
                queue_size: 1,
                created_at: created_at.into(),
            })
        };
        let now = 1_784_462_400;
        let future = proposal_at("future", "2099-01-01T00:00:00.000Z");
        let stale = proposal_at("stale", "2026-07-19T11:45:00.000Z");
        let current = proposal_at("current", "2026-07-19T12:00:00.000Z");

        let mut controller =
            CodexRoomController::new(&room, std::env::temp_dir(), "Member", "github:member", None)
                .unwrap();
        assert_eq!(controller.observe(&future, now, false).unwrap(), None);
        assert!(controller.can_propose());
        assert_eq!(controller.observe(&stale, now, false).unwrap(), None);
        assert!(controller.can_propose());
        assert_eq!(controller.observe(&current, now, false).unwrap(), None);
        assert!(!controller.can_propose());
        assert_eq!(
            controller.machine.pending().unwrap().expires_at_unix,
            now + multaiplayer_cli::codex::PROPOSAL_TTL_SECONDS
        );

        let mut restarted =
            CodexRoomController::new(&room, std::env::temp_dir(), "Member", "github:member", None)
                .unwrap();
        assert_eq!(restarted.observe(&future, now + 60, false).unwrap(), None);
        assert!(restarted.can_propose());
    }

    #[test]
    fn headless_binary_command_journey_uses_the_real_relay_and_production_services() {
        let host_store = ThreadStore::default();
        let guest_store = ThreadStore::default();
        let seeded_host_identity =
            load_or_create_identity(&host_store, "github:maddiedreese", "binary-host").unwrap();
        let relay = BinaryRelay::start(&seeded_host_identity.public.device_id);
        let expected_origin = "https://relay.binary.test";
        let http = RewritingHttp::new(expected_origin, &relay.info.base_url);
        let (host_session, host_identity) = prepare_binary_identity(
            &relay,
            &host_store,
            &http,
            expected_origin,
            "github:maddiedreese",
            "binary-host",
        );
        let (guest_session, guest_identity) = prepare_binary_identity(
            &relay,
            &guest_store,
            &http,
            expected_origin,
            "github:tester",
            "binary-guest",
        );
        let host_mls_path = relay.info.temp_dir.join("binary-host-mls.sqlite");
        let guest_mls_path = relay.info.temp_dir.join("binary-guest-mls.sqlite");
        let room_id = "room-desktop".to_owned();
        {
            let mut mls =
                MlsClientService::open(&host_store, &host_identity, &host_mls_path).unwrap();
            assert_eq!(mls.create_group_idempotent(&room_id).unwrap(), 0);
        }

        let mut invite_output = Vec::new();
        run_authenticated_invite_command(
            Command::RoomInvite {
                selector: room_id.clone(),
            },
            &host_store,
            &http,
            expected_origin,
            &host_session,
            &host_identity,
            &host_mls_path,
            &mut std::io::Cursor::new(Vec::<u8>::new()),
            &mut invite_output,
            &mut Vec::new(),
        )
        .unwrap();
        let invite_output = String::from_utf8(invite_output).unwrap();
        let invite_id = invite_output
            .lines()
            .find_map(|line| line.strip_prefix("Invite ID: "))
            .unwrap()
            .to_owned();
        let invite_code = invite_output
            .lines()
            .find(|line| line.starts_with("https://open.multaiplayer.com/invite#"))
            .unwrap()
            .to_owned();

        let guest_http = http.clone();
        let guest_store_for_thread = guest_store.clone();
        let guest_invite_code = invite_code.clone();
        let guest = std::thread::spawn(move || {
            let mut output = Vec::new();
            let result = run_authenticated_invite_command(
                Command::RoomJoin,
                &guest_store_for_thread,
                &guest_http,
                expected_origin,
                &guest_session,
                &guest_identity,
                &guest_mls_path,
                &mut std::io::Cursor::new(format!("{guest_invite_code}\n")),
                &mut output,
                &mut Vec::new(),
            );
            (result, String::from_utf8(output).unwrap())
        });

        let mut denied = false;
        for _ in 0..30 {
            std::thread::sleep(Duration::from_millis(100));
            let mut output = Vec::new();
            let mut prompt = Vec::new();
            run_authenticated_invite_command(
                Command::RoomAdmissions {
                    selector: room_id.clone(),
                    invite_id: invite_id.clone(),
                },
                &host_store,
                &http,
                expected_origin,
                &host_session,
                &host_identity,
                &host_mls_path,
                &mut std::io::Cursor::new("deny\n"),
                &mut output,
                &mut prompt,
            )
            .unwrap();
            let output = String::from_utf8(output).unwrap();
            if output.contains("was denied") {
                let prompt = String::from_utf8(prompt).unwrap();
                assert!(prompt.contains("GitHub identity: github:tester"));
                assert!(prompt.contains("Device fingerprint: sha256:"));
                denied = true;
                break;
            }
        }
        assert!(denied, "binary host command never observed the request");
        let (result, guest_output) = guest.join().unwrap();
        assert_eq!(result, Err(InviteCliError::Denied));
        assert!(guest_output.contains("Admission requested."));
        assert!(!guest_output.contains(&invite_code));
    }

    #[test]
    fn binary_invite_commands_bind_the_production_orchestration_types() {
        let source = include_str!("main.rs");
        for required in [
            "RelayInviteBackend::new(",
            "InviteService::new(",
            "MlsClientService::open(",
            ".request_admission(",
            ".decide_from_trusted_prompt(",
            ".finish_admission_and_record_at(",
            ".finish_pending_admission_and_record(",
            ".revoke(",
        ] {
            assert!(
                source.contains(required),
                "missing binary binding: {required}"
            );
        }
    }
}
