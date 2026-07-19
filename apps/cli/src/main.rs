use multaiplayer_cli::{
    auth::{AuthClient, DevicePollResult},
    identity::load_or_create_identity,
    mls::MlsClientService,
    platform::{KeychainStore, MacOsUrlOpener, ReqwestHttpClient},
    relay::WorkspaceClient,
    room::{opened_room_message, CreateRoomRequest, RelayRoomBackend, RoomService},
    GITHUB_CLIENT_ID, RELAY_HTTP_ORIGIN,
};
use std::{path::PathBuf, process::ExitCode, thread};

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
        | Command::RoomOpen { .. } => unreachable!("auth runner received non-auth command"),
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
        assert_eq!(parse_args(["auth", "login", "--token", "secret"]), Err(()));
        assert_eq!(parse_args(["--help", "extra"]), Err(()));
    }

    #[test]
    fn all_output_is_fixed_and_bounded() {
        for output in [HELP, VERSION, UNSUPPORTED] {
            assert!(output.len() <= 1024);
        }
    }
}
