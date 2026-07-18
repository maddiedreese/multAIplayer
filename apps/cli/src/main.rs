use multaiplayer_cli::{
    auth::{AuthClient, DevicePollResult},
    platform::{KeychainStore, MacOsUrlOpener, ReqwestHttpClient},
    GITHUB_CLIENT_ID, RELAY_HTTP_ORIGIN,
};
use std::{process::ExitCode, thread};

const HELP: &str = concat!(
    "multAIplayer ",
    env!("CARGO_PKG_VERSION"),
    "\n\n",
    "Usage: multAIplayer [OPTIONS]\n",
    "       multAIplayer auth <COMMAND>\n\n",
    "Auth commands:\n",
    "  login [--open]  Sign in with GitHub's device flow\n",
    "  status          Restore and report the current relay session\n",
    "  logout          Clear auth credentials; retain device and room keys\n\n",
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
        _ => Err(()),
    }
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
        Err(()) => {
            eprint!("{UNSUPPORTED}");
            ExitCode::from(2)
        }
    }
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
        Command::Help | Command::Version => unreachable!("auth runner received non-auth command"),
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
        assert_eq!(parse_args(["room", "list"]), Err(()));
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
