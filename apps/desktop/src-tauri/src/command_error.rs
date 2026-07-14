use serde::Serialize;
use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CommandErrorCode {
    InternalError,
    RequiresRejoin,
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
            message: message.into(),
        }
    }

    pub(crate) fn requires_rejoin(message: impl Into<String>) -> Self {
        Self::new(CommandErrorCode::RequiresRejoin, message)
    }
}

impl From<String> for CommandError {
    fn from(message: String) -> Self {
        Self::new(CommandErrorCode::InternalError, message)
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
    fn legacy_string_conversion_has_a_stable_fallback_code() {
        let error = CommandError::from("legacy failure".to_string());
        assert_eq!(error.code, CommandErrorCode::InternalError);
        assert_eq!(error.message, "legacy failure");
    }
}
