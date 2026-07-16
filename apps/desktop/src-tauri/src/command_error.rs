use serde::Serialize;
use std::fmt;

const MAX_COMMAND_ERROR_MESSAGE_CHARS: usize = 800;
const INTERNAL_ERROR_MESSAGE: &str = "The native command could not be completed.";

macro_rules! define_command_error_codes {
    ($($variant:ident => $serialized:literal),+ $(,)?) => {
        #[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
        pub(crate) enum CommandErrorCode {
            $(#[serde(rename = $serialized)] $variant),+
        }

        impl CommandErrorCode {
            #[cfg(test)]
            const ALL: &'static [Self] = &[$(Self::$variant),+];
        }
    };
}

define_command_error_codes! {
    CryptoError => "crypto_error",
    InternalError => "internal_error",
    InvalidArgument => "invalid_argument",
    NotFound => "not_found",
    ProcessError => "process_error",
    RequiresRejoin => "requires_rejoin",
    StorageError => "storage_error",
    Unauthorized => "unauthorized",
    Unavailable => "unavailable",
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommandError {
    pub(crate) code: CommandErrorCode,
    pub(crate) message: String,
}

pub(crate) type CommandResult<T> = Result<T, CommandError>;

impl CommandError {
    pub(crate) fn new(code: CommandErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: bound_public_message(message.into()),
        }
    }

    pub(crate) fn requires_rejoin(message: impl Into<String>) -> Self {
        Self::new(CommandErrorCode::RequiresRejoin, message)
    }

    pub(crate) fn crypto(message: impl Into<String>) -> Self {
        Self::new(CommandErrorCode::CryptoError, message)
    }

    pub(crate) fn invalid_argument(message: impl Into<String>) -> Self {
        Self::new(CommandErrorCode::InvalidArgument, message)
    }

    pub(crate) fn not_found(message: impl Into<String>) -> Self {
        Self::new(CommandErrorCode::NotFound, message)
    }

    pub(crate) fn process(message: impl Into<String>) -> Self {
        Self::new(CommandErrorCode::ProcessError, message)
    }

    pub(crate) fn storage(message: impl Into<String>) -> Self {
        Self::new(CommandErrorCode::StorageError, message)
    }

    pub(crate) fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(CommandErrorCode::Unauthorized, message)
    }

    pub(crate) fn unavailable(message: impl Into<String>) -> Self {
        Self::new(CommandErrorCode::Unavailable, message)
    }
}

// Active native helpers in the Codex, terminal, Git, browser, archive, and MLS
// command paths still return human-readable String errors. Keep their Tauri IPC
// boundary structured until those helpers are converted within their owning domains.
impl From<String> for CommandError {
    fn from(_message: String) -> Self {
        Self::new(CommandErrorCode::InternalError, INTERNAL_ERROR_MESSAGE)
    }
}

fn bound_public_message(message: String) -> String {
    let mut chars = message.chars();
    let bounded = chars
        .by_ref()
        .take(MAX_COMMAND_ERROR_MESSAGE_CHARS)
        .collect::<String>();
    if chars.next().is_some() {
        format!("{bounded}…")
    } else {
        bounded
    }
}

impl From<&str> for CommandError {
    fn from(message: &str) -> Self {
        Self::from(message.to_string())
    }
}

impl fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CommandError {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn serializes_stable_code_and_human_message() {
        let value = serde_json::to_value(CommandError::new(
            CommandErrorCode::InternalError,
            "Copy can change without changing the code",
        ))
        .expect("command error should serialize");
        assert_eq!(
            value,
            serde_json::json!({
                "code": "internal_error",
                "message": "Copy can change without changing the code"
            })
        );
    }

    #[test]
    fn string_based_native_helpers_hide_unclassified_causes() {
        let error = CommandError::from("native helper failure".to_string());
        assert_eq!(error.code, CommandErrorCode::InternalError);
        assert_eq!(error.message, INTERNAL_ERROR_MESSAGE);
    }

    #[test]
    fn public_messages_are_bounded() {
        let error =
            CommandError::invalid_argument("x".repeat(MAX_COMMAND_ERROR_MESSAGE_CHARS + 20));
        assert_eq!(
            error.message.chars().count(),
            MAX_COMMAND_ERROR_MESSAGE_CHARS + 1
        );
        assert!(error.message.ends_with('…'));
    }

    #[test]
    fn serializes_every_frontend_supported_code() {
        let cases = [
            (CommandError::crypto("message"), "crypto_error"),
            (CommandError::from("message"), "internal_error"),
            (
                CommandError::invalid_argument("message"),
                "invalid_argument",
            ),
            (CommandError::not_found("message"), "not_found"),
            (CommandError::process("message"), "process_error"),
            (CommandError::requires_rejoin("message"), "requires_rejoin"),
            (CommandError::storage("message"), "storage_error"),
            (CommandError::unauthorized("message"), "unauthorized"),
            (CommandError::unavailable("message"), "unavailable"),
        ];

        for (error, expected_code) in cases {
            let value = serde_json::to_value(error).expect("command error should serialize");
            assert_eq!(value["code"], expected_code);
            if expected_code == "internal_error" {
                assert_eq!(value["message"], INTERNAL_ERROR_MESSAGE);
            } else {
                assert_eq!(value["message"], "message");
            }
        }
    }

    #[test]
    fn rust_codes_match_the_shared_frontend_vocabulary() {
        let shared = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(
            include_str!("../../native-command-error-codes.json"),
        )
        .expect("shared native command error vocabulary should be valid JSON")
        .into_iter()
        .map(|(code, _)| code)
        .collect::<BTreeSet<_>>();
        let rust = CommandErrorCode::ALL
            .iter()
            .copied()
            .map(|code| {
                serde_json::to_value(code)
                    .expect("command error code should serialize")
                    .as_str()
                    .expect("command error code should serialize as a string")
                    .to_string()
            })
            .collect::<BTreeSet<_>>();

        assert_eq!(rust, shared);
    }
}
