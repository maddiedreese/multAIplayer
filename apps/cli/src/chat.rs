use crate::{
    mls::{MlsClientError, MlsClientService, OutboxRoute, RelayMlsPublisher},
    relay::{
        connect_with_retries, ReconnectPolicy, RelayConnection, RelayConnector, RelaySocket,
        RelayTransportError, RetrySleeper,
    },
};
use base64::{engine::general_purpose::STANDARD, Engine};
use mls_core::ApplicationAuthenticatedDataInput;
use multaiplayer_protocol::{
    ChatPlaintextPayload, ChatRole, CodexActivityPlaintextPayload, CodexEventPlaintextPayload,
    CodexQueueAction, CodexQueuePlaintextPayload, MlsMessageType, MlsRelayMessage, PresenceStatus,
    RelayClientMessage, RelayServerMessage, RoomEvent, RoomRecord, Validate,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fmt, time::Duration};
use thiserror::Error;
use zeroize::Zeroizing;

const CHAT_KIND: &str = "chat.message";
const CODEX_QUEUE_KIND: &str = "codex.queue";
const CODEX_TURN_KIND: &str = "codex.turn";
const CODEX_ACTIVITY_KIND: &str = "codex.activity";
const MAX_RENDERED_TEXT_CHARS: usize = 4_096;
const RECOVERY_VERSION: u8 = 1;
const MAX_HISTORY_EVENTS: usize = 100;
// The relay accepts at most 1,000 backlog records by configuration. Retaining
// 1,024 validated IDs ensures one complete maximum backlog plus a small overlap
// remains idempotent across delayed reconnects.
const MAX_PROCESSED_ENVELOPES: usize = 1_024;
const MAX_RECOVERY_BYTES: usize = 768 * 1_024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenderMode {
    Color,
    Plain,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ProjectedEvent {
    Chat(ChatPlaintextPayload),
    CodexProposal(CodexQueuePlaintextPayload),
    CodexTurn(CodexEventPlaintextPayload),
    CodexActivity(CodexActivityPlaintextPayload),
    Presence {
        display_name: String,
        device_id: String,
        status: PresenceStatus,
        active_host: bool,
    },
    Unsupported {
        kind: String,
    },
}

#[derive(Debug, Error)]
pub enum ChatError {
    #[error("The chat message is invalid or too large.")]
    InvalidMessage,
    #[error("The encrypted room message is invalid or not bound to this room and sender.")]
    InvalidEncryptedMessage,
    #[error("The relay room connection failed.")]
    Relay(#[from] RelayTransportError),
    #[error("The MLS room state is unavailable.")]
    Mls(#[from] MlsClientError),
    #[error("Room recovery was interrupted and requires an explicit rejoin or recovery.")]
    RecoveryInterrupted,
    #[error("The encrypted local room history is corrupt or incompatible.")]
    InvalidRecoveryState,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RoomRecoveryState {
    version: u8,
    team_id: String,
    room_id: String,
    user_id: String,
    device_id: String,
    processed_envelope_ids: Vec<String>,
    history: Vec<ProjectedEvent>,
    pending_envelope_id: Option<String>,
    #[serde(default)]
    codex_thread_id: Option<String>,
}

impl RoomRecoveryState {
    fn empty(room: &RoomRecord, user_id: &str, device_id: &str) -> Self {
        Self {
            version: RECOVERY_VERSION,
            team_id: room.team_id.clone(),
            room_id: room.id.clone(),
            user_id: user_id.to_owned(),
            device_id: device_id.to_owned(),
            processed_envelope_ids: Vec::new(),
            history: Vec::new(),
            pending_envelope_id: None,
            codex_thread_id: None,
        }
    }

    fn validate(&self, room: &RoomRecord, user_id: &str, device_id: &str) -> Result<(), ChatError> {
        if self.version != RECOVERY_VERSION
            || self.team_id != room.team_id
            || self.room_id != room.id
            || self.user_id != user_id
            || self.device_id != device_id
            || self.processed_envelope_ids.len() > MAX_PROCESSED_ENVELOPES
            || self.history.len() > MAX_HISTORY_EVENTS
            || self
                .processed_envelope_ids
                .iter()
                .any(|id| !valid_envelope_id(id))
            || self
                .pending_envelope_id
                .as_deref()
                .is_some_and(|id| !valid_envelope_id(id))
            || self.codex_thread_id.as_deref().is_some_and(|id| {
                id.is_empty() || id.chars().count() > 512 || id.chars().any(char::is_control)
            })
        {
            return Err(ChatError::InvalidRecoveryState);
        }
        let mut unique = self.processed_envelope_ids.clone();
        unique.sort();
        unique.dedup();
        if unique.len() != self.processed_envelope_ids.len()
            || !self.history.iter().all(valid_history_event)
        {
            return Err(ChatError::InvalidRecoveryState);
        }
        Ok(())
    }

    fn processed(&self, id: &str) -> bool {
        self.processed_envelope_ids.iter().any(|seen| seen == id)
    }

    fn remember_processed(&mut self, id: &str) {
        if self.processed(id) {
            return;
        }
        self.processed_envelope_ids.push(id.to_owned());
        if self.processed_envelope_ids.len() > MAX_PROCESSED_ENVELOPES {
            self.processed_envelope_ids.remove(0);
        }
    }

    fn remember_history(&mut self, event: &ProjectedEvent) {
        if !matches!(
            event,
            ProjectedEvent::Chat(_)
                | ProjectedEvent::CodexProposal(_)
                | ProjectedEvent::CodexTurn(_)
                | ProjectedEvent::CodexActivity(_)
                | ProjectedEvent::Unsupported { .. }
        ) {
            return;
        }
        self.history.push(event.clone());
        if self.history.len() > MAX_HISTORY_EVENTS {
            self.history.remove(0);
        }
    }
}

pub struct TerminalRenderer {
    mode: RenderMode,
}

impl TerminalRenderer {
    pub fn new(mode: RenderMode) -> Self {
        Self { mode }
    }

    pub fn render(&self, event: &ProjectedEvent) -> String {
        match event {
            ProjectedEvent::Chat(chat) => {
                let author = safe_untrusted_text(&chat.author, 120);
                let body = safe_untrusted_text(&chat.body, MAX_RENDERED_TEXT_CHARS);
                let label = match chat.role {
                    ChatRole::Human => "chat",
                    ChatRole::Codex => "assistant",
                    ChatRole::System => "system",
                };
                match self.mode {
                    RenderMode::Color => {
                        format!("\u{1b}[36m[{label}]\u{1b}[0m <{author}> {body}")
                    }
                    RenderMode::Plain => format!("[{label}] <{author}> {body}"),
                }
            }
            ProjectedEvent::CodexProposal(proposal) => {
                let proposer = safe_untrusted_text(&proposal.requested_by, 120);
                let task = safe_untrusted_text(proposal.reason.as_deref().unwrap_or(""), 4_096);
                let id = safe_untrusted_text(&proposal.turn_id, 160);
                match self.mode {
                    RenderMode::Color => {
                        format!("\u{1b}[34m[proposal]\u{1b}[0m <{proposer}> {task} (id: {id})")
                    }
                    RenderMode::Plain => format!("[proposal] <{proposer}> {task} (id: {id})"),
                }
            }
            ProjectedEvent::CodexTurn(turn) => {
                let id = safe_untrusted_text(&turn.turn_id, 160);
                let message = safe_untrusted_text(&turn.message, MAX_RENDERED_TEXT_CHARS);
                let status = match turn.status {
                    multaiplayer_protocol::CodexTurnStatus::Started => "started",
                    multaiplayer_protocol::CodexTurnStatus::Event => "event",
                    multaiplayer_protocol::CodexTurnStatus::Completed => "completed",
                    multaiplayer_protocol::CodexTurnStatus::Failed => "failed",
                };
                match self.mode {
                    RenderMode::Color => {
                        format!("\u{1b}[32m[codex]\u{1b}[0m {id} {status}: {message}")
                    }
                    RenderMode::Plain => format!("[codex] {id} {status}: {message}"),
                }
            }
            ProjectedEvent::CodexActivity(activity) => {
                let title = safe_untrusted_text(&activity.title, 240);
                let item_id = safe_untrusted_text(&activity.item_id, 160);
                let kind = serde_json::to_value(&activity.kind)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_else(|| "other".to_owned());
                let status = serde_json::to_value(&activity.status)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_else(|| "failed".to_owned());
                let kind = safe_untrusted_text(&kind, 64);
                let status = safe_untrusted_text(&status, 64);
                match self.mode {
                    RenderMode::Color => format!(
                        "\u{1b}[35m[activity]\u{1b}[0m {kind}/{status} {title} (item: {item_id})"
                    ),
                    RenderMode::Plain => {
                        format!("[activity] {kind}/{status} {title} (item: {item_id})")
                    }
                }
            }
            ProjectedEvent::Presence {
                display_name,
                device_id,
                status,
                active_host,
            } => {
                let name = safe_untrusted_text(display_name, 120);
                let device = safe_untrusted_text(device_id, 128);
                let label = if *active_host { "host" } else { "presence" };
                let status = match status {
                    PresenceStatus::Online => "online",
                    PresenceStatus::Offline => "offline",
                };
                match self.mode {
                    RenderMode::Color => {
                        format!("\u{1b}[35m[{label}]\u{1b}[0m {name} ({device}) is {status}")
                    }
                    RenderMode::Plain => format!("[{label}] {name} ({device}) is {status}"),
                }
            }
            ProjectedEvent::Unsupported { kind } => {
                let kind = safe_untrusted_text(kind, 128);
                match self.mode {
                    RenderMode::Color => {
                        format!("\u{1b}[33m[unsupported]\u{1b}[0m event: {kind}")
                    }
                    RenderMode::Plain => format!("[unsupported] event: {kind}"),
                }
            }
        }
    }

    /// Trusted prompts use a fixed delimiter that is never accepted from room
    /// content. Untrusted details are sanitized before insertion.
    pub fn trusted_prompt(&self, prompt: &str) -> String {
        let prompt = safe_untrusted_text(prompt, 4_096);
        match self.mode {
            RenderMode::Color => format!(
                "\u{1b}[1;32m=== multAIplayer trusted prompt ===\u{1b}[0m\n{prompt}\n\u{1b}[1;32m=== end trusted prompt ===\u{1b}[0m"
            ),
            RenderMode::Plain => format!(
                "=== multAIplayer trusted prompt ===\n{prompt}\n=== end trusted prompt ==="
            ),
        }
    }
}

/// Produces one bounded terminal line. C0/C1 controls, line separators,
/// directional overrides/isolates, zero-width controls, and replacement-prone
/// noncharacters are visibly neutralized. ANSI bytes can therefore occur only
/// in renderer-owned color prefixes.
pub fn safe_untrusted_text(value: &str, max_chars: usize) -> String {
    let mut rendered = String::new();
    for character in value.chars().take(max_chars) {
        if unsafe_terminal_character(character) {
            rendered.push('�');
        } else {
            rendered.push(character);
        }
    }
    if value.chars().count() > max_chars {
        rendered.push('…');
    }
    rendered
}

fn unsafe_terminal_character(character: char) -> bool {
    character.is_control()
        || matches!(
            character,
            '\u{061c}'
                | '\u{200b}'..='\u{200f}'
                | '\u{2028}'..='\u{202e}'
                | '\u{2060}'..='\u{206f}'
                | '\u{feff}'
                | '\u{fff9}'..='\u{fffb}'
        )
        || (character as u32) & 0xffff == 0xffff
        || (character as u32) & 0xffff == 0xfffe
}

pub struct ChatRoomSession<'a, S> {
    connection: RelayConnection<S>,
    mls: &'a mut MlsClientService,
    room: RoomRecord,
    user_id: String,
    device_id: String,
    display_name: String,
    public_key_fingerprint: String,
    presence: BTreeMap<(String, String), PresenceStatus>,
    recovery: RoomRecoveryState,
}

impl<'a, S: RelaySocket> ChatRoomSession<'a, S> {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        connection: RelayConnection<S>,
        mls: &'a mut MlsClientService,
        room: RoomRecord,
        user_id: &str,
        device_id: &str,
        display_name: &str,
        public_key_fingerprint: &str,
    ) -> Result<Self, ChatError> {
        room.validate().map_err(|_| ChatError::InvalidMessage)?;
        let recovery = match mls.load_room_client_state(&room.id)? {
            Some(encoded) => {
                if encoded.len() > MAX_RECOVERY_BYTES {
                    return Err(ChatError::InvalidRecoveryState);
                }
                let recovery: RoomRecoveryState = serde_json::from_slice(&encoded)
                    .map_err(|_| ChatError::InvalidRecoveryState)?;
                recovery.validate(&room, user_id, device_id)?;
                recovery
            }
            None => RoomRecoveryState::empty(&room, user_id, device_id),
        };
        if recovery.pending_envelope_id.is_some() {
            return Err(ChatError::RecoveryInterrupted);
        }
        Ok(Self {
            connection,
            mls,
            room,
            user_id: user_id.to_owned(),
            device_id: device_id.to_owned(),
            display_name: display_name.to_owned(),
            public_key_fingerprint: public_key_fingerprint.to_owned(),
            presence: BTreeMap::new(),
            recovery,
        })
    }

    pub fn persisted_history(&self) -> Vec<ProjectedEvent> {
        self.recovery.history.clone()
    }

    pub fn is_active_host(&self) -> bool {
        self.room.host_user_id.as_deref() == Some(self.user_id.as_str())
            && self.room.active_host_device_id.as_deref() == Some(self.device_id.as_str())
            && self.room.host_status == multaiplayer_protocol::HostStatus::Active
    }

    pub fn codex_thread_id(&self) -> Option<String> {
        self.recovery.codex_thread_id.clone()
    }

    pub fn save_codex_thread_id(&mut self, thread_id: &str) -> Result<(), ChatError> {
        if thread_id.is_empty()
            || thread_id.chars().count() > 512
            || thread_id.chars().any(char::is_control)
        {
            return Err(ChatError::InvalidRecoveryState);
        }
        self.recovery.codex_thread_id = Some(thread_id.to_owned());
        self.persist_recovery()
    }

    pub fn leave(&mut self) {
        self.connection.close();
    }

    pub fn delete_local_history(&mut self) -> Result<(), ChatError> {
        self.mls.delete_room_client_state(&self.room.id)?;
        self.recovery = RoomRecoveryState::empty(&self.room, &self.user_id, &self.device_id);
        Ok(())
    }

    fn replace_connection(&mut self, socket: S) {
        self.connection = RelayConnection::new(socket);
        self.presence.clear();
    }

    pub fn join(&mut self, device_session_token: &str) -> Result<Vec<ProjectedEvent>, ChatError> {
        let message = RelayClientMessage::Join {
            team_id: self.room.team_id.clone(),
            room_id: self.room.id.clone(),
            user_id: self.user_id.clone(),
            device_id: self.device_id.clone(),
            invite_id: None,
            device_session_token: Some(device_session_token.to_owned()),
        };
        let mut received = Vec::new();
        self.connection.join_and_wait_for_ack(
            &message,
            Duration::from_secs(10),
            &mut |message| {
                received.push(message.clone());
                Ok(())
            },
        )?;
        self.connection.send(&RelayClientMessage::Presence {
            team_id: self.room.team_id.clone(),
            room_id: self.room.id.clone(),
            user_id: self.user_id.clone(),
            device_id: self.device_id.clone(),
            display_name: self.display_name.clone(),
            avatar_url: None,
            public_key_fingerprint: Some(self.public_key_fingerprint.clone()),
        })?;
        self.project_received(received)
    }

    pub fn send_chat(
        &mut self,
        message_id: &str,
        body: &str,
        created_at: &str,
        display_time: &str,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        let local = self.queue_chat(message_id, body, created_at, display_time)?;
        let mut projected = vec![local];
        projected.extend(self.publish_queued_application(message_id, created_at)?);
        Ok(projected)
    }

    pub fn send_codex_proposal(
        &mut self,
        envelope_id: &str,
        proposal_id: &str,
        task: &str,
        created_at: &str,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        let proposal = CodexQueuePlaintextPayload {
            event_type: CODEX_QUEUE_KIND.to_owned(),
            queue_event_id: envelope_id.to_owned(),
            turn_id: proposal_id.to_owned(),
            action: CodexQueueAction::Queued,
            requested_by: self.display_name.clone(),
            requested_by_user_id: self.user_id.clone(),
            trigger_message_id: None,
            reason: Some(task.to_owned()),
            queue_position: Some(1),
            queue_size: 1,
            created_at: created_at.to_owned(),
        };
        let event = ProjectedEvent::CodexProposal(proposal.clone());
        self.queue_projected_event(envelope_id, CODEX_QUEUE_KIND, &proposal, &event, created_at)?;
        let mut projected = vec![event];
        projected.extend(self.publish_queued_application(envelope_id, created_at)?);
        Ok(projected)
    }

    pub fn send_codex_turn(
        &mut self,
        envelope_id: &str,
        turn: CodexEventPlaintextPayload,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        if !self.is_active_host() || turn.turn_id.is_empty() {
            return Err(ChatError::InvalidMessage);
        }
        let created_at = turn.created_at.clone();
        let event = ProjectedEvent::CodexTurn(turn.clone());
        self.queue_projected_event(envelope_id, CODEX_TURN_KIND, &turn, &event, &created_at)?;
        let mut projected = vec![event];
        projected.extend(self.publish_queued_application(envelope_id, &created_at)?);
        Ok(projected)
    }

    pub fn send_codex_activity(
        &mut self,
        envelope_id: &str,
        activity: CodexActivityPlaintextPayload,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        if !self.is_active_host() || activity.activity_id.is_empty() {
            return Err(ChatError::InvalidMessage);
        }
        let created_at = activity.updated_at.clone();
        let event = ProjectedEvent::CodexActivity(activity.clone());
        self.queue_projected_event(
            envelope_id,
            CODEX_ACTIVITY_KIND,
            &activity,
            &event,
            &created_at,
        )?;
        let mut projected = vec![event];
        projected.extend(self.publish_queued_application(envelope_id, &created_at)?);
        Ok(projected)
    }

    pub fn send_codex_cancelled(
        &mut self,
        envelope_id: &str,
        proposal: &CodexQueuePlaintextPayload,
        reason: &str,
        created_at: &str,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        if !self.is_active_host() || proposal.action != CodexQueueAction::Queued {
            return Err(ChatError::InvalidMessage);
        }
        let cancelled = CodexQueuePlaintextPayload {
            event_type: CODEX_QUEUE_KIND.to_owned(),
            queue_event_id: envelope_id.to_owned(),
            turn_id: proposal.turn_id.clone(),
            action: CodexQueueAction::Cancelled,
            requested_by: proposal.requested_by.clone(),
            requested_by_user_id: proposal.requested_by_user_id.clone(),
            trigger_message_id: proposal.trigger_message_id.clone(),
            reason: Some(reason.to_owned()),
            queue_position: None,
            queue_size: 0,
            created_at: created_at.to_owned(),
        };
        let event = ProjectedEvent::CodexProposal(cancelled.clone());
        self.queue_projected_event(
            envelope_id,
            CODEX_QUEUE_KIND,
            &cancelled,
            &event,
            created_at,
        )?;
        let mut projected = vec![event];
        projected.extend(self.publish_queued_application(envelope_id, created_at)?);
        Ok(projected)
    }

    pub fn send_assistant_message(
        &mut self,
        message_id: &str,
        body: &str,
        created_at: &str,
        display_time: &str,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        if !self.is_active_host() {
            return Err(ChatError::InvalidMessage);
        }
        let chat = ChatPlaintextPayload {
            id: message_id.to_owned(),
            author: "Codex".to_owned(),
            author_user_id: self.user_id.clone(),
            role: ChatRole::Codex,
            body: body.to_owned(),
            time: display_time.to_owned(),
            created_at: Some(created_at.to_owned()),
            reply_to: None,
            attachments: None,
        };
        let event = ProjectedEvent::Chat(chat.clone());
        self.queue_projected_event(message_id, CHAT_KIND, &chat, &event, created_at)?;
        let mut projected = vec![event];
        projected.extend(self.publish_queued_application(message_id, created_at)?);
        Ok(projected)
    }

    fn queue_projected_event<T: Serialize + Validate>(
        &mut self,
        message_id: &str,
        kind: &str,
        payload: &T,
        event: &ProjectedEvent,
        created_at: &str,
    ) -> Result<(), ChatError> {
        payload.validate().map_err(|_| ChatError::InvalidMessage)?;
        let payload = serde_json::to_vec(payload).map_err(|_| ChatError::InvalidMessage)?;
        self.mls.queue_application(
            &self.room.id,
            message_id,
            &payload,
            ApplicationAuthenticatedDataInput {
                version: 1,
                message_id: message_id.to_owned(),
                team_id: self.room.team_id.clone(),
                room_id: self.room.id.clone(),
                kind: kind.to_owned(),
                sender_user_id: self.user_id.clone(),
                sender_device_id: self.device_id.clone(),
                created_at: created_at.to_owned(),
            },
        )?;
        self.recovery.remember_processed(message_id);
        self.recovery.remember_history(event);
        self.persist_recovery()
    }

    fn queue_chat(
        &mut self,
        message_id: &str,
        body: &str,
        created_at: &str,
        display_time: &str,
    ) -> Result<ProjectedEvent, ChatError> {
        let chat = ChatPlaintextPayload {
            id: message_id.to_owned(),
            author: self.display_name.clone(),
            author_user_id: self.user_id.clone(),
            role: ChatRole::Human,
            body: body.to_owned(),
            time: display_time.to_owned(),
            created_at: Some(created_at.to_owned()),
            reply_to: None,
            attachments: None,
        };
        let local = ProjectedEvent::Chat(chat);
        let ProjectedEvent::Chat(payload) = &local else {
            unreachable!()
        };
        self.queue_projected_event(message_id, CHAT_KIND, payload, &local, created_at)?;
        Ok(local)
    }

    fn publish_queued_application(
        &mut self,
        message_id: &str,
        created_at: &str,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        let route = OutboxRoute {
            team_id: self.room.team_id.clone(),
            room_id: self.room.id.clone(),
            created_at: created_at.to_owned(),
        };
        let mut received = Vec::new();
        {
            let mut handler = |message: &RelayServerMessage| {
                received.push(message.clone());
                Ok(())
            };
            let mut publisher =
                RelayMlsPublisher::new(&mut self.connection, Duration::from_secs(10), &mut handler);
            let report = self
                .mls
                .publish_application(&route, message_id, &mut publisher)?;
            if report.published.as_slice() != [message_id]
                || !report.expired_applications.is_empty()
            {
                return Err(ChatError::InvalidEncryptedMessage);
            }
        }
        self.project_received(received)
    }

    fn recover_application_outbox(
        &mut self,
        created_at: &str,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        let route = OutboxRoute {
            team_id: self.room.team_id.clone(),
            room_id: self.room.id.clone(),
            created_at: created_at.to_owned(),
        };
        let mut received = Vec::new();
        {
            let mut handler = |message: &RelayServerMessage| {
                received.push(message.clone());
                Ok(())
            };
            let mut publisher =
                RelayMlsPublisher::new(&mut self.connection, Duration::from_secs(10), &mut handler);
            self.mls
                .drain_room_application_outbox(&route, &mut publisher)?;
        }
        self.project_received(received)
    }

    pub fn poll(&mut self, timeout: Duration) -> Result<Vec<ProjectedEvent>, ChatError> {
        let mut received = Vec::new();
        match self.connection.receive_one(timeout, &mut |message| {
            received.push(message.clone());
            Ok(())
        }) {
            Ok(()) | Err(RelayTransportError::ReceiveTimeout) => self.project_received(received),
            Err(error) => Err(error.into()),
        }
    }

    fn project_received(
        &mut self,
        received: Vec<RelayServerMessage>,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        let mut projected = Vec::new();
        for message in received {
            match message {
                RelayServerMessage::Presence {
                    team_id,
                    room_id,
                    user_id,
                    device_id,
                    display_name,
                    status,
                    ..
                } if team_id == self.room.team_id && room_id == self.room.id => {
                    self.presence
                        .insert((user_id.clone(), device_id.clone()), status.clone());
                    let active_host = self.room.host_user_id.as_deref() == Some(user_id.as_str())
                        && self.room.active_host_device_id.as_deref() == Some(device_id.as_str());
                    projected.push(ProjectedEvent::Presence {
                        display_name,
                        device_id,
                        status,
                        active_host,
                    });
                }
                RelayServerMessage::MlsMessage { message } => {
                    if let Some(event) = self.open_room_event(&message)? {
                        projected.push(event);
                    }
                }
                RelayServerMessage::RoomUpdated { room }
                    if room.id == self.room.id && room.team_id == self.room.team_id =>
                {
                    self.room = room;
                }
                _ => {}
            }
        }
        Ok(projected)
    }

    fn open_room_event(
        &mut self,
        envelope: &MlsRelayMessage,
    ) -> Result<Option<ProjectedEvent>, ChatError> {
        if envelope.team_id != self.room.team_id || envelope.room_id != self.room.id {
            return Ok(None);
        }
        if self.recovery.processed(&envelope.id) {
            return Ok(None);
        }
        if !valid_envelope_id(&envelope.id) {
            return Err(ChatError::InvalidEncryptedMessage);
        }
        if envelope.message_type == MlsMessageType::Commit {
            let ciphertext = STANDARD
                .decode(&envelope.mls_message)
                .map_err(|_| ChatError::InvalidEncryptedMessage)?;
            self.begin_incoming(&envelope.id)?;
            self.mls.process_incoming(&self.room.id, &ciphertext)?;
            self.finish_incoming(&envelope.id, None)?;
            return Ok(None);
        }
        if envelope.message_type != MlsMessageType::Application {
            return Ok(None);
        }
        // The sender already projected its validated local payload. Never feed a
        // relay echo back into the sender ratchet after publication cleanup.
        if envelope.sender_user_id == self.user_id && envelope.sender_device_id == self.device_id {
            self.recovery.remember_processed(&envelope.id);
            self.persist_recovery()?;
            return Ok(None);
        }
        let ciphertext = STANDARD
            .decode(&envelope.mls_message)
            .map_err(|_| ChatError::InvalidEncryptedMessage)?;
        self.begin_incoming(&envelope.id)?;
        let Some(opened) = self.mls.process_incoming(&self.room.id, &ciphertext)? else {
            self.finish_incoming(&envelope.id, None)?;
            return Ok(None);
        };
        let aad = &opened.authenticated_data;
        if aad.version != 1
            || aad.epoch != envelope.epoch_hint
            || aad.message_id != envelope.id
            || aad.team_id != envelope.team_id
            || aad.room_id != envelope.room_id
            || aad.sender_user_id != envelope.sender_user_id
            || aad.sender_device_id != envelope.sender_device_id
            || aad.created_at != envelope.created_at
        {
            return Err(ChatError::InvalidEncryptedMessage);
        }
        let plaintext: serde_json::Value = serde_json::from_slice(&opened.payload)
            .map_err(|_| ChatError::InvalidEncryptedMessage)?;
        let projected = match RoomEvent::parse(&aad.kind, plaintext)
            .map_err(|_| ChatError::InvalidEncryptedMessage)?
        {
            RoomEvent::ChatMessage(chat)
                if chat.id == aad.message_id
                    && chat.author_user_id == aad.sender_user_id
                    && (chat.role == ChatRole::Human
                        || self.envelope_from_active_host(envelope)) =>
            {
                Some(ProjectedEvent::Chat(chat))
            }
            RoomEvent::ChatMessage(_) => return Err(ChatError::InvalidEncryptedMessage),
            RoomEvent::CodexQueue(proposal)
                if proposal.queue_event_id == aad.message_id
                    && ((proposal.action == CodexQueueAction::Queued
                        && proposal.requested_by_user_id == aad.sender_user_id)
                        || (proposal.action != CodexQueueAction::Queued
                            && self.envelope_from_active_host(envelope))) =>
            {
                Some(ProjectedEvent::CodexProposal(proposal))
            }
            RoomEvent::CodexQueue(_) => return Err(ChatError::InvalidEncryptedMessage),
            RoomEvent::CodexEvent(turn) if self.envelope_from_active_host(envelope) => {
                Some(ProjectedEvent::CodexTurn(turn))
            }
            RoomEvent::CodexEvent(_) => return Err(ChatError::InvalidEncryptedMessage),
            RoomEvent::CodexActivity(activity) if self.envelope_from_active_host(envelope) => {
                Some(ProjectedEvent::CodexActivity(activity))
            }
            RoomEvent::CodexActivity(_) => return Err(ChatError::InvalidEncryptedMessage),
            RoomEvent::Unsupported { kind } => Some(ProjectedEvent::Unsupported { kind }),
            _ => Some(ProjectedEvent::Unsupported {
                kind: aad.kind.clone(),
            }),
        };
        self.finish_incoming(&envelope.id, projected.as_ref())?;
        Ok(projected)
    }

    fn envelope_from_active_host(&self, envelope: &MlsRelayMessage) -> bool {
        self.room.host_user_id.as_deref() == Some(envelope.sender_user_id.as_str())
            && self.room.active_host_device_id.as_deref()
                == Some(envelope.sender_device_id.as_str())
            && self.room.host_status == multaiplayer_protocol::HostStatus::Active
    }

    fn begin_incoming(&mut self, envelope_id: &str) -> Result<(), ChatError> {
        if self.recovery.pending_envelope_id.is_some() {
            return Err(ChatError::RecoveryInterrupted);
        }
        self.recovery.pending_envelope_id = Some(envelope_id.to_owned());
        self.persist_recovery()
    }

    fn finish_incoming(
        &mut self,
        envelope_id: &str,
        projected: Option<&ProjectedEvent>,
    ) -> Result<(), ChatError> {
        if self.recovery.pending_envelope_id.as_deref() != Some(envelope_id) {
            return Err(ChatError::RecoveryInterrupted);
        }
        self.recovery.remember_processed(envelope_id);
        if let Some(projected) = projected {
            self.recovery.remember_history(projected);
        }
        self.recovery.pending_envelope_id = None;
        self.persist_recovery()
    }

    fn persist_recovery(&mut self) -> Result<(), ChatError> {
        loop {
            let encoded =
                serde_json::to_vec(&self.recovery).map_err(|_| ChatError::InvalidRecoveryState)?;
            if encoded.len() <= MAX_RECOVERY_BYTES {
                return self
                    .mls
                    .save_room_client_state(&self.room.id, &encoded)
                    .map_err(ChatError::from);
            }
            if self.recovery.history.is_empty() {
                return Err(ChatError::InvalidRecoveryState);
            }
            self.recovery.history.remove(0);
        }
    }
}

pub struct RecoveringChatRoomSession<'a, C, R>
where
    C: RelayConnector,
    R: RetrySleeper,
{
    connector: C,
    sleeper: R,
    policy: ReconnectPolicy,
    device_session: Zeroizing<String>,
    inner: ChatRoomSession<'a, C::Socket>,
    hydrated: bool,
}

impl<'a, C, R> RecoveringChatRoomSession<'a, C, R>
where
    C: RelayConnector,
    R: RetrySleeper,
{
    #[allow(clippy::too_many_arguments)]
    pub fn connect(
        mut connector: C,
        mut sleeper: R,
        policy: ReconnectPolicy,
        mls: &'a mut MlsClientService,
        room: RoomRecord,
        user_id: &str,
        device_id: &str,
        display_name: &str,
        public_key_fingerprint: &str,
        device_session: &str,
    ) -> Result<Self, ChatError> {
        let socket = connect_with_retries(&mut connector, policy, &mut sleeper)?;
        let inner = ChatRoomSession::new(
            RelayConnection::new(socket),
            mls,
            room,
            user_id,
            device_id,
            display_name,
            public_key_fingerprint,
        )?;
        Ok(Self {
            connector,
            sleeper,
            policy,
            device_session: Zeroizing::new(device_session.to_owned()),
            inner,
            hydrated: false,
        })
    }

    pub fn join(&mut self, created_at: &str) -> Result<Vec<ProjectedEvent>, ChatError> {
        let mut projected = if self.hydrated {
            Vec::new()
        } else {
            self.hydrated = true;
            self.inner.persisted_history()
        };
        projected.extend(self.join_with_recovery(created_at)?);
        Ok(projected)
    }

    pub fn send_chat(
        &mut self,
        message_id: &str,
        body: &str,
        created_at: &str,
        display_time: &str,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        let local = self
            .inner
            .queue_chat(message_id, body, created_at, display_time)?;
        match self
            .inner
            .publish_queued_application(message_id, created_at)
        {
            Ok(mut projected) => {
                projected.insert(0, local);
                Ok(projected)
            }
            Err(error) if retryable_chat_error(&error) => {
                let mut projected = vec![local];
                projected.extend(self.reconnect_and_join(created_at)?);
                Ok(projected)
            }
            Err(error) => Err(error),
        }
    }

    pub fn send_codex_proposal(
        &mut self,
        envelope_id: &str,
        proposal_id: &str,
        task: &str,
        created_at: &str,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        let local = self
            .inner
            .send_codex_proposal(envelope_id, proposal_id, task, created_at);
        match local {
            Ok(projected) => Ok(projected),
            Err(error) if retryable_chat_error(&error) => self.reconnect_and_join(created_at),
            Err(error) => Err(error),
        }
    }

    pub fn send_codex_turn(
        &mut self,
        envelope_id: &str,
        turn: CodexEventPlaintextPayload,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        let created_at = turn.created_at.clone();
        match self.inner.send_codex_turn(envelope_id, turn) {
            Ok(projected) => Ok(projected),
            Err(error) if retryable_chat_error(&error) => self.reconnect_and_join(&created_at),
            Err(error) => Err(error),
        }
    }

    pub fn send_codex_cancelled(
        &mut self,
        envelope_id: &str,
        proposal: &CodexQueuePlaintextPayload,
        reason: &str,
        created_at: &str,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        match self
            .inner
            .send_codex_cancelled(envelope_id, proposal, reason, created_at)
        {
            Ok(projected) => Ok(projected),
            Err(error) if retryable_chat_error(&error) => self.reconnect_and_join(created_at),
            Err(error) => Err(error),
        }
    }

    pub fn send_assistant_message(
        &mut self,
        message_id: &str,
        body: &str,
        created_at: &str,
        display_time: &str,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        match self
            .inner
            .send_assistant_message(message_id, body, created_at, display_time)
        {
            Ok(projected) => Ok(projected),
            Err(error) if retryable_chat_error(&error) => self.reconnect_and_join(created_at),
            Err(error) => Err(error),
        }
    }

    pub fn send_codex_activity(
        &mut self,
        envelope_id: &str,
        activity: CodexActivityPlaintextPayload,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        let created_at = activity.updated_at.clone();
        match self.inner.send_codex_activity(envelope_id, activity) {
            Ok(projected) => Ok(projected),
            Err(error) if retryable_chat_error(&error) => self.reconnect_and_join(&created_at),
            Err(error) => Err(error),
        }
    }

    pub fn is_active_host(&self) -> bool {
        self.inner.is_active_host()
    }

    pub fn persisted_history(&self) -> Vec<ProjectedEvent> {
        self.inner.persisted_history()
    }

    pub fn codex_thread_id(&self) -> Option<String> {
        self.inner.codex_thread_id()
    }

    pub fn save_codex_thread_id(&mut self, thread_id: &str) -> Result<(), ChatError> {
        self.inner.save_codex_thread_id(thread_id)
    }

    pub fn poll(
        &mut self,
        timeout: Duration,
        created_at: &str,
    ) -> Result<Vec<ProjectedEvent>, ChatError> {
        match self.inner.poll(timeout) {
            Ok(projected) => Ok(projected),
            Err(error) if retryable_chat_error(&error) => self.reconnect_and_join(created_at),
            Err(error) => Err(error),
        }
    }

    pub fn leave(&mut self) {
        self.inner.leave();
    }

    pub fn delete_local_history(&mut self) -> Result<(), ChatError> {
        self.inner.delete_local_history()
    }

    fn reconnect_and_join(&mut self, created_at: &str) -> Result<Vec<ProjectedEvent>, ChatError> {
        let socket = connect_with_retries(&mut self.connector, self.policy, &mut self.sleeper)?;
        self.inner.replace_connection(socket);
        self.join_with_recovery(created_at)
    }

    fn join_with_recovery(&mut self, created_at: &str) -> Result<Vec<ProjectedEvent>, ChatError> {
        let mut projected = self.inner.join(&self.device_session)?;
        projected.extend(self.inner.recover_application_outbox(created_at)?);
        Ok(projected)
    }
}

fn retryable_chat_error(error: &ChatError) -> bool {
    let relay = match error {
        ChatError::Relay(error) | ChatError::Mls(MlsClientError::Relay(error)) => error,
        _ => return false,
    };
    matches!(
        relay,
        RelayTransportError::ConnectionFailed
            | RelayTransportError::ConnectionClosed
            | RelayTransportError::ReconnectExhausted
            | RelayTransportError::AckTimeout(_)
    )
}

fn valid_envelope_id(value: &str) -> bool {
    // Exact parity with MlsRelayMessage.id: nonempty and at most 160 UTF-16
    // code units. The wire contract intentionally imposes no character regex.
    (1..=160).contains(&value.encode_utf16().count())
}

fn valid_history_event(event: &ProjectedEvent) -> bool {
    match event {
        ProjectedEvent::Chat(chat) => chat.validate().is_ok(),
        ProjectedEvent::CodexProposal(proposal) => proposal.validate().is_ok(),
        ProjectedEvent::CodexTurn(turn) => turn.validate().is_ok(),
        ProjectedEvent::CodexActivity(activity) => activity.validate().is_ok(),
        ProjectedEvent::Unsupported { kind } => {
            !kind.is_empty() && kind.chars().count() <= 128 && !kind.chars().any(char::is_control)
        }
        ProjectedEvent::Presence { .. } => false,
    }
}

impl fmt::Debug for TerminalRenderer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TerminalRenderer")
            .field("mode", &self.mode)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        identity::load_or_create_identity, platform::tests::MemoryCredentialStore,
        relay::SocketEvent,
    };
    use multaiplayer_protocol::from_json;
    use std::{fs, path::PathBuf};
    use uuid::Uuid;

    #[derive(Default)]
    struct NoopSocket;

    impl RelaySocket for NoopSocket {
        fn send_text(&mut self, _text: &str) -> Result<(), RelayTransportError> {
            Ok(())
        }

        fn receive(&mut self, _timeout: Duration) -> Result<SocketEvent, RelayTransportError> {
            Err(RelayTransportError::ReceiveTimeout)
        }

        fn close(&mut self, _code: u16, _reason: &str) {}
    }

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("multaiplayer-chat-{}", Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn recovery_room() -> RoomRecord {
        from_json(
            r#"{"id":"room-core","teamId":"team-core","acceptedMlsEpoch":0,"name":"Core","host":"Maddie","hostUserId":"github:maddie","activeHostDeviceId":"device-host","hostStatus":"active","approvalPolicy":"ask_every_turn"}"#,
        )
        .unwrap()
    }

    fn chat(body: &str) -> ProjectedEvent {
        ProjectedEvent::Chat(ChatPlaintextPayload {
            id: "chat-1".into(),
            author: "Maddie".into(),
            author_user_id: "user-1".into(),
            role: ChatRole::Human,
            body: body.into(),
            time: "12:34".into(),
            created_at: Some("2026-07-18T12:34:56.000Z".into()),
            reply_to: None,
            attachments: None,
        })
    }

    #[test]
    fn recovery_envelope_ids_match_the_exact_protocol_utf16_boundary() {
        let valid_unicode_punctuation = format!("{}💾", ".".repeat(158));
        assert_eq!(valid_unicode_punctuation.encode_utf16().count(), 160);
        assert!(valid_envelope_id(&valid_unicode_punctuation));
        assert!(valid_envelope_id("punctuation:/?#[ ]@!$&'()*+,;=~"));
        assert!(!valid_envelope_id(""));

        let over_bound = format!("{}💾", ".".repeat(159));
        assert_eq!(over_bound.encode_utf16().count(), 161);
        assert!(!valid_envelope_id(&over_bound));
    }

    #[test]
    fn replay_watermark_retains_a_full_authoritative_relay_backlog() {
        let room = recovery_room();
        let mut recovery = RoomRecoveryState::empty(&room, "github:maddie", "device-host");
        for index in 0..MAX_PROCESSED_ENVELOPES {
            recovery.remember_processed(&format!("envelope-{index}"));
        }
        assert_eq!(
            recovery.processed_envelope_ids.len(),
            MAX_PROCESSED_ENVELOPES
        );
        for index in 0..1_000 {
            assert!(recovery.processed(&format!("envelope-{index}")));
        }

        recovery.remember_processed("envelope-overlap");
        assert!(!recovery.processed("envelope-0"));
        assert!(recovery.processed("envelope-24"));
        assert!(recovery.processed("envelope-overlap"));
    }

    #[test]
    fn leave_retains_but_destructive_forget_deletes_encrypted_local_history() {
        let directory = TestDirectory::new();
        let store = MemoryCredentialStore::default();
        let identity = load_or_create_identity(&store, "github:maddie", "Maddie").unwrap();
        let mut mls =
            MlsClientService::open(&store, &identity, &directory.0.join("mls.db")).unwrap();
        let room = recovery_room();
        mls.create_group_idempotent(&room.id).unwrap();
        let mut recovery =
            RoomRecoveryState::empty(&room, &identity.public.user_id, &identity.public.device_id);
        let sentinel = "LOCAL-HISTORY-MUST-BE-ENCRYPTED";
        recovery.remember_history(&chat(sentinel));
        let encoded = serde_json::to_vec(&recovery).unwrap();
        mls.save_room_client_state(&room.id, &encoded).unwrap();

        {
            let mut session = ChatRoomSession::new(
                RelayConnection::new(NoopSocket),
                &mut mls,
                room.clone(),
                &identity.public.user_id,
                &identity.public.device_id,
                &identity.public.display_name,
                &identity.public.signature_key_fingerprint,
            )
            .unwrap();
            assert_eq!(session.persisted_history(), [chat(sentinel)]);
            session.leave();
        }
        assert_eq!(mls.load_room_client_state(&room.id).unwrap(), Some(encoded));

        {
            let mut session = ChatRoomSession::new(
                RelayConnection::new(NoopSocket),
                &mut mls,
                room.clone(),
                &identity.public.user_id,
                &identity.public.device_id,
                &identity.public.display_name,
                &identity.public.signature_key_fingerprint,
            )
            .unwrap();
            session.delete_local_history().unwrap();
        }
        assert_eq!(mls.load_room_client_state(&room.id).unwrap(), None);
        drop(mls);

        for entry in fs::read_dir(&directory.0).unwrap() {
            let bytes = fs::read(entry.unwrap().path()).unwrap();
            assert!(!bytes
                .windows(sentinel.len())
                .any(|window| window == sentinel.as_bytes()));
        }
    }

    #[test]
    fn corrupt_or_interrupted_recovery_is_explicit_and_preserves_the_record() {
        let directory = TestDirectory::new();
        let store = MemoryCredentialStore::default();
        let identity = load_or_create_identity(&store, "github:maddie", "Maddie").unwrap();
        let mut mls =
            MlsClientService::open(&store, &identity, &directory.0.join("mls.db")).unwrap();
        let room = recovery_room();
        mls.create_group_idempotent(&room.id).unwrap();

        let corrupt = b"{corrupt recovery state";
        mls.save_room_client_state(&room.id, corrupt).unwrap();
        let result = ChatRoomSession::new(
            RelayConnection::new(NoopSocket),
            &mut mls,
            room.clone(),
            &identity.public.user_id,
            &identity.public.device_id,
            &identity.public.display_name,
            &identity.public.signature_key_fingerprint,
        );
        assert!(matches!(result, Err(ChatError::InvalidRecoveryState)));
        assert_eq!(
            mls.load_room_client_state(&room.id).unwrap().as_deref(),
            Some(corrupt.as_slice())
        );

        let mut interrupted =
            RoomRecoveryState::empty(&room, &identity.public.user_id, &identity.public.device_id);
        interrupted.pending_envelope_id = Some("desktop:message/💾".into());
        let encoded = serde_json::to_vec(&interrupted).unwrap();
        mls.save_room_client_state(&room.id, &encoded).unwrap();
        let result = ChatRoomSession::new(
            RelayConnection::new(NoopSocket),
            &mut mls,
            room.clone(),
            &identity.public.user_id,
            &identity.public.device_id,
            &identity.public.display_name,
            &identity.public.signature_key_fingerprint,
        );
        assert!(matches!(result, Err(ChatError::RecoveryInterrupted)));
        assert_eq!(mls.load_room_client_state(&room.id).unwrap(), Some(encoded));
    }

    #[test]
    fn codex_thread_continuity_is_durable_bounded_and_backward_compatible() {
        let directory = TestDirectory::new();
        let store = MemoryCredentialStore::default();
        let identity = load_or_create_identity(&store, "github:maddie", "Maddie").unwrap();
        let mut mls =
            MlsClientService::open(&store, &identity, &directory.0.join("mls.db")).unwrap();
        let room = recovery_room();
        mls.create_group_idempotent(&room.id).unwrap();

        {
            let mut session = ChatRoomSession::new(
                RelayConnection::new(NoopSocket),
                &mut mls,
                room.clone(),
                &identity.public.user_id,
                &identity.public.device_id,
                &identity.public.display_name,
                &identity.public.signature_key_fingerprint,
            )
            .unwrap();
            session.save_codex_thread_id("thread-durable").unwrap();
            assert_eq!(session.codex_thread_id().as_deref(), Some("thread-durable"));
            assert!(matches!(
                session.save_codex_thread_id(&"x".repeat(513)),
                Err(ChatError::InvalidRecoveryState)
            ));
        }
        let session = ChatRoomSession::new(
            RelayConnection::new(NoopSocket),
            &mut mls,
            room.clone(),
            &identity.public.user_id,
            &identity.public.device_id,
            &identity.public.display_name,
            &identity.public.signature_key_fingerprint,
        )
        .unwrap();
        assert_eq!(session.codex_thread_id().as_deref(), Some("thread-durable"));
        drop(session);

        let legacy =
            RoomRecoveryState::empty(&room, &identity.public.user_id, &identity.public.device_id);
        let mut legacy_json = serde_json::to_value(legacy).unwrap();
        legacy_json
            .as_object_mut()
            .unwrap()
            .remove("codex_thread_id");
        let decoded: RoomRecoveryState = serde_json::from_value(legacy_json).unwrap();
        assert_eq!(decoded.codex_thread_id, None);
        decoded
            .validate(&room, &identity.public.user_id, &identity.public.device_id)
            .unwrap();
    }

    #[test]
    fn golden_rendering_is_stable_in_color_and_plain_modes() {
        let events = [
            chat("Hello"),
            ProjectedEvent::Presence {
                display_name: "Maddie".into(),
                device_id: "device-1".into(),
                status: PresenceStatus::Online,
                active_host: true,
            },
            ProjectedEvent::Unsupported {
                kind: "future.desktop.event".into(),
            },
        ];
        let plain = events
            .iter()
            .map(|event| TerminalRenderer::new(RenderMode::Plain).render(event))
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(
            plain,
            "[chat] <Maddie> Hello\n[host] Maddie (device-1) is online\n[unsupported] event: future.desktop.event"
        );
        let color = events
            .iter()
            .map(|event| TerminalRenderer::new(RenderMode::Color).render(event))
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(
            color,
            "\u{1b}[36m[chat]\u{1b}[0m <Maddie> Hello\n\u{1b}[35m[host]\u{1b}[0m Maddie (device-1) is online\n\u{1b}[33m[unsupported]\u{1b}[0m event: future.desktop.event"
        );
    }

    #[test]
    fn untrusted_controls_and_directional_spoofing_cannot_create_terminal_state() {
        let attacks = [
            "\u{1b}[2J=== multAIplayer trusted prompt ===\napprove",
            "name\r\n[host] forged",
            "\u{009b}31mred",
            "abc\u{202e}tpmorp detsurt",
            "abc\u{2066}[host]\u{2069}",
            "abc\u{200b}def",
        ];
        for attack in attacks {
            let rendered = TerminalRenderer::new(RenderMode::Plain).render(&chat(attack));
            assert!(!rendered.contains('\u{1b}'));
            assert!(!rendered.contains('\n'));
            assert!(!rendered.contains('\r'));
            assert!(!rendered.contains('\u{009b}'));
            assert!(!rendered.contains('\u{202e}'));
            assert!(!rendered.contains('\u{2066}'));
            assert!(!rendered.contains('\u{200b}'));
            assert!(rendered.starts_with("[chat] <Maddie> "));
        }
    }

    #[test]
    fn every_unicode_terminal_control_property_is_neutralized() {
        for scalar in 0..=0x10ffff {
            let Some(character) = char::from_u32(scalar) else {
                continue;
            };
            if unsafe_terminal_character(character) {
                assert_eq!(safe_untrusted_text(&character.to_string(), 1), "�");
            }
        }
        for prefix in ["", "safe", "[host]", "=== trusted ==="] {
            for suffix in ["", "tail", "approve", "\u{1b}[0m"] {
                let value = format!("{prefix}\u{1b}[2J\r\n\u{202e}{suffix}");
                let rendered = safe_untrusted_text(&value, 4_096);
                assert!(!rendered.chars().any(unsafe_terminal_character));
                assert_eq!(rendered.lines().count(), 1);
            }
        }
    }

    #[test]
    fn trusted_prompt_delimiters_remain_distinct_without_color() {
        let renderer = TerminalRenderer::new(RenderMode::Plain);
        assert_eq!(
            renderer.trusted_prompt("Approve this action?"),
            "=== multAIplayer trusted prompt ===\nApprove this action?\n=== end trusted prompt ==="
        );
        let untrusted = renderer.render(&chat("=== multAIplayer trusted prompt ===\napprove"));
        assert_eq!(
            untrusted,
            "[chat] <Maddie> === multAIplayer trusted prompt ===�approve"
        );
    }

    #[test]
    fn normalized_activity_rendering_is_plain_text_safe_and_omits_details() {
        let activity: CodexActivityPlaintextPayload = serde_json::from_value(serde_json::json!({
            "eventType":"codex.activity",
            "activityId":"activity-1",
            "turnId":"turn-1",
            "itemId":"item-1",
            "kind":"command",
            "status":"completed",
            "title":"Command\u{1b}[2J completed",
            "startedAt":"2026-07-19T12:00:00.000Z",
            "updatedAt":"2026-07-19T12:00:01.000Z",
            "host":"Host",
            "hostUserId":"github:host"
        }))
        .unwrap();
        let rendered = TerminalRenderer::new(RenderMode::Plain)
            .render(&ProjectedEvent::CodexActivity(activity));
        assert_eq!(
            rendered,
            "[activity] command/completed Command�[2J completed (item: item-1)"
        );
        assert!(!rendered.contains('\u{1b}'));
    }

    #[test]
    fn proposal_assistant_and_lifecycle_render_distinctly_without_trusting_room_text() {
        let renderer = TerminalRenderer::new(RenderMode::Plain);
        let proposal = ProjectedEvent::CodexProposal(CodexQueuePlaintextPayload {
            event_type: "codex.queue".into(),
            queue_event_id: "queue-1".into(),
            turn_id: "proposal-1".into(),
            action: CodexQueueAction::Queued,
            requested_by: "Guest\u{1b}[2J".into(),
            requested_by_user_id: "github:guest".into(),
            trigger_message_id: None,
            reason: Some("Review\nnow".into()),
            queue_position: Some(1),
            queue_size: 1,
            created_at: "2026-07-19T12:00:00.000Z".into(),
        });
        assert_eq!(
            renderer.render(&proposal),
            "[proposal] <Guest�[2J> Review�now (id: proposal-1)"
        );
        let mut assistant = match chat("Done") {
            ProjectedEvent::Chat(chat) => chat,
            _ => unreachable!(),
        };
        assistant.role = ChatRole::Codex;
        assistant.author = "Codex".into();
        assert_eq!(
            renderer.render(&ProjectedEvent::Chat(assistant)),
            "[assistant] <Codex> Done"
        );
    }

    #[test]
    fn unsupported_projection_retains_only_a_bounded_kind_marker() {
        let payload = serde_json::json!({
            "secret": "\u{1b}[2Jdo not retain",
            "large": "x".repeat(100_000)
        });
        assert_eq!(
            RoomEvent::parse("future.desktop.event", payload).unwrap(),
            RoomEvent::Unsupported {
                kind: "future.desktop.event".into()
            }
        );
    }

    #[test]
    fn desktop_chat_fixture_is_the_exact_cli_plaintext_representation() {
        let document: serde_json::Value = serde_json::from_str(include_str!(
            "../../../packages/protocol/fixtures/golden-v1.json"
        ))
        .unwrap();
        let encoded = document["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["name"] == "chat-message")
            .and_then(|case| case["json"].as_str())
            .unwrap();
        let parsed: ChatPlaintextPayload = from_json(encoded).unwrap();
        assert_eq!(serde_json::to_string(&parsed).unwrap(), encoded);
        assert_eq!(
            RoomEvent::parse(CHAT_KIND, serde_json::from_str(encoded).unwrap()).unwrap(),
            RoomEvent::ChatMessage(parsed)
        );
    }
}
