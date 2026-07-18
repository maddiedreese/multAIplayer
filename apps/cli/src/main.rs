use std::process::ExitCode;

const HELP: &str = concat!(
    "multAIplayer ",
    env!("CARGO_PKG_VERSION"),
    "\n\n",
    "Usage: multAIplayer [OPTIONS]\n\n",
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
        _ => Err(()),
    }
}

fn main() -> ExitCode {
    match parse_args(
        std::env::args_os()
            .skip(1)
            .map(|arg| arg.to_string_lossy().into_owned()),
    ) {
        Ok(Command::Help) => {
            print!("{HELP}");
            ExitCode::SUCCESS
        }
        Ok(Command::Version) => {
            print!("{VERSION}");
            ExitCode::SUCCESS
        }
        Err(()) => {
            eprint!("{UNSUPPORTED}");
            ExitCode::from(2)
        }
    }
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
        assert_eq!(parse_args(["room", "list"]), Err(()));
        assert_eq!(parse_args(["--help", "extra"]), Err(()));
    }

    #[test]
    fn all_output_is_fixed_and_bounded() {
        for output in [HELP, VERSION, UNSUPPORTED] {
            assert!(output.len() <= 512);
        }
    }
}
