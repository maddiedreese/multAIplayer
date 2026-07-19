use multaiplayer_cli::{
    auth::{AuthClient, DevicePollResult},
    identity::load_or_create_identity,
    invite::{parse_invite_code, InviteError, InviteService, RelayInviteBackend},
    mls::MlsClientService,
    platform::{KeychainStore, MacOsUrlOpener, ReqwestHttpClient},
    relay::{WorkspaceClient, WorkspaceSnapshot},
    room::{opened_room_message, CreateRoomRequest, RelayRoomBackend, RoomService},
    GITHUB_CLIENT_ID, RELAY_HTTP_ORIGIN,
};
use multaiplayer_protocol::RoomRecord;
use std::{
    io::{BufRead, Read, Write},
    path::PathBuf,
    process::ExitCode,
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
    "  open <ROOM>     Open a locally associated room\n\n",
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
    RoomOpen { selector: String },
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
        Ok(command @ (Command::RoomList | Command::RoomCreate(_) | Command::RoomOpen { .. })) => {
            run_room(command)
        }
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
    let mut service = RoomService::new(
        &store,
        &mut backend,
        &mut mls,
        &session.user.id,
        &identity.public.device_id,
        RELAY_HTTP_ORIGIN,
    );
    let result = match command {
        Command::RoomCreate(request) => service.create(&request),
        Command::RoomOpen { selector } => service.open(&selector),
        _ => unreachable!("room runner received non-room command"),
    };
    match result {
        Ok(opened) => {
            println!("{}", opened_room_message(&opened));
            ExitCode::SUCCESS
        }
        Err(error) => room_error(error),
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
    let mut mls = MlsClientService::open(&store, &identity, &mls_path)
        .map_err(|error| InviteCliError::Invite(error.into()))?;

    let device_session = {
        let mut backend =
            RelayRoomBackend::new(&store, &http, RELAY_HTTP_ORIGIN, &session, &identity)
                .map_err(InviteCliError::Room)?;
        backend
            .establish_device_session_for_invites()
            .map_err(InviteCliError::Room)?
    };
    let room = match &command {
        Command::RoomInvite { selector }
        | Command::RoomAdmissions { selector, .. }
        | Command::RoomRevoke { selector } => {
            let workspace = WorkspaceClient::new(&store, &http, RELAY_HTTP_ORIGIN)
                .and_then(|client| client.load())
                .map_err(InviteCliError::Core)?;
            Some(select_invite_room(&workspace, selector)?)
        }
        Command::RoomJoin | Command::RoomFinish { .. } => None,
        _ => unreachable!("invite runner received non-invite command"),
    };
    let mut backend =
        RelayInviteBackend::new(&store, &http, RELAY_HTTP_ORIGIN, &session, &identity)
            .map_err(InviteCliError::Invite)?;
    let mut service = InviteService::new(&store, &mut backend);
    match command {
        Command::RoomInvite { .. } => {
            let room = room.as_ref().ok_or(InviteCliError::RoomSelection)?;
            let code = Zeroizing::new(
                service
                    .issue(room, &identity)
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
                .revoke(room, &identity)
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
                    &identity,
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
                        &identity,
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
                .request_admission(
                    code.as_str(),
                    &identity,
                    device_session.as_str(),
                    &now,
                    &mls,
                )
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
                match service.finish_admission_at(&request, device_session.as_str(), &now, &mut mls)
                {
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
        }
        Command::RoomFinish { request_id } => {
            let pending = mls
                .pending_invite_admission(&request_id)
                .map_err(|error| InviteCliError::Invite(error.into()))?
                .ok_or(InviteCliError::Invite(InviteError::Unavailable))?;
            let now = utc_timestamp()?;
            let epoch = service
                .finish_pending_admission(&pending, device_session.as_str(), &now, &mut mls)
                .map_err(InviteCliError::Invite)?;
            if let Some(epoch) = epoch {
                writeln!(output, "Admission approved. Joined MLS epoch {epoch}.")
                    .map_err(|_| InviteCliError::Output)?;
            } else {
                return Err(InviteCliError::Denied);
            }
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
    fn binary_invite_commands_bind_the_production_orchestration_types() {
        let source = include_str!("main.rs");
        for required in [
            "RelayInviteBackend::new(",
            "InviteService::new(",
            "MlsClientService::open(",
            ".request_admission(",
            ".decide_from_trusted_prompt(",
            ".finish_admission_at(",
            ".finish_pending_admission(",
            ".revoke(",
        ] {
            assert!(
                source.contains(required),
                "missing binary binding: {required}"
            );
        }
    }
}
