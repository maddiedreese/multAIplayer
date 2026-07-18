use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

use crate::validation::{
    bounded, datetime, deserialize_optional_non_null, deserialize_required_nullable, device_id,
    normalize_integral_json_numbers, safe_i64, safe_u64, user_id, Nullable, ProtocolError,
    Validate, MAX_CODEX_MODEL_CHARS, MAX_CODEX_THREAD_ID_CHARS, MAX_DISPLAY_NAME_CHARS,
    MAX_ENVELOPE_ID_CHARS, MAX_LONG_TEXT_CHARS, MAX_MEDIUM_TEXT_CHARS, MAX_PROJECT_PATH_CHARS,
    MAX_SHORT_TEXT_CHARS, MAX_URL_CHARS, MAX_USER_ID_CHARS,
};
use crate::{CatalogSelectionPolicy, CodexReasoningEffort, CodexSandboxLevel, CodexSpeed};

pub const MAX_MESSAGE_ATTACHMENTS: usize = 5;
pub const MAX_EMBEDDED_ATTACHMENT_CHARS: usize = 80_000;
pub const MAX_CODEX_QUEUE_SIZE: u64 = 5;

macro_rules! string_enum {
    ($name:ident { $($variant:ident => $wire:literal),+ $(,)? }) => {
        #[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
        pub enum $name {
            $(#[serde(rename = $wire)] $variant),+
        }

        impl Validate for $name {
            fn validate(&self) -> Result<(), ProtocolError> { Ok(()) }
        }
    };
}

string_enum!(ChatRole {
    Human => "human",
    Codex => "codex",
    System => "system",
});
string_enum!(ReactionAction { Add => "add", Remove => "remove" });
string_enum!(PreviewStatus {
    Starting => "starting",
    Live => "live",
    Stopped => "stopped",
    Error => "error",
});
string_enum!(RequestStatus { Approved => "approved", Denied => "denied" });
string_enum!(CodexTurnStatus {
    Started => "started",
    Event => "event",
    Completed => "completed",
    Failed => "failed",
});
string_enum!(CodexActivityKind {
    Command => "command",
    FileChange => "file_change",
    Tool => "tool",
    WebSearch => "web_search",
    ImageGeneration => "image_generation",
    Agent => "agent",
    Review => "review",
    Hook => "hook",
    Reasoning => "reasoning",
    Other => "other",
});
string_enum!(CodexActivityStatus {
    Started => "started",
    Running => "running",
    Completed => "completed",
    Failed => "failed",
    Declined => "declined",
});
string_enum!(FileChangeAction { Add => "add", Delete => "delete", Update => "update" });
string_enum!(WebSearchAction {
    Search => "search",
    OpenPage => "open_page",
    FindInPage => "find_in_page",
    Other => "other",
});
string_enum!(AgentAction {
    Spawn => "spawn",
    Send => "send",
    Resume => "resume",
    Wait => "wait",
    Close => "close",
});
string_enum!(CodexQueueAction {
    Queued => "queued",
    Cancelled => "cancelled",
    Coalesced => "coalesced",
    Promoted => "promoted",
    Dropped => "dropped",
});

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ChatAttachment {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub media_type: String,
    pub size: u64,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub content: Option<String>,
    #[serde(
        rename = "blobId",
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub blob_id: Option<String>,
    #[serde(
        rename = "blobBytes",
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub blob_bytes: Option<u64>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub truncated: Option<bool>,
}

impl Validate for ChatAttachment {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded("chat.attachment.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded("chat.attachment.name", &self.name, 1, MAX_SHORT_TEXT_CHARS)?;
        bounded(
            "chat.attachment.type",
            &self.media_type,
            1,
            MAX_SHORT_TEXT_CHARS,
        )?;
        safe_u64("chat.attachment.size", self.size)?;
        if let Some(value) = &self.content {
            bounded(
                "chat.attachment.content",
                value,
                0,
                MAX_EMBEDDED_ATTACHMENT_CHARS,
            )?;
        }
        if let Some(value) = &self.blob_id {
            bounded("chat.attachment.blobId", value, 1, MAX_ENVELOPE_ID_CHARS)?;
        }
        if let Some(value) = self.blob_bytes {
            safe_u64("chat.attachment.blobBytes", value)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatPlaintextPayload {
    pub id: String,
    pub author: String,
    pub author_user_id: String,
    pub role: ChatRole,
    pub body: String,
    pub time: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub created_at: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub reply_to: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub attachments: Option<Vec<ChatAttachment>>,
}

impl Validate for ChatPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded("chat.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded("chat.author", &self.author, 1, MAX_DISPLAY_NAME_CHARS)?;
        bounded(
            "chat.authorUserId",
            &self.author_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        bounded("chat.body", &self.body, 0, MAX_LONG_TEXT_CHARS)?;
        bounded("chat.time", &self.time, 1, MAX_SHORT_TEXT_CHARS)?;
        if let Some(value) = &self.created_at {
            datetime("chat.createdAt", value)?;
        }
        if let Some(value) = &self.reply_to {
            bounded("chat.replyTo", value, 1, MAX_ENVELOPE_ID_CHARS)?;
        }
        if let Some(values) = &self.attachments {
            if values.len() > MAX_MESSAGE_ATTACHMENTS {
                return Err(ProtocolError::invalid("chat attachments exceed 5 items"));
            }
            for value in values {
                value.validate()?;
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatEditPlaintextPayload {
    pub id: String,
    pub message_id: String,
    pub body: String,
    pub edited_by: String,
    pub edited_by_user_id: String,
    pub edited_at: String,
}

impl Validate for ChatEditPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded("chatEdit.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded(
            "chatEdit.messageId",
            &self.message_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        bounded("chatEdit.body", &self.body, 1, MAX_LONG_TEXT_CHARS)?;
        bounded(
            "chatEdit.editedBy",
            &self.edited_by,
            1,
            MAX_DISPLAY_NAME_CHARS,
        )?;
        bounded(
            "chatEdit.editedByUserId",
            &self.edited_by_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        datetime("chatEdit.editedAt", &self.edited_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDeletePlaintextPayload {
    pub id: String,
    pub message_id: String,
    pub deleted_by: String,
    pub deleted_by_user_id: String,
    pub deleted_at: String,
}

impl Validate for ChatDeletePlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded("chatDelete.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded(
            "chatDelete.messageId",
            &self.message_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        bounded(
            "chatDelete.deletedBy",
            &self.deleted_by,
            1,
            MAX_DISPLAY_NAME_CHARS,
        )?;
        bounded(
            "chatDelete.deletedByUserId",
            &self.deleted_by_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        datetime("chatDelete.deletedAt", &self.deleted_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReactionPlaintextPayload {
    pub id: String,
    pub message_id: String,
    pub emoji: String,
    pub action: ReactionAction,
    pub reactor: String,
    pub reactor_user_id: String,
    pub created_at: String,
}

impl Validate for ChatReactionPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded("reaction.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded(
            "reaction.messageId",
            &self.message_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        bounded("reaction.emoji", &self.emoji, 1, 16)?;
        bounded("reaction.reactor", &self.reactor, 1, MAX_DISPLAY_NAME_CHARS)?;
        bounded(
            "reaction.reactorUserId",
            &self.reactor_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        datetime("reaction.createdAt", &self.created_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPreviewPlaintextPayload {
    pub event_type: String,
    pub id: String,
    pub shared_by: String,
    pub shared_by_user_id: String,
    pub source_url: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub public_url: Option<String>,
    pub status: PreviewStatus,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Validate for LocalPreviewPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        literal("preview.eventType", &self.event_type, "local.preview")?;
        bounded("preview.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded(
            "preview.sharedBy",
            &self.shared_by,
            1,
            MAX_DISPLAY_NAME_CHARS,
        )?;
        bounded(
            "preview.sharedByUserId",
            &self.shared_by_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        bounded("preview.sourceUrl", &self.source_url, 1, MAX_URL_CHARS)?;
        if let Some(value) = &self.public_url {
            bounded("preview.publicUrl", value, 1, MAX_URL_CHARS)?;
        }
        if let Some(value) = &self.message {
            bounded("preview.message", value, 0, MAX_MEDIUM_TEXT_CHARS)?;
        }
        datetime("preview.createdAt", &self.created_at)?;
        datetime("preview.updatedAt", &self.updated_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRequestPlaintextPayload {
    pub id: String,
    pub requester: String,
    pub requester_user_id: String,
    pub command: String,
    pub cwd: String,
    pub requested_at: String,
}

impl Validate for TerminalRequestPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded("terminalRequest.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded(
            "terminalRequest.requester",
            &self.requester,
            1,
            MAX_DISPLAY_NAME_CHARS,
        )?;
        bounded(
            "terminalRequest.requesterUserId",
            &self.requester_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        bounded(
            "terminalRequest.command",
            &self.command,
            1,
            MAX_MEDIUM_TEXT_CHARS,
        )?;
        bounded("terminalRequest.cwd", &self.cwd, 1, MAX_PROJECT_PATH_CHARS)?;
        datetime("terminalRequest.requestedAt", &self.requested_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserRequestPlaintextPayload {
    pub id: String,
    pub requester: String,
    pub requester_user_id: String,
    pub url: String,
    pub reason: String,
    pub requested_at: String,
}

impl Validate for BrowserRequestPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded("browserRequest.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded(
            "browserRequest.requester",
            &self.requester,
            1,
            MAX_DISPLAY_NAME_CHARS,
        )?;
        bounded(
            "browserRequest.requesterUserId",
            &self.requester_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        bounded("browserRequest.url", &self.url, 1, MAX_URL_CHARS)?;
        bounded(
            "browserRequest.reason",
            &self.reason,
            0,
            MAX_MEDIUM_TEXT_CHARS,
        )?;
        datetime("browserRequest.requestedAt", &self.requested_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileSaveRequestPlaintextPayload {
    pub event_type: String,
    pub id: String,
    pub requester: String,
    pub requester_user_id: String,
    pub path: String,
    pub previous_content: String,
    pub next_content: String,
    pub requested_at: String,
}

impl Validate for WorkspaceFileSaveRequestPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        literal(
            "workspaceRequest.eventType",
            &self.event_type,
            "workspace.file.save",
        )?;
        bounded("workspaceRequest.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded(
            "workspaceRequest.requester",
            &self.requester,
            1,
            MAX_DISPLAY_NAME_CHARS,
        )?;
        bounded(
            "workspaceRequest.requesterUserId",
            &self.requester_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        bounded(
            "workspaceRequest.path",
            &self.path,
            1,
            MAX_PROJECT_PATH_CHARS,
        )?;
        bounded(
            "workspaceRequest.previousContent",
            &self.previous_content,
            0,
            MAX_LONG_TEXT_CHARS,
        )?;
        bounded(
            "workspaceRequest.nextContent",
            &self.next_content,
            0,
            MAX_LONG_TEXT_CHARS,
        )?;
        datetime("workspaceRequest.requestedAt", &self.requested_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestStatusPlaintextPayload {
    pub request_id: String,
    pub status: RequestStatus,
    pub decided_by: String,
    pub decided_by_user_id: String,
    pub decided_at: String,
}

impl Validate for RequestStatusPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded(
            "requestStatus.requestId",
            &self.request_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        bounded(
            "requestStatus.decidedBy",
            &self.decided_by,
            1,
            MAX_DISPLAY_NAME_CHARS,
        )?;
        bounded(
            "requestStatus.decidedByUserId",
            &self.decided_by_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        datetime("requestStatus.decidedAt", &self.decided_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CodexTurnRiskFlagPayload {
    pub id: String,
    pub label: String,
    pub source: String,
    pub risk: String,
    pub severity: String,
}

impl Validate for CodexTurnRiskFlagPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded("risk.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded("risk.label", &self.label, 1, MAX_MEDIUM_TEXT_CHARS)?;
        bounded("risk.source", &self.source, 1, MAX_SHORT_TEXT_CHARS)?;
        bounded("risk.risk", &self.risk, 1, MAX_SHORT_TEXT_CHARS)?;
        literal("risk.severity", &self.severity, "warning")
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexEventPlaintextPayload {
    pub event_type: String,
    pub turn_id: String,
    pub status: CodexTurnStatus,
    pub message: String,
    pub model: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub thread_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub event_name: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub consumed_message_ids: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub risk_flags: Option<Vec<CodexTurnRiskFlagPayload>>,
    pub host: String,
    pub host_user_id: String,
    pub created_at: String,
}

impl Validate for CodexEventPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        literal("codexEvent.eventType", &self.event_type, "codex.turn")?;
        bounded("codexEvent.turnId", &self.turn_id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded("codexEvent.message", &self.message, 0, MAX_LONG_TEXT_CHARS)?;
        bounded("codexEvent.model", &self.model, 1, MAX_CODEX_MODEL_CHARS)?;
        if let Some(value) = &self.thread_id {
            bounded("codexEvent.threadId", value, 1, MAX_CODEX_THREAD_ID_CHARS)?;
        }
        if let Some(value) = &self.event_name {
            bounded("codexEvent.eventName", value, 1, MAX_SHORT_TEXT_CHARS)?;
        }
        if let Some(values) = &self.consumed_message_ids {
            validate_bounded_strings(
                values,
                256,
                1,
                MAX_ENVELOPE_ID_CHARS,
                "codexEvent.consumedMessageIds",
            )?;
        }
        if let Some(values) = &self.risk_flags {
            if values.len() > 24 {
                return Err(ProtocolError::invalid(
                    "codexEvent.riskFlags exceeds 24 items",
                ));
            }
            for value in values {
                value.validate()?;
            }
        }
        bounded("codexEvent.host", &self.host, 1, MAX_DISPLAY_NAME_CHARS)?;
        bounded(
            "codexEvent.hostUserId",
            &self.host_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        datetime("codexEvent.createdAt", &self.created_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CodexActivityDetail {
    Reasoning {
        summaries: Vec<String>,
        #[serde(
            rename = "rawContent",
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        raw_content: Option<Vec<String>>,
    },
    Command {
        command: String,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        output: Option<String>,
        #[serde(
            rename = "exitCode",
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        exit_code: Option<i64>,
        #[serde(
            rename = "durationMs",
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        duration_ms: Option<u64>,
    },
    FileChange {
        changes: Vec<FileChange>,
    },
    Tool {
        name: String,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        server: Option<String>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        arguments: Option<String>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        result: Option<String>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        error: Option<String>,
        #[serde(
            rename = "durationMs",
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        duration_ms: Option<u64>,
    },
    WebSearch {
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        action: Option<WebSearchAction>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        query: Option<String>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        url: Option<String>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        pattern: Option<String>,
    },
    ImageGeneration {
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        prompt: Option<String>,
    },
    Agent {
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        prompt: Option<String>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        model: Option<String>,
        #[serde(
            rename = "reasoningEffort",
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        reasoning_effort: Option<CodexReasoningEffort>,
        #[serde(
            default,
            deserialize_with = "deserialize_optional_non_null",
            skip_serializing_if = "Option::is_none"
        )]
        states: Option<Vec<AgentState>>,
    },
}

impl Validate for CodexActivityDetail {
    fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::Reasoning {
                summaries,
                raw_content,
            } => {
                validate_bounded_strings(
                    summaries,
                    12,
                    1,
                    MAX_MEDIUM_TEXT_CHARS,
                    "activity.summaries",
                )?;
                if let Some(values) = raw_content {
                    validate_bounded_strings(
                        values,
                        12,
                        1,
                        MAX_MEDIUM_TEXT_CHARS,
                        "activity.rawContent",
                    )?;
                }
                Ok(())
            }
            Self::Command {
                command,
                output,
                exit_code,
                duration_ms,
            } => {
                bounded("activity.command", command, 1, MAX_LONG_TEXT_CHARS)?;
                if let Some(value) = output {
                    bounded("activity.output", value, 0, MAX_LONG_TEXT_CHARS)?;
                }
                if let Some(value) = exit_code {
                    safe_i64("activity.exitCode", *value)?;
                }
                if let Some(value) = duration_ms {
                    safe_u64("activity.durationMs", *value)?;
                }
                Ok(())
            }
            Self::FileChange { changes } => {
                if changes.len() > 64 {
                    return Err(ProtocolError::invalid("activity.changes exceeds 64 items"));
                }
                for value in changes {
                    value.validate()?;
                }
                Ok(())
            }
            Self::Tool {
                name,
                server,
                arguments,
                result,
                error,
                duration_ms,
            } => {
                bounded("activity.tool.name", name, 1, MAX_SHORT_TEXT_CHARS)?;
                if let Some(value) = server {
                    bounded("activity.tool.server", value, 1, MAX_SHORT_TEXT_CHARS)?;
                }
                if let Some(value) = arguments {
                    bounded("activity.tool.arguments", value, 0, MAX_LONG_TEXT_CHARS)?;
                }
                if let Some(value) = result {
                    bounded("activity.tool.result", value, 0, MAX_LONG_TEXT_CHARS)?;
                }
                if let Some(value) = error {
                    bounded("activity.tool.error", value, 0, MAX_MEDIUM_TEXT_CHARS)?;
                }
                if let Some(value) = duration_ms {
                    safe_u64("activity.tool.durationMs", *value)?;
                }
                Ok(())
            }
            Self::WebSearch {
                query,
                url,
                pattern,
                ..
            } => {
                if let Some(value) = query {
                    bounded("activity.web.query", value, 0, MAX_MEDIUM_TEXT_CHARS)?;
                }
                if let Some(value) = url {
                    bounded("activity.web.url", value, 0, MAX_URL_CHARS)?;
                }
                if let Some(value) = pattern {
                    bounded("activity.web.pattern", value, 0, MAX_MEDIUM_TEXT_CHARS)?;
                }
                Ok(())
            }
            Self::ImageGeneration { prompt } => {
                if let Some(value) = prompt {
                    bounded("activity.image.prompt", value, 0, MAX_LONG_TEXT_CHARS)?;
                }
                Ok(())
            }
            Self::Agent {
                prompt,
                model,
                states,
                ..
            } => {
                if let Some(value) = prompt {
                    bounded("activity.agent.prompt", value, 0, MAX_LONG_TEXT_CHARS)?;
                }
                if let Some(value) = model {
                    bounded("activity.agent.model", value, 0, MAX_CODEX_MODEL_CHARS)?;
                }
                if let Some(values) = states {
                    if values.len() > 16 {
                        return Err(ProtocolError::invalid(
                            "activity.agent.states exceeds 16 items",
                        ));
                    }
                    for value in values {
                        value.validate()?;
                    }
                }
                Ok(())
            }
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct FileChange {
    pub path: String,
    pub action: FileChangeAction,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub diff: Option<String>,
}

impl Validate for FileChange {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded(
            "activity.change.path",
            &self.path,
            1,
            MAX_PROJECT_PATH_CHARS,
        )?;
        if let Some(value) = &self.diff {
            bounded("activity.change.diff", value, 0, MAX_LONG_TEXT_CHARS)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentState {
    pub thread_id: String,
    pub status: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub message: Option<String>,
}

impl Validate for AgentState {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded(
            "agentState.threadId",
            &self.thread_id,
            1,
            MAX_CODEX_THREAD_ID_CHARS,
        )?;
        bounded("agentState.status", &self.status, 1, MAX_SHORT_TEXT_CHARS)?;
        if let Some(value) = &self.message {
            bounded("agentState.message", value, 0, MAX_MEDIUM_TEXT_CHARS)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProjection {
    pub action: AgentAction,
    pub sender_id: String,
    pub receiver_ids: Vec<String>,
}

impl Validate for AgentProjection {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded(
            "activity.agent.senderId",
            &self.sender_id,
            1,
            MAX_CODEX_THREAD_ID_CHARS,
        )?;
        validate_bounded_strings(
            &self.receiver_ids,
            16,
            1,
            MAX_CODEX_THREAD_ID_CHARS,
            "activity.agent.receiverIds",
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexActivityPlaintextPayload {
    pub event_type: String,
    pub activity_id: String,
    pub turn_id: String,
    pub item_id: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub thread_id: Option<String>,
    pub kind: CodexActivityKind,
    pub status: CodexActivityStatus,
    pub title: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub details: Option<CodexActivityDetail>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub agent: Option<AgentProjection>,
    pub started_at: String,
    pub updated_at: String,
    pub host: String,
    pub host_user_id: String,
}

impl Validate for CodexActivityPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        literal("activity.eventType", &self.event_type, "codex.activity")?;
        bounded(
            "activity.activityId",
            &self.activity_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        bounded("activity.turnId", &self.turn_id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded("activity.itemId", &self.item_id, 1, MAX_ENVELOPE_ID_CHARS)?;
        if let Some(value) = &self.thread_id {
            bounded("activity.threadId", value, 1, MAX_CODEX_THREAD_ID_CHARS)?;
        }
        bounded("activity.title", &self.title, 1, MAX_SHORT_TEXT_CHARS)?;
        if let Some(value) = &self.details {
            value.validate()?;
        }
        if let Some(value) = &self.agent {
            value.validate()?;
        }
        datetime("activity.startedAt", &self.started_at)?;
        datetime("activity.updatedAt", &self.updated_at)?;
        bounded("activity.host", &self.host, 1, MAX_DISPLAY_NAME_CHARS)?;
        bounded(
            "activity.hostUserId",
            &self.host_user_id,
            1,
            MAX_USER_ID_CHARS,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexQueuePlaintextPayload {
    pub event_type: String,
    pub queue_event_id: String,
    pub turn_id: String,
    pub action: CodexQueueAction,
    pub requested_by: String,
    pub requested_by_user_id: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub trigger_message_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub reason: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub queue_position: Option<u64>,
    pub queue_size: u64,
    pub created_at: String,
}

impl Validate for CodexQueuePlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        literal("queue.eventType", &self.event_type, "codex.queue")?;
        bounded(
            "queue.queueEventId",
            &self.queue_event_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        bounded("queue.turnId", &self.turn_id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded(
            "queue.requestedBy",
            &self.requested_by,
            1,
            MAX_DISPLAY_NAME_CHARS,
        )?;
        bounded(
            "queue.requestedByUserId",
            &self.requested_by_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        if let Some(value) = &self.trigger_message_id {
            bounded("queue.triggerMessageId", value, 1, MAX_ENVELOPE_ID_CHARS)?;
        }
        if let Some(value) = &self.reason {
            bounded("queue.reason", value, 0, MAX_MEDIUM_TEXT_CHARS)?;
        }
        if let Some(value) = self.queue_position {
            if value == 0 || value > MAX_CODEX_QUEUE_SIZE {
                return Err(ProtocolError::invalid("queuePosition must be 1..=5"));
            }
        }
        if self.queue_size > MAX_CODEX_QUEUE_SIZE {
            return Err(ProtocolError::invalid("queueSize must be 0..=5"));
        }
        if matches!(
            self.action,
            CodexQueueAction::Queued | CodexQueueAction::Promoted
        ) && self.queue_position.is_none()
        {
            return Err(ProtocolError::invalid(
                "queued and promoted events require queuePosition",
            ));
        }
        datetime("queue.createdAt", &self.created_at)
    }
}

fn literal(field: &str, actual: &str, expected: &str) -> Result<(), ProtocolError> {
    if actual == expected {
        Ok(())
    } else {
        Err(ProtocolError::invalid(format!(
            "{field} must equal {expected}"
        )))
    }
}

fn validate_bounded_strings(
    values: &[String],
    max_items: usize,
    min_chars: usize,
    max_chars: usize,
    field: &str,
) -> Result<(), ProtocolError> {
    if values.len() > max_items {
        return Err(ProtocolError::invalid(format!(
            "{field} exceeds {max_items} items"
        )));
    }
    for value in values {
        bounded(field, value, min_chars, max_chars)?;
    }
    Ok(())
}

fn parse_validated<T>(mut value: Value) -> Result<T, ProtocolError>
where
    T: DeserializeOwned + Validate,
{
    normalize_integral_json_numbers(&mut value);
    let parsed: T = serde_json::from_value(value).map_err(ProtocolError::json)?;
    parsed.validate()?;
    Ok(parsed)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResultPlaintextPayload {
    pub event_type: String,
    pub request_id: String,
    pub command: String,
    pub cwd: String,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub exit_status: Nullable<i64>,
    pub stdout: String,
    pub stderr: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub error: Option<String>,
    pub ran_by: String,
    pub ran_by_user_id: String,
    pub started_at: String,
    pub finished_at: String,
}

impl Validate for TerminalResultPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        literal(
            "terminalResult.eventType",
            &self.event_type,
            "terminal.result",
        )?;
        bounded(
            "terminalResult.requestId",
            &self.request_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        bounded(
            "terminalResult.command",
            &self.command,
            1,
            MAX_MEDIUM_TEXT_CHARS,
        )?;
        bounded("terminalResult.cwd", &self.cwd, 1, MAX_PROJECT_PATH_CHARS)?;
        if let Some(value) = self.exit_status.as_ref() {
            safe_i64("terminalResult.exitStatus", *value)?;
        }
        bounded(
            "terminalResult.stdout",
            &self.stdout,
            0,
            MAX_LONG_TEXT_CHARS,
        )?;
        bounded(
            "terminalResult.stderr",
            &self.stderr,
            0,
            MAX_LONG_TEXT_CHARS,
        )?;
        if let Some(value) = &self.error {
            bounded("terminalResult.error", value, 0, MAX_MEDIUM_TEXT_CHARS)?;
        }
        bounded(
            "terminalResult.ranBy",
            &self.ran_by,
            1,
            MAX_DISPLAY_NAME_CHARS,
        )?;
        bounded(
            "terminalResult.ranByUserId",
            &self.ran_by_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        datetime("terminalResult.startedAt", &self.started_at)?;
        datetime("terminalResult.finishedAt", &self.finished_at)
    }
}

string_enum!(GitWorkflowStatus {
    Started => "started",
    Completed => "completed",
    Failed => "failed",
    PrOpened => "pr_opened",
});

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct GitWorkflowResult {
    pub command: String,
    pub cwd: String,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub status: Nullable<i64>,
    pub stdout: String,
    pub stderr: String,
}

impl Validate for GitWorkflowResult {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded(
            "git.result.command",
            &self.command,
            1,
            MAX_MEDIUM_TEXT_CHARS,
        )?;
        bounded("git.result.cwd", &self.cwd, 1, MAX_PROJECT_PATH_CHARS)?;
        if let Some(value) = self.status.as_ref() {
            safe_i64("git.result.status", *value)?;
        }
        bounded("git.result.stdout", &self.stdout, 0, MAX_LONG_TEXT_CHARS)?;
        bounded("git.result.stderr", &self.stderr, 0, MAX_LONG_TEXT_CHARS)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PullRequestRecord {
    pub number: i64,
    pub url: String,
}

impl Validate for PullRequestRecord {
    fn validate(&self) -> Result<(), ProtocolError> {
        safe_i64("git.pullRequest.number", self.number)?;
        bounded("git.pullRequest.url", &self.url, 1, MAX_URL_CHARS)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkflowEventPlaintextPayload {
    pub event_type: String,
    pub status: GitWorkflowStatus,
    pub branch: String,
    pub push: bool,
    pub message: String,
    pub runner: String,
    pub runner_user_id: String,
    pub created_at: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub results: Option<Vec<GitWorkflowResult>>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub pull_request: Option<PullRequestRecord>,
}

impl Validate for GitWorkflowEventPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        literal("git.eventType", &self.event_type, "git.workflow")?;
        bounded("git.branch", &self.branch, 1, MAX_SHORT_TEXT_CHARS)?;
        bounded("git.message", &self.message, 0, MAX_MEDIUM_TEXT_CHARS)?;
        bounded("git.runner", &self.runner, 1, MAX_DISPLAY_NAME_CHARS)?;
        bounded(
            "git.runnerUserId",
            &self.runner_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        datetime("git.createdAt", &self.created_at)?;
        if let Some(values) = &self.results {
            if values.len() > 20 {
                return Err(ProtocolError::invalid("git.results exceeds 20 items"));
            }
            for value in values {
                value.validate()?;
            }
        }
        if let Some(value) = &self.pull_request {
            value.validate()?;
        }
        Ok(())
    }
}

string_enum!(SummaryTone {
    Green => "green",
    Yellow => "yellow",
    Red => "red",
    Dark => "dark",
    Muted => "muted",
});

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct GitHubActionsSummary {
    pub label: String,
    pub detail: String,
    pub tone: SummaryTone,
}

impl Validate for GitHubActionsSummary {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded(
            "actions.summary.label",
            &self.label,
            0,
            MAX_SHORT_TEXT_CHARS,
        )?;
        bounded(
            "actions.summary.detail",
            &self.detail,
            0,
            MAX_MEDIUM_TEXT_CHARS,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubActionRun {
    pub id: i64,
    pub name: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub display_title: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub run_number: Option<i64>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub workflow_id: Option<i64>,
    pub status: String,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub conclusion: Nullable<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub branch: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub head_sha: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub event: Option<String>,
    pub url: String,
    pub created_at: String,
    pub updated_at: String,
}

impl Validate for GitHubActionRun {
    fn validate(&self) -> Result<(), ProtocolError> {
        safe_i64("actions.run.id", self.id)?;
        bounded("actions.run.name", &self.name, 0, MAX_SHORT_TEXT_CHARS)?;
        for (field, value) in [
            ("displayTitle", self.display_title.as_deref()),
            ("branch", self.branch.as_deref()),
            ("headSha", self.head_sha.as_deref()),
            ("event", self.event.as_deref()),
        ] {
            if let Some(value) = value {
                bounded(
                    &format!("actions.run.{field}"),
                    value,
                    0,
                    MAX_SHORT_TEXT_CHARS,
                )?;
            }
        }
        if let Some(value) = self.run_number {
            safe_i64("actions.run.runNumber", value)?;
        }
        if let Some(value) = self.workflow_id {
            safe_i64("actions.run.workflowId", value)?;
        }
        bounded("actions.run.status", &self.status, 0, MAX_SHORT_TEXT_CHARS)?;
        if let Some(value) = self.conclusion.as_ref() {
            bounded("actions.run.conclusion", value, 0, MAX_SHORT_TEXT_CHARS)?;
        }
        bounded("actions.run.url", &self.url, 1, MAX_URL_CHARS)?;
        datetime("actions.run.createdAt", &self.created_at)?;
        datetime("actions.run.updatedAt", &self.updated_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubActionsEventPlaintextPayload {
    pub event_type: String,
    pub owner: String,
    pub repo: String,
    pub branch: String,
    pub summary: GitHubActionsSummary,
    pub message: String,
    pub checked_by: String,
    pub checked_by_user_id: String,
    pub checked_at: String,
    pub runs: Vec<GitHubActionRun>,
}

impl Validate for GitHubActionsEventPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        literal("actions.eventType", &self.event_type, "github.actions")?;
        bounded("actions.owner", &self.owner, 1, MAX_SHORT_TEXT_CHARS)?;
        bounded("actions.repo", &self.repo, 1, MAX_SHORT_TEXT_CHARS)?;
        bounded("actions.branch", &self.branch, 1, MAX_SHORT_TEXT_CHARS)?;
        self.summary.validate()?;
        bounded("actions.message", &self.message, 0, MAX_MEDIUM_TEXT_CHARS)?;
        bounded(
            "actions.checkedBy",
            &self.checked_by,
            1,
            MAX_DISPLAY_NAME_CHARS,
        )?;
        bounded(
            "actions.checkedByUserId",
            &self.checked_by_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        datetime("actions.checkedAt", &self.checked_at)?;
        if self.runs.len() > 20 {
            return Err(ProtocolError::invalid("actions.runs exceeds 20 items"));
        }
        for value in &self.runs {
            value.validate()?;
        }
        Ok(())
    }
}

string_enum!(HostHandoffReason { Manual => "manual", UsageLimit => "usage_limit" });
string_enum!(HostHandoffStatus {
    Available => "available",
    Requested => "requested",
    Accepted => "accepted",
});

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedCodexTurn {
    pub turn_id: String,
    pub requested_by: String,
    pub requested_by_user_id: String,
    pub queued_at: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub trigger_message_id: Option<String>,
}

impl Validate for QueuedCodexTurn {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded("handoff.turnId", &self.turn_id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded(
            "handoff.requestedBy",
            &self.requested_by,
            1,
            MAX_DISPLAY_NAME_CHARS,
        )?;
        bounded(
            "handoff.requestedByUserId",
            &self.requested_by_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        datetime("handoff.queuedAt", &self.queued_at)?;
        if let Some(value) = &self.trigger_message_id {
            bounded("handoff.triggerMessageId", value, 1, MAX_ENVELOPE_ID_CHARS)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostHandoffPlaintextPayload {
    pub id: String,
    pub from_host: String,
    pub from_user_id: String,
    pub reason: HostHandoffReason,
    pub project_path: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub git_remote_url: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub git_repo_owner: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub git_repo_name: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub git_branch: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub git_dirty_files: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub git_patch: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub git_patch_truncated: Option<bool>,
    pub codex_model: String,
    pub codex_model_policy: CatalogSelectionPolicy,
    pub codex_reasoning_effort: CodexReasoningEffort,
    pub codex_reasoning_effort_policy: CatalogSelectionPolicy,
    pub codex_raw_reasoning_enabled: bool,
    pub codex_speed: CodexSpeed,
    pub codex_service_tier_policy: CatalogSelectionPolicy,
    pub codex_sandbox_level: CodexSandboxLevel,
    pub approval_policy: String,
    pub messages_since_last_codex: u64,
    pub queued_codex_turns: Vec<QueuedCodexTurn>,
    pub attachment_names: Vec<String>,
    pub terminals: Vec<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub continuation_summary: Option<String>,
    pub created_at: String,
    pub status: HostHandoffStatus,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub candidate_user_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub candidate_device_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub candidate_leaf: Option<u64>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub accepted_by: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub accepted_by_user_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub accepted_at: Option<String>,
}

impl Validate for HostHandoffPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        bounded("handoff.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded(
            "handoff.fromHost",
            &self.from_host,
            1,
            MAX_DISPLAY_NAME_CHARS,
        )?;
        bounded(
            "handoff.fromUserId",
            &self.from_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        bounded(
            "handoff.projectPath",
            &self.project_path,
            1,
            MAX_PROJECT_PATH_CHARS,
        )?;
        if let Some(value) = &self.git_remote_url {
            bounded("handoff.gitRemoteUrl", value, 1, MAX_URL_CHARS)?;
        }
        for (field, value) in [
            ("gitRepoOwner", self.git_repo_owner.as_deref()),
            ("gitRepoName", self.git_repo_name.as_deref()),
            ("gitBranch", self.git_branch.as_deref()),
        ] {
            if let Some(value) = value {
                bounded(&format!("handoff.{field}"), value, 1, MAX_SHORT_TEXT_CHARS)?;
            }
        }
        if let Some(values) = &self.git_dirty_files {
            validate_bounded_strings(values, 50, 1, MAX_SHORT_TEXT_CHARS, "handoff.gitDirtyFiles")?;
        }
        if let Some(value) = &self.git_patch {
            bounded("handoff.gitPatch", value, 0, MAX_LONG_TEXT_CHARS)?;
        }
        bounded(
            "handoff.codexModel",
            &self.codex_model,
            1,
            MAX_CODEX_MODEL_CHARS,
        )?;
        bounded(
            "handoff.approvalPolicy",
            &self.approval_policy,
            1,
            MAX_SHORT_TEXT_CHARS,
        )?;
        safe_u64(
            "handoff.messagesSinceLastCodex",
            self.messages_since_last_codex,
        )?;
        if self.queued_codex_turns.len() > 5 {
            return Err(ProtocolError::invalid(
                "handoff.queuedCodexTurns exceeds 5 items",
            ));
        }
        for value in &self.queued_codex_turns {
            value.validate()?;
        }
        validate_bounded_strings(
            &self.attachment_names,
            MAX_MESSAGE_ATTACHMENTS,
            1,
            MAX_SHORT_TEXT_CHARS,
            "handoff.attachmentNames",
        )?;
        validate_bounded_strings(
            &self.terminals,
            20,
            1,
            MAX_SHORT_TEXT_CHARS,
            "handoff.terminals",
        )?;
        if let Some(value) = &self.continuation_summary {
            bounded(
                "handoff.continuationSummary",
                value,
                0,
                MAX_MEDIUM_TEXT_CHARS,
            )?;
        }
        datetime("handoff.createdAt", &self.created_at)?;
        if let Some(value) = &self.candidate_user_id {
            user_id("handoff.candidateUserId", value)?;
        }
        if let Some(value) = &self.candidate_device_id {
            device_id("handoff.candidateDeviceId", value)?;
        }
        if let Some(value) = self.candidate_leaf {
            safe_u64("handoff.candidateLeaf", value)?;
        }
        if let Some(value) = &self.accepted_by {
            bounded("handoff.acceptedBy", value, 1, MAX_DISPLAY_NAME_CHARS)?;
        }
        if let Some(value) = &self.accepted_by_user_id {
            bounded("handoff.acceptedByUserId", value, 1, MAX_USER_ID_CHARS)?;
        }
        if let Some(value) = &self.accepted_at {
            datetime("handoff.acceptedAt", value)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostHandoffRequestPlaintextPayload {
    pub phase: String,
    pub offer_id: String,
    pub candidate_user_id: String,
    pub candidate_device_id: String,
    pub candidate_leaf: u64,
}

impl Validate for HostHandoffRequestPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        literal("handoffRequest.phase", &self.phase, "candidate_request")?;
        bounded(
            "handoffRequest.offerId",
            &self.offer_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        user_id("handoffRequest.candidateUserId", &self.candidate_user_id)?;
        device_id(
            "handoffRequest.candidateDeviceId",
            &self.candidate_device_id,
        )?;
        safe_u64("handoffRequest.candidateLeaf", self.candidate_leaf)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostHandoffAcceptedPlaintextPayload {
    pub phase: String,
    pub offer_id: String,
    pub host_user_id: String,
    pub host_device_id: String,
    pub host_leaf: u64,
    pub committed_epoch: u64,
}

impl Validate for HostHandoffAcceptedPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        literal("handoffAccepted.phase", &self.phase, "accepted")?;
        bounded(
            "handoffAccepted.offerId",
            &self.offer_id,
            1,
            MAX_ENVELOPE_ID_CHARS,
        )?;
        user_id("handoffAccepted.hostUserId", &self.host_user_id)?;
        device_id("handoffAccepted.hostDeviceId", &self.host_device_id)?;
        safe_u64("handoffAccepted.hostLeaf", self.host_leaf)?;
        safe_u64("handoffAccepted.committedEpoch", self.committed_epoch)
    }
}

string_enum!(RoomSetting {
    RoomName => "roomName",
    ApprovalPolicy => "approvalPolicy",
    CodexModel => "codexModel",
    CodexReasoningEffort => "codexReasoningEffort",
    CodexRawReasoningEnabled => "codexRawReasoningEnabled",
    CodexSpeed => "codexSpeed",
    CodexSandboxLevel => "codexSandboxLevel",
    ProjectPath => "projectPath",
});

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomSettingsPlaintextPayload {
    pub event_type: String,
    pub id: String,
    pub setting: RoomSetting,
    pub previous_value: String,
    pub next_value: String,
    pub changed_by: String,
    pub changed_by_user_id: String,
    pub changed_at: String,
}

impl Validate for RoomSettingsPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        literal("roomSettings.eventType", &self.event_type, "room.settings")?;
        bounded("roomSettings.id", &self.id, 1, MAX_ENVELOPE_ID_CHARS)?;
        bounded(
            "roomSettings.previousValue",
            &self.previous_value,
            0,
            MAX_MEDIUM_TEXT_CHARS,
        )?;
        bounded(
            "roomSettings.nextValue",
            &self.next_value,
            0,
            MAX_MEDIUM_TEXT_CHARS,
        )?;
        bounded(
            "roomSettings.changedBy",
            &self.changed_by,
            1,
            MAX_DISPLAY_NAME_CHARS,
        )?;
        bounded(
            "roomSettings.changedByUserId",
            &self.changed_by_user_id,
            1,
            MAX_USER_ID_CHARS,
        )?;
        datetime("roomSettings.changedAt", &self.changed_at)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomConfigPlaintextPayload {
    pub event_type: String,
    pub config_revision: u64,
    pub emitting_epoch: u64,
    pub project_path: String,
    pub codex_model: String,
    pub codex_model_policy: CatalogSelectionPolicy,
    pub codex_reasoning_effort: CodexReasoningEffort,
    pub codex_reasoning_effort_policy: CatalogSelectionPolicy,
    pub codex_raw_reasoning_enabled: bool,
    pub codex_speed: CodexSpeed,
    pub codex_service_tier_policy: CatalogSelectionPolicy,
    pub codex_sandbox_level: CodexSandboxLevel,
}

impl Validate for RoomConfigPlaintextPayload {
    fn validate(&self) -> Result<(), ProtocolError> {
        literal("roomConfigEvent.eventType", &self.event_type, "room.config")?;
        if self.config_revision == 0 {
            return Err(ProtocolError::invalid(
                "roomConfigEvent.configRevision must be positive",
            ));
        }
        safe_u64("roomConfigEvent.configRevision", self.config_revision)?;
        safe_u64("roomConfigEvent.emittingEpoch", self.emitting_epoch)?;
        bounded(
            "roomConfigEvent.projectPath",
            &self.project_path,
            1,
            MAX_PROJECT_PATH_CHARS,
        )?;
        bounded(
            "roomConfigEvent.codexModel",
            &self.codex_model,
            1,
            MAX_CODEX_MODEL_CHARS,
        )
    }
}

/// A validated room event selected by MLS authenticated-data `kind`.
///
/// The desktop router ignores unknown kinds. The CLI retains only a bounded kind
/// marker so later rendering can show the plan-required unsupported-content
/// placeholder without retaining or interpreting an unknown plaintext payload.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RoomEvent {
    ChatMessage(ChatPlaintextPayload),
    ChatReaction(ChatReactionPlaintextPayload),
    ChatEdit(ChatEditPlaintextPayload),
    ChatDelete(ChatDeletePlaintextPayload),
    TerminalRequest(TerminalRequestPlaintextPayload),
    TerminalResult(TerminalResultPlaintextPayload),
    TerminalRequestStatus(RequestStatusPlaintextPayload),
    GitWorkflow(GitWorkflowEventPlaintextPayload),
    GitHubActions(GitHubActionsEventPlaintextPayload),
    CodexEvent(CodexEventPlaintextPayload),
    CodexActivity(CodexActivityPlaintextPayload),
    CodexQueue(CodexQueuePlaintextPayload),
    BrowserRequest(BrowserRequestPlaintextPayload),
    BrowserRequestStatus(RequestStatusPlaintextPayload),
    WorkspaceRequest(WorkspaceFileSaveRequestPlaintextPayload),
    WorkspaceRequestStatus(RequestStatusPlaintextPayload),
    LocalPreview(LocalPreviewPlaintextPayload),
    RoomConfig(RoomConfigPlaintextPayload),
    HostHandoffRequest(HostHandoffRequestPlaintextPayload),
    HostHandoffAccepted(HostHandoffAcceptedPlaintextPayload),
    HostHandoff(HostHandoffPlaintextPayload),
    RoomSettings(RoomSettingsPlaintextPayload),
    Unsupported { kind: String },
}

impl RoomEvent {
    pub fn parse(kind: &str, plaintext: Value) -> Result<Self, ProtocolError> {
        match kind {
            "chat.message" => parse_validated(plaintext).map(Self::ChatMessage),
            "chat.reaction" => parse_validated(plaintext).map(Self::ChatReaction),
            "chat.edit" => parse_validated(plaintext).map(Self::ChatEdit),
            "chat.delete" => parse_validated(plaintext).map(Self::ChatDelete),
            "terminal.request" => parse_validated(plaintext).map(Self::TerminalRequest),
            "terminal.event" => {
                match parse_validated::<TerminalResultPlaintextPayload>(plaintext.clone()) {
                    Ok(value) => Ok(Self::TerminalResult(value)),
                    Err(_) => parse_validated(plaintext).map(Self::TerminalRequestStatus),
                }
            }
            "git.event" => {
                match parse_validated::<GitWorkflowEventPlaintextPayload>(plaintext.clone()) {
                    Ok(value) => Ok(Self::GitWorkflow(value)),
                    Err(_) => parse_validated(plaintext).map(Self::GitHubActions),
                }
            }
            "codex.event" => parse_validated(plaintext).map(Self::CodexEvent),
            "codex.activity" => parse_validated(plaintext).map(Self::CodexActivity),
            "codex.queue" => parse_validated(plaintext).map(Self::CodexQueue),
            "browser.request" => parse_validated(plaintext).map(Self::BrowserRequest),
            "browser.event" => parse_validated(plaintext).map(Self::BrowserRequestStatus),
            "workspace.request" => parse_validated(plaintext).map(Self::WorkspaceRequest),
            "workspace.event" => parse_validated(plaintext).map(Self::WorkspaceRequestStatus),
            "preview.event" => parse_validated(plaintext).map(Self::LocalPreview),
            "room.config" => parse_validated(plaintext).map(Self::RoomConfig),
            "room.host.request" => parse_validated(plaintext).map(Self::HostHandoffRequest),
            "room.host.accepted" => parse_validated(plaintext).map(Self::HostHandoffAccepted),
            "room.host" => parse_validated(plaintext).map(Self::HostHandoff),
            "room.settings" => parse_validated(plaintext).map(Self::RoomSettings),
            unsupported => {
                bounded("roomEvent.kind", unsupported, 1, 128)?;
                Ok(Self::Unsupported {
                    kind: unsupported.to_owned(),
                })
            }
        }
    }
}
