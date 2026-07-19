use crate::{
    mls::{MlsClientError, MlsClientService, OutboxRoute, RelayMlsPublisher},
    relay::{RelayConnection, RelaySocket, RelayTransportError},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use mls_core::ApplicationAuthenticatedDataInput;
use multaiplayer_protocol::{
    ChatPlaintextPayload, ChatRole, MlsMessageType, MlsRelayMessage, PresenceStatus,
    RelayClientMessage, RelayServerMessage, RoomEvent, RoomRecord, Validate,
};
use std::{collections::BTreeMap, fmt, time::Duration};
use thiserror::Error;

const CHAT_KIND: &str = "chat.message";
const MAX_RENDERED_TEXT_CHARS: usize = 4_096;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenderMode {
    Color,
    Plain,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProjectedEvent {
    Chat(ChatPlaintextPayload),
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
                match self.mode {
                    RenderMode::Color => format!("\u{1b}[36m[chat]\u{1b}[0m <{author}> {body}"),
                    RenderMode::Plain => format!("[chat] <{author}> {body}"),
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
        let prompt = safe_untrusted_text(prompt, 512);
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
        Ok(Self {
            connection,
            mls,
            room,
            user_id: user_id.to_owned(),
            device_id: device_id.to_owned(),
            display_name: display_name.to_owned(),
            public_key_fingerprint: public_key_fingerprint.to_owned(),
            presence: BTreeMap::new(),
        })
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
        chat.validate().map_err(|_| ChatError::InvalidMessage)?;
        let payload = serde_json::to_vec(&chat).map_err(|_| ChatError::InvalidMessage)?;
        self.mls.queue_application(
            &self.room.id,
            message_id,
            &payload,
            ApplicationAuthenticatedDataInput {
                version: 1,
                message_id: message_id.to_owned(),
                team_id: self.room.team_id.clone(),
                room_id: self.room.id.clone(),
                kind: CHAT_KIND.to_owned(),
                sender_user_id: self.user_id.clone(),
                sender_device_id: self.device_id.clone(),
                created_at: created_at.to_owned(),
            },
        )?;

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
        let mut projected = vec![ProjectedEvent::Chat(chat)];
        projected.extend(self.project_received(received)?);
        Ok(projected)
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
        if envelope.message_type == MlsMessageType::Commit {
            let ciphertext = STANDARD
                .decode(&envelope.mls_message)
                .map_err(|_| ChatError::InvalidEncryptedMessage)?;
            self.mls.process_incoming(&self.room.id, &ciphertext)?;
            return Ok(None);
        }
        if envelope.message_type != MlsMessageType::Application {
            return Ok(None);
        }
        // The sender already projected its validated local payload. Never feed a
        // relay echo back into the sender ratchet after publication cleanup.
        if envelope.sender_user_id == self.user_id && envelope.sender_device_id == self.device_id {
            return Ok(None);
        }
        let ciphertext = STANDARD
            .decode(&envelope.mls_message)
            .map_err(|_| ChatError::InvalidEncryptedMessage)?;
        let Some(opened) = self.mls.process_incoming(&self.room.id, &ciphertext)? else {
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
        match RoomEvent::parse(&aad.kind, plaintext)
            .map_err(|_| ChatError::InvalidEncryptedMessage)?
        {
            RoomEvent::ChatMessage(chat)
                if chat.id == aad.message_id && chat.author_user_id == aad.sender_user_id =>
            {
                Ok(Some(ProjectedEvent::Chat(chat)))
            }
            RoomEvent::ChatMessage(_) => Err(ChatError::InvalidEncryptedMessage),
            RoomEvent::Unsupported { kind } => Ok(Some(ProjectedEvent::Unsupported { kind })),
            _ => Ok(Some(ProjectedEvent::Unsupported {
                kind: aad.kind.clone(),
            })),
        }
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
    use multaiplayer_protocol::from_json;

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
