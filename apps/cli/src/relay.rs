use crate::{
    auth::{endpoint, load_relay_transport_session, validate_relay_origin},
    platform::{CredentialStore, HttpClient, HttpResponse},
    CliError,
};
use multaiplayer_protocol::{
    from_json, to_json, RelayClientMessage, RelayErrorCode, RelayServerMessage, RoomRecord,
    TeamRecord, Validate,
};
use reqwest::Url;
use serde::Deserialize;
use std::{
    collections::HashSet,
    io,
    net::TcpStream,
    thread,
    time::{Duration, Instant},
};
use thiserror::Error;
use tungstenite::{
    client::{connect_with_config, IntoClientRequest},
    http::{header::SEC_WEBSOCKET_PROTOCOL, HeaderValue},
    protocol::WebSocketConfig,
    stream::MaybeTlsStream,
    Message, WebSocket,
};
use zeroize::Zeroizing;

const NATIVE_SESSION_HEADER: &str = "x-multaiplayer-session";
const WEBSOCKET_PROTOCOL: &str = "multaiplayer-v1";
const WEBSOCKET_SESSION_PREFIX: &str = "multaiplayer-session.";
const MAX_WEBSOCKET_REDIRECTS: u8 = 0;
pub const MAX_SERVER_MESSAGE_BYTES: usize = 10_000_000;
pub const MAX_HTTP_RESPONSE_BYTES: usize = 1_048_576;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceSnapshot {
    pub teams: Vec<TeamRecord>,
    pub rooms: Vec<RoomRecord>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkspaceResponse {
    teams: Vec<TeamRecord>,
    rooms: Vec<RoomRecord>,
}

pub struct WorkspaceClient<'a, S, H> {
    store: &'a S,
    http: &'a H,
    relay_origin: String,
}

impl<'a, S: CredentialStore, H: HttpClient> WorkspaceClient<'a, S, H> {
    pub fn new(store: &'a S, http: &'a H, relay_origin: &str) -> Result<Self, CliError> {
        Ok(Self {
            store,
            http,
            relay_origin: validate_relay_origin(relay_origin)?,
        })
    }

    pub fn load(&self) -> Result<WorkspaceSnapshot, CliError> {
        let session = load_relay_transport_session(self.store, &self.relay_origin)?
            .ok_or(CliError::RelayAuthenticationRequired)?;
        let endpoint = endpoint(&session.origin, "/teams")?;
        let response = self.http.get(
            &endpoint,
            &[(NATIVE_SESSION_HEADER, session.secret.as_str())],
        )?;
        require_exact_response_url(&response, &endpoint)?;
        if response.status == 401 {
            return Err(CliError::RelayAuthenticationRequired);
        }
        if !(200..300).contains(&response.status) {
            return Err(CliError::RelayUnavailable);
        }
        if response.body.len() > MAX_HTTP_RESPONSE_BYTES {
            return Err(CliError::InvalidRelayResponse);
        }
        let body =
            std::str::from_utf8(&response.body).map_err(|_| CliError::InvalidRelayResponse)?;
        let decoded: WorkspaceResponse =
            serde_json::from_str(body).map_err(|_| CliError::InvalidRelayResponse)?;
        for team in &decoded.teams {
            team.validate()
                .map_err(|_| CliError::InvalidRelayResponse)?;
        }
        for room in &decoded.rooms {
            room.validate()
                .map_err(|_| CliError::InvalidRelayResponse)?;
        }
        validate_workspace_relationships(&decoded)?;
        Ok(WorkspaceSnapshot {
            teams: decoded.teams,
            rooms: decoded.rooms,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReconnectPolicy {
    pub max_reconnects: u8,
    pub initial_delay: Duration,
    pub max_delay: Duration,
}

impl Default for ReconnectPolicy {
    fn default() -> Self {
        Self {
            max_reconnects: 5,
            initial_delay: Duration::from_millis(500),
            max_delay: Duration::from_secs(10),
        }
    }
}

impl ReconnectPolicy {
    pub fn delay(self, reconnect_index: u8) -> Duration {
        let multiplier = 1u32
            .checked_shl(u32::from(reconnect_index))
            .unwrap_or(u32::MAX);
        self.initial_delay
            .checked_mul(multiplier)
            .unwrap_or(self.max_delay)
            .min(self.max_delay)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AckOperation {
    Join,
    Publish,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum RelayTransportError {
    #[error("The relay WebSocket origin does not match the authenticated HTTP origin.")]
    OriginMismatch,
    #[error("The relay WebSocket could not connect.")]
    ConnectionFailed,
    #[error("Sign in with GitHub before connecting to the relay.")]
    AuthenticationRequired,
    #[error("The stored relay session is invalid.")]
    InvalidStoredSession,
    #[error("The secure credential store is unavailable.")]
    CredentialStoreUnavailable,
    #[error("The relay WebSocket exhausted its reconnect budget.")]
    ReconnectExhausted,
    #[error("The relay WebSocket closed before the operation completed.")]
    ConnectionClosed,
    #[error("The relay sent invalid or unsupported data.")]
    InvalidServerMessage,
    #[error("The relay acknowledgement timed out.")]
    AckTimeout(AckOperation),
    #[error("Timed out waiting for a relay server message.")]
    ReceiveTimeout,
    #[error("The relay rejected the acknowledged operation.")]
    AckRejected(Option<RelayErrorCode>),
    #[error("The relay operation is already awaiting acknowledgement.")]
    DuplicateAck,
    #[error("The relay client message is invalid.")]
    InvalidClientMessage,
}

pub enum SocketEvent {
    Text(String),
    Binary,
    Invalid,
    Closed,
}

pub trait RelaySocket {
    fn send_text(&mut self, text: &str) -> Result<(), RelayTransportError>;
    fn receive(&mut self, timeout: Duration) -> Result<SocketEvent, RelayTransportError>;
    fn close(&mut self, code: u16, reason: &str);
}

pub trait RelayConnector {
    type Socket: RelaySocket;
    fn connect(&mut self) -> Result<Self::Socket, RelayTransportError>;
}

pub trait RetrySleeper {
    fn sleep(&mut self, delay: Duration);
}

pub struct ThreadSleeper;

impl RetrySleeper for ThreadSleeper {
    fn sleep(&mut self, delay: Duration) {
        thread::sleep(delay);
    }
}

pub fn connect_with_retries<C: RelayConnector>(
    connector: &mut C,
    policy: ReconnectPolicy,
    sleeper: &mut impl RetrySleeper,
) -> Result<C::Socket, RelayTransportError> {
    for reconnect in 0..=policy.max_reconnects {
        match connector.connect() {
            Ok(socket) => return Ok(socket),
            Err(error)
                if is_retryable_connection_error(&error) && reconnect < policy.max_reconnects =>
            {
                sleeper.sleep(policy.delay(reconnect))
            }
            Err(error) if is_retryable_connection_error(&error) => {
                return Err(RelayTransportError::ReconnectExhausted)
            }
            Err(error) => return Err(error),
        }
    }
    Err(RelayTransportError::ReconnectExhausted)
}

fn is_retryable_connection_error(error: &RelayTransportError) -> bool {
    matches!(
        error,
        RelayTransportError::ConnectionFailed | RelayTransportError::ConnectionClosed
    )
}

pub struct RelayConnection<S> {
    socket: S,
    pending_publish: Option<String>,
    pending_join: Option<(String, String)>,
}

impl<S: RelaySocket> RelayConnection<S> {
    pub fn new(socket: S) -> Self {
        Self {
            socket,
            pending_publish: None,
            pending_join: None,
        }
    }

    pub fn into_inner(self) -> S {
        self.socket
    }

    pub fn send(&mut self, message: &RelayClientMessage) -> Result<(), RelayTransportError> {
        let encoded = to_json(message).map_err(|_| RelayTransportError::InvalidClientMessage)?;
        self.socket.send_text(&encoded)
    }

    pub fn publish_and_wait_for_ack(
        &mut self,
        message: &RelayClientMessage,
        timeout: Duration,
        handler: &mut impl FnMut(&RelayServerMessage) -> Result<(), RelayTransportError>,
    ) -> Result<(), RelayTransportError> {
        let RelayClientMessage::Publish { message: envelope } = message else {
            return Err(RelayTransportError::InvalidClientMessage);
        };
        if self.pending_publish.is_some() {
            return Err(RelayTransportError::DuplicateAck);
        }
        self.pending_publish = Some(envelope.id.clone());
        let result = self.send(message).and_then(|()| {
            self.wait_for_ack(AckTarget::Publish(envelope.id.as_str()), timeout, handler)
        });
        self.pending_publish = None;
        result
    }

    pub fn join_and_wait_for_ack(
        &mut self,
        message: &RelayClientMessage,
        timeout: Duration,
        handler: &mut impl FnMut(&RelayServerMessage) -> Result<(), RelayTransportError>,
    ) -> Result<(), RelayTransportError> {
        let RelayClientMessage::Join {
            team_id, room_id, ..
        } = message
        else {
            return Err(RelayTransportError::InvalidClientMessage);
        };
        if self.pending_join.is_some() {
            return Err(RelayTransportError::DuplicateAck);
        }
        self.pending_join = Some((team_id.clone(), room_id.clone()));
        let result = self.send(message).and_then(|()| {
            self.wait_for_ack(AckTarget::Join { team_id, room_id }, timeout, handler)
        });
        self.pending_join = None;
        result
    }

    pub fn receive_one(
        &mut self,
        timeout: Duration,
        handler: &mut impl FnMut(&RelayServerMessage) -> Result<(), RelayTransportError>,
    ) -> Result<(), RelayTransportError> {
        let message = self.receive_validated(timeout)?;
        handler(&message)
    }

    fn wait_for_ack(
        &mut self,
        target: AckTarget<'_>,
        timeout: Duration,
        handler: &mut impl FnMut(&RelayServerMessage) -> Result<(), RelayTransportError>,
    ) -> Result<(), RelayTransportError> {
        let deadline = Instant::now() + timeout.max(Duration::from_millis(1));
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(RelayTransportError::AckTimeout(target.operation()));
            }
            let message = match self.receive_validated(remaining) {
                Err(RelayTransportError::ReceiveTimeout) => {
                    return Err(RelayTransportError::AckTimeout(target.operation()))
                }
                other => other?,
            };
            let outcome = target.outcome(&message);
            handler(&message)?;
            match outcome {
                AckOutcome::Continue => {}
                AckOutcome::Accepted => return Ok(()),
                AckOutcome::Rejected(code) => return Err(RelayTransportError::AckRejected(code)),
            }
        }
    }

    fn receive_validated(
        &mut self,
        timeout: Duration,
    ) -> Result<RelayServerMessage, RelayTransportError> {
        match self.socket.receive(timeout)? {
            SocketEvent::Text(text) if text.len() <= MAX_SERVER_MESSAGE_BYTES => from_json(&text)
                .map_err(|_| {
                    self.close_invalid();
                    RelayTransportError::InvalidServerMessage
                }),
            SocketEvent::Text(_) | SocketEvent::Binary | SocketEvent::Invalid => {
                self.close_invalid();
                Err(RelayTransportError::InvalidServerMessage)
            }
            SocketEvent::Closed => Err(RelayTransportError::ConnectionClosed),
        }
    }

    fn close_invalid(&mut self) {
        self.socket.close(1002, "Invalid relay server message");
    }
}

enum AckTarget<'a> {
    Publish(&'a str),
    Join { team_id: &'a str, room_id: &'a str },
}

impl AckTarget<'_> {
    fn operation(&self) -> AckOperation {
        match self {
            Self::Publish(_) => AckOperation::Publish,
            Self::Join { .. } => AckOperation::Join,
        }
    }

    fn outcome(&self, message: &RelayServerMessage) -> AckOutcome {
        match (self, message) {
            (Self::Publish(expected), RelayServerMessage::Published { message_id })
                if expected == message_id =>
            {
                AckOutcome::Accepted
            }
            (
                Self::Publish(expected),
                RelayServerMessage::Error {
                    message_id: Some(message_id),
                    code,
                    ..
                },
            ) if expected == message_id => AckOutcome::Rejected(code.clone()),
            (
                Self::Publish(_),
                RelayServerMessage::Error {
                    message_id: None,
                    code,
                    ..
                },
            ) => AckOutcome::Rejected(code.clone()),
            (
                Self::Join { team_id, room_id },
                RelayServerMessage::Joined {
                    team_id: joined_team,
                    room_id: joined_room,
                },
            ) if *team_id == joined_team && *room_id == joined_room => AckOutcome::Accepted,
            (
                Self::Join { .. },
                RelayServerMessage::Error {
                    message_id: None,
                    code,
                    ..
                },
            ) => AckOutcome::Rejected(code.clone()),
            _ => AckOutcome::Continue,
        }
    }
}

enum AckOutcome {
    Continue,
    Accepted,
    Rejected(Option<RelayErrorCode>),
}

pub struct TungsteniteConnector {
    websocket_url: String,
    session: Zeroizing<String>,
}

impl TungsteniteConnector {
    pub fn from_store(
        store: &impl CredentialStore,
        relay_origin: &str,
    ) -> Result<Self, RelayTransportError> {
        let session = match load_relay_transport_session(store, relay_origin) {
            Ok(Some(session)) => session,
            Ok(None) => return Err(RelayTransportError::AuthenticationRequired),
            Err(CliError::RelayOriginMismatch) => return Err(RelayTransportError::OriginMismatch),
            Err(CliError::InvalidStoredCredential) => {
                return Err(RelayTransportError::InvalidStoredSession)
            }
            Err(CliError::CredentialStoreUnavailable) => {
                return Err(RelayTransportError::CredentialStoreUnavailable)
            }
            Err(_) => return Err(RelayTransportError::InvalidStoredSession),
        };
        let websocket_url = websocket_endpoint(&session.origin)?;
        Ok(Self {
            websocket_url,
            session: session.secret,
        })
    }

    fn protocol_header(&self) -> Result<HeaderValue, RelayTransportError> {
        let protocols = Zeroizing::new(format!(
            "{WEBSOCKET_PROTOCOL}, {WEBSOCKET_SESSION_PREFIX}{}",
            self.session.as_str()
        ));
        HeaderValue::from_str(protocols.as_str()).map_err(|_| RelayTransportError::ConnectionFailed)
    }
}

impl RelayConnector for TungsteniteConnector {
    type Socket = TungsteniteSocket;

    fn connect(&mut self) -> Result<Self::Socket, RelayTransportError> {
        let mut request = self
            .websocket_url
            .as_str()
            .into_client_request()
            .map_err(|_| RelayTransportError::ConnectionFailed)?;
        request
            .headers_mut()
            .insert(SEC_WEBSOCKET_PROTOCOL, self.protocol_header()?);
        let config = websocket_config();
        let (socket, response) =
            connect_with_config(request, Some(config), MAX_WEBSOCKET_REDIRECTS)
                .map_err(|_| RelayTransportError::ConnectionFailed)?;
        require_selected_protocol(response.headers().get(SEC_WEBSOCKET_PROTOCOL))?;
        Ok(TungsteniteSocket { socket })
    }
}

pub struct TungsteniteSocket {
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
}

impl RelaySocket for TungsteniteSocket {
    fn send_text(&mut self, text: &str) -> Result<(), RelayTransportError> {
        self.socket
            .send(Message::Text(text.to_owned().into()))
            .map_err(|_| RelayTransportError::ConnectionClosed)
    }

    fn receive(&mut self, timeout: Duration) -> Result<SocketEvent, RelayTransportError> {
        let deadline = Instant::now() + timeout.max(Duration::from_millis(1));
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(RelayTransportError::ReceiveTimeout);
            }
            set_read_timeout(self.socket.get_mut(), remaining)
                .map_err(|_| RelayTransportError::ConnectionFailed)?;
            match self.socket.read() {
                Ok(Message::Text(text)) => return Ok(SocketEvent::Text(text.to_string())),
                Ok(Message::Binary(_)) => return Ok(SocketEvent::Binary),
                Ok(Message::Close(_)) => return Ok(SocketEvent::Closed),
                Ok(Message::Ping(payload)) => self
                    .socket
                    .send(Message::Pong(payload))
                    .map_err(|_| RelayTransportError::ConnectionClosed)?,
                Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => {}
                Err(tungstenite::Error::Io(error))
                    if matches!(
                        error.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                    ) =>
                {
                    return Err(RelayTransportError::ReceiveTimeout)
                }
                Err(tungstenite::Error::Capacity(_)) | Err(tungstenite::Error::Utf8(_)) => {
                    return Ok(SocketEvent::Invalid)
                }
                Err(_) => return Err(RelayTransportError::ConnectionClosed),
            }
        }
    }

    fn close(&mut self, code: u16, reason: &str) {
        let frame = tungstenite::protocol::CloseFrame {
            code: tungstenite::protocol::frame::coding::CloseCode::from(code),
            reason: reason.to_owned().into(),
        };
        let _ = self.socket.close(Some(frame));
    }
}

fn set_read_timeout(stream: &mut MaybeTlsStream<TcpStream>, timeout: Duration) -> io::Result<()> {
    match stream {
        MaybeTlsStream::Plain(stream) => stream.set_read_timeout(Some(timeout)),
        MaybeTlsStream::Rustls(stream) => stream.sock.set_read_timeout(Some(timeout)),
        _ => Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "unsupported TLS transport",
        )),
    }
}

fn websocket_endpoint(origin: &str) -> Result<String, RelayTransportError> {
    let mut url = Url::parse(origin).map_err(|_| RelayTransportError::OriginMismatch)?;
    if url.scheme() != "https" {
        return Err(RelayTransportError::OriginMismatch);
    }
    url.set_scheme("wss")
        .map_err(|_| RelayTransportError::OriginMismatch)?;
    url.set_path("/rooms");
    Ok(url.to_string())
}

fn websocket_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .max_message_size(Some(MAX_SERVER_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_SERVER_MESSAGE_BYTES))
}

fn require_selected_protocol(value: Option<&HeaderValue>) -> Result<(), RelayTransportError> {
    if value.and_then(|value| value.to_str().ok()) == Some(WEBSOCKET_PROTOCOL) {
        Ok(())
    } else {
        Err(RelayTransportError::ConnectionFailed)
    }
}

fn validate_workspace_relationships(response: &WorkspaceResponse) -> Result<(), CliError> {
    let mut team_ids = HashSet::with_capacity(response.teams.len());
    if response
        .teams
        .iter()
        .any(|team| !team_ids.insert(team.id.as_str()))
    {
        return Err(CliError::InvalidRelayResponse);
    }
    let mut room_ids = HashSet::with_capacity(response.rooms.len());
    if response
        .rooms
        .iter()
        .any(|room| !room_ids.insert(room.id.as_str()) || !team_ids.contains(room.team_id.as_str()))
    {
        return Err(CliError::InvalidRelayResponse);
    }
    Ok(())
}

fn require_exact_response_url(response: &HttpResponse, expected: &str) -> Result<(), CliError> {
    if response.final_url == expected {
        Ok(())
    } else {
        Err(CliError::RelayUnavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{auth::RELAY_SESSION_ACCOUNT, platform::tests::MemoryCredentialStore};
    use serde_json::{json, Value};
    use std::{
        cell::RefCell,
        collections::VecDeque,
        io::{Read, Write},
        net::TcpListener,
        time::Instant,
    };

    const RELAY: &str = "https://relay.example.com";
    const SESSION: &str = "session_abcdefghijklmnopqrstuvwxyz123456";

    #[derive(Clone, Debug, Eq, PartialEq)]
    struct RecordedRequest {
        url: String,
        headers: Vec<(String, String)>,
    }

    #[derive(Default)]
    struct MockHttp {
        responses: RefCell<VecDeque<Result<HttpResponse, CliError>>>,
        requests: RefCell<Vec<RecordedRequest>>,
    }

    impl MockHttp {
        fn push(&self, response: HttpResponse) {
            self.responses.borrow_mut().push_back(Ok(response));
        }
    }

    impl HttpClient for MockHttp {
        fn get(&self, url: &str, headers: &[(&str, &str)]) -> Result<HttpResponse, CliError> {
            self.requests.borrow_mut().push(RecordedRequest {
                url: url.to_owned(),
                headers: headers
                    .iter()
                    .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
                    .collect(),
            });
            self.responses
                .borrow_mut()
                .pop_front()
                .unwrap_or(Err(CliError::RelayUnavailable))
        }

        fn post_json(
            &self,
            _url: &str,
            _headers: &[(&str, &str)],
            _body: &Value,
        ) -> Result<HttpResponse, CliError> {
            Err(CliError::RelayUnavailable)
        }
    }

    fn authenticated_store(origin: &str) -> MemoryCredentialStore {
        let store = MemoryCredentialStore::default();
        store.values.borrow_mut().insert(
            RELAY_SESSION_ACCOUNT.to_owned(),
            json!({ "version": 1, "relay_origin": origin, "session": SESSION }).to_string(),
        );
        store
    }

    fn response(url: &str, status: u16, body: Value) -> HttpResponse {
        HttpResponse {
            status,
            final_url: url.to_owned(),
            headers: Default::default(),
            body: serde_json::to_vec(&body).unwrap(),
        }
    }

    fn golden_value(name: &str) -> Value {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../../../packages/protocol/fixtures/golden-v1.json"
        ))
        .unwrap();
        let encoded = fixtures["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["name"] == name)
            .and_then(|case| case["json"].as_str())
            .unwrap();
        serde_json::from_str(encoded).unwrap()
    }

    #[test]
    fn workspace_read_uses_exact_origin_bound_native_header_and_protocol_fixtures() {
        let store = authenticated_store(RELAY);
        let http = MockHttp::default();
        let team = golden_value("team-record");
        let room = golden_value("room-record");
        http.push(response(
            &format!("{RELAY}/teams"),
            200,
            json!({ "teams": [team], "rooms": [room] }),
        ));

        let snapshot = WorkspaceClient::new(&store, &http, RELAY)
            .unwrap()
            .load()
            .unwrap();

        assert_eq!(snapshot.teams.len(), 1);
        assert_eq!(snapshot.rooms.len(), 1);
        assert_eq!(snapshot.teams[0].archived_at, None);
        assert_eq!(snapshot.teams[0].deleted_at, None);
        assert_eq!(snapshot.rooms[0].archived_at, None);
        assert_eq!(snapshot.rooms[0].deleted_at, None);
        assert_eq!(snapshot.rooms[0].accepted_mls_epoch, Some(7));
        let requests = http.requests.borrow();
        assert_eq!(
            requests.as_slice(),
            [RecordedRequest {
                url: format!("{RELAY}/teams"),
                headers: vec![(NATIVE_SESSION_HEADER.to_owned(), SESSION.to_owned())],
            }]
        );
    }

    #[test]
    fn workspace_read_fails_closed_for_auth_redirects_and_invalid_data_without_defaults() {
        let store = authenticated_store(RELAY);
        for (response, expected) in [
            (
                response(
                    &format!("{RELAY}/teams"),
                    401,
                    json!({ "error": "private", "code": "authentication_required" }),
                ),
                CliError::RelayAuthenticationRequired,
            ),
            (
                response(
                    "https://attacker.example/teams",
                    200,
                    json!({ "teams": [], "rooms": [] }),
                ),
                CliError::RelayUnavailable,
            ),
            (
                response(
                    &format!("{RELAY}/teams"),
                    200,
                    json!({ "teams": [], "rooms": [], "inventedDefault": true }),
                ),
                CliError::InvalidRelayResponse,
            ),
            (
                response(
                    &format!("{RELAY}/teams"),
                    200,
                    json!({
                        "teams": [{ "id": "team-1", "name": "Core", "members": 1, "role": null }],
                        "rooms": []
                    }),
                ),
                CliError::InvalidRelayResponse,
            ),
        ] {
            let http = MockHttp::default();
            http.push(response);
            assert_eq!(
                WorkspaceClient::new(&store, &http, RELAY).unwrap().load(),
                Err(expected)
            );
        }

        let no_session = MemoryCredentialStore::default();
        let http = MockHttp::default();
        assert_eq!(
            WorkspaceClient::new(&no_session, &http, RELAY)
                .unwrap()
                .load(),
            Err(CliError::RelayAuthenticationRequired)
        );
        assert!(http.requests.borrow().is_empty());
    }

    #[test]
    fn stored_session_failures_remain_distinct_and_secret_free() {
        let missing = MemoryCredentialStore::default();
        assert_eq!(
            TungsteniteConnector::from_store(&missing, RELAY)
                .err()
                .unwrap(),
            RelayTransportError::AuthenticationRequired
        );

        let corrupt = MemoryCredentialStore::default();
        corrupt
            .values
            .borrow_mut()
            .insert(RELAY_SESSION_ACCOUNT.to_owned(), "{corrupt".to_owned());
        assert_eq!(
            TungsteniteConnector::from_store(&corrupt, RELAY)
                .err()
                .unwrap(),
            RelayTransportError::InvalidStoredSession
        );
        assert_eq!(
            WorkspaceClient::new(&corrupt, &MockHttp::default(), RELAY)
                .unwrap()
                .load(),
            Err(CliError::InvalidStoredCredential)
        );

        let cross_origin = authenticated_store("https://other.example.com");
        assert_eq!(
            TungsteniteConnector::from_store(&cross_origin, RELAY)
                .err()
                .unwrap(),
            RelayTransportError::OriginMismatch
        );
        assert_eq!(
            WorkspaceClient::new(&cross_origin, &MockHttp::default(), RELAY)
                .unwrap()
                .load(),
            Err(CliError::RelayOriginMismatch)
        );

        let unavailable = MemoryCredentialStore::default();
        *unavailable.fail_reads.borrow_mut() = true;
        assert_eq!(
            TungsteniteConnector::from_store(&unavailable, RELAY)
                .err()
                .unwrap(),
            RelayTransportError::CredentialStoreUnavailable
        );

        for error in [
            RelayTransportError::AuthenticationRequired,
            RelayTransportError::InvalidStoredSession,
            RelayTransportError::OriginMismatch,
            RelayTransportError::CredentialStoreUnavailable,
            RelayTransportError::ConnectionFailed,
        ] {
            assert!(!format!("{error:?} {error}").contains(SESSION));
        }
    }

    #[test]
    fn workspace_order_is_preserved_and_inconsistent_relationships_fail_closed() {
        let store = authenticated_store(RELAY);
        let ordered = json!({
            "teams": [
                { "id": "team-2", "name": "Second", "members": 2 },
                { "id": "team-1", "name": "First", "members": 1 }
            ],
            "rooms": [
                {
                    "id": "room-2", "teamId": "team-2", "name": "Second room", "host": "Maddie",
                    "hostStatus": "offline", "approvalPolicy": "ask_every_turn"
                },
                {
                    "id": "room-1", "teamId": "team-1", "name": "First room", "host": "Maddie",
                    "hostStatus": "offline", "approvalPolicy": "never_host"
                }
            ]
        });
        let http = MockHttp::default();
        http.push(response(&format!("{RELAY}/teams"), 200, ordered));
        let snapshot = WorkspaceClient::new(&store, &http, RELAY)
            .unwrap()
            .load()
            .unwrap();
        assert_eq!(
            snapshot
                .teams
                .iter()
                .map(|team| team.id.as_str())
                .collect::<Vec<_>>(),
            ["team-2", "team-1"]
        );
        assert_eq!(
            snapshot
                .rooms
                .iter()
                .map(|room| room.id.as_str())
                .collect::<Vec<_>>(),
            ["room-2", "room-1"]
        );

        for invalid in [
            json!({
                "teams": [
                    { "id": "team-1", "name": "One", "members": 1 },
                    { "id": "team-1", "name": "Duplicate", "members": 1 }
                ],
                "rooms": []
            }),
            json!({
                "teams": [{ "id": "team-1", "name": "One", "members": 1 }],
                "rooms": [{
                    "id": "room-1", "teamId": "team-missing", "name": "Orphan", "host": "Maddie",
                    "hostStatus": "offline", "approvalPolicy": "ask_every_turn"
                }]
            }),
            json!({
                "teams": [{ "id": "team-1", "name": "One", "members": 1 }],
                "rooms": [
                    {
                        "id": "room-1", "teamId": "team-1", "name": "One", "host": "Maddie",
                        "hostStatus": "offline", "approvalPolicy": "ask_every_turn"
                    },
                    {
                        "id": "room-1", "teamId": "team-1", "name": "Duplicate", "host": "Maddie",
                        "hostStatus": "offline", "approvalPolicy": "ask_every_turn"
                    }
                ]
            }),
        ] {
            let http = MockHttp::default();
            http.push(response(&format!("{RELAY}/teams"), 200, invalid));
            assert_eq!(
                WorkspaceClient::new(&store, &http, RELAY).unwrap().load(),
                Err(CliError::InvalidRelayResponse)
            );
        }

        let http = MockHttp::default();
        http.push(HttpResponse {
            status: 200,
            final_url: format!("{RELAY}/teams"),
            headers: Default::default(),
            body: vec![b'x'; MAX_HTTP_RESPONSE_BYTES + 1],
        });
        assert_eq!(
            WorkspaceClient::new(&store, &http, RELAY).unwrap().load(),
            Err(CliError::InvalidRelayResponse)
        );
    }

    #[test]
    fn websocket_session_subprotocol_is_exact_and_bound_to_derived_origin() {
        let store = authenticated_store("https://relay.example.com:8443");
        let connector =
            TungsteniteConnector::from_store(&store, "https://relay.example.com:8443").unwrap();
        assert_eq!(
            connector.websocket_url,
            "wss://relay.example.com:8443/rooms"
        );
        assert_eq!(
            connector.protocol_header().unwrap().to_str().unwrap(),
            format!("multaiplayer-v1, multaiplayer-session.{SESSION}")
        );
        let header = connector.protocol_header().unwrap();
        let protocols = header.to_str().unwrap().split(", ").collect::<Vec<_>>();
        assert_eq!(protocols[0], WEBSOCKET_PROTOCOL);
        assert_eq!(protocols[1], format!("{WEBSOCKET_SESSION_PREFIX}{SESSION}"));
        assert_eq!(
            TungsteniteConnector::from_store(&store, RELAY)
                .err()
                .unwrap(),
            RelayTransportError::OriginMismatch
        );
        assert_eq!(
            websocket_config().max_message_size,
            Some(MAX_SERVER_MESSAGE_BYTES)
        );
        assert_eq!(
            websocket_config().max_frame_size,
            Some(MAX_SERVER_MESSAGE_BYTES)
        );
        assert_eq!(MAX_WEBSOCKET_REDIRECTS, 0);
        assert_eq!(
            require_selected_protocol(Some(&HeaderValue::from_static(WEBSOCKET_PROTOCOL))),
            Ok(())
        );
        assert_eq!(
            require_selected_protocol(None),
            Err(RelayTransportError::ConnectionFailed)
        );
        assert_eq!(
            require_selected_protocol(Some(&HeaderValue::from_static("future-protocol"))),
            Err(RelayTransportError::ConnectionFailed)
        );
    }

    fn direct_connector(url: String) -> TungsteniteConnector {
        TungsteniteConnector {
            websocket_url: url,
            session: Zeroizing::new(SESSION.to_owned()),
        }
    }

    #[test]
    fn websocket_redirects_are_rejected_without_exposing_the_session() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request).unwrap();
            stream
                .write_all(
                    b"HTTP/1.1 302 Found\r\nLocation: ws://127.0.0.1:9/rooms\r\nContent-Length: 0\r\n\r\n",
                )
                .unwrap();
        });
        let mut connector = direct_connector(format!("ws://{address}/rooms"));
        let error = connector.connect().err().unwrap();
        server.join().unwrap();
        assert_eq!(error, RelayTransportError::ConnectionFailed);
        assert!(!format!("{error:?} {error}").contains(SESSION));
    }

    #[test]
    fn websocket_missing_response_subprotocol_is_rejected() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let _socket = tungstenite::accept(stream).unwrap();
        });
        let mut connector = direct_connector(format!("ws://{address}/rooms"));
        assert_eq!(
            connector.connect().err().unwrap(),
            RelayTransportError::ConnectionFailed
        );
        server.join().unwrap();
    }

    #[test]
    fn fragmented_aggregate_server_messages_obey_the_message_bound() {
        use tungstenite::protocol::frame::{
            coding::{Data, OpCode},
            Frame,
        };

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut socket = tungstenite::accept_hdr(
                stream,
                |_request: &tungstenite::handshake::server::Request,
                 mut response: tungstenite::handshake::server::Response| {
                    response.headers_mut().insert(
                        SEC_WEBSOCKET_PROTOCOL,
                        HeaderValue::from_static(WEBSOCKET_PROTOCOL),
                    );
                    Ok(response)
                },
            )
            .unwrap();
            socket
                .send(Message::Frame(Frame::message(
                    vec![b'x'; 5_100_000],
                    OpCode::Data(Data::Text),
                    false,
                )))
                .unwrap();
            socket
                .send(Message::Frame(Frame::message(
                    vec![b'x'; 5_100_000],
                    OpCode::Data(Data::Continue),
                    true,
                )))
                .unwrap();
        });
        let mut connector = direct_connector(format!("ws://{address}/rooms"));
        let socket = connector.connect().unwrap();
        let mut connection = RelayConnection::new(socket);
        assert_eq!(
            connection.receive_one(Duration::from_secs(2), &mut |_| Ok(())),
            Err(RelayTransportError::InvalidServerMessage)
        );
        server.join().unwrap();
    }

    #[test]
    fn ping_traffic_does_not_extend_the_overall_receive_deadline() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut socket = tungstenite::accept_hdr(
                stream,
                |_request: &tungstenite::handshake::server::Request,
                 mut response: tungstenite::handshake::server::Response| {
                    response.headers_mut().insert(
                        SEC_WEBSOCKET_PROTOCOL,
                        HeaderValue::from_static(WEBSOCKET_PROTOCOL),
                    );
                    Ok(response)
                },
            )
            .unwrap();
            for _ in 0..20 {
                if socket.send(Message::Ping(Vec::new().into())).is_err() {
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
        });
        let mut connector = direct_connector(format!("ws://{address}/rooms"));
        let mut socket = connector.connect().unwrap();
        let started = Instant::now();
        assert!(matches!(
            socket.receive(Duration::from_millis(30)),
            Err(RelayTransportError::ReceiveTimeout)
        ));
        assert!(started.elapsed() < Duration::from_millis(150));
        drop(socket);
        server.join().unwrap();
    }

    #[derive(Default)]
    struct MockSocket {
        sent: Vec<String>,
        events: VecDeque<Result<SocketEvent, RelayTransportError>>,
        closed: Vec<(u16, String)>,
        send_failures: usize,
    }

    impl MockSocket {
        fn with_texts(values: impl IntoIterator<Item = &'static str>) -> Self {
            Self {
                events: values
                    .into_iter()
                    .map(|value| Ok(SocketEvent::Text(value.to_owned())))
                    .collect(),
                ..Self::default()
            }
        }
    }

    impl RelaySocket for MockSocket {
        fn send_text(&mut self, text: &str) -> Result<(), RelayTransportError> {
            if self.send_failures > 0 {
                self.send_failures -= 1;
                return Err(RelayTransportError::ConnectionClosed);
            }
            self.sent.push(text.to_owned());
            Ok(())
        }

        fn receive(&mut self, _timeout: Duration) -> Result<SocketEvent, RelayTransportError> {
            self.events
                .pop_front()
                .unwrap_or(Err(RelayTransportError::ReceiveTimeout))
        }

        fn close(&mut self, code: u16, reason: &str) {
            self.closed.push((code, reason.to_owned()));
        }
    }

    fn publish_message() -> RelayClientMessage {
        from_json(
            r#"{"type":"publish","message":{"id":"message-1","teamId":"team-1","roomId":"room-1","senderDeviceId":"device-1","senderUserId":"user-1","createdAt":"2026-07-18T12:34:56.000Z","messageType":"application","epochHint":7,"mlsMessage":"AA=="}}"#,
        )
        .unwrap()
    }

    fn join_message() -> RelayClientMessage {
        from_json(
            r#"{"type":"join","teamId":"team-1","roomId":"room-1","userId":"user-1","deviceId":"device-1","deviceSessionToken":"ssssssssssssssssssssssssssssssss"}"#,
        )
        .unwrap()
    }

    #[test]
    fn publish_ack_is_exact_correlated_and_rejections_are_deterministic() {
        let socket = MockSocket::with_texts([
            r#"{"type":"published","messageId":"message-other"}"#,
            r#"{"type":"published","messageId":"message-1"}"#,
        ]);
        let mut connection = RelayConnection::new(socket);
        let mut handled = Vec::new();
        connection
            .publish_and_wait_for_ack(&publish_message(), Duration::from_secs(1), &mut |message| {
                handled.push(message.clone());
                Ok(())
            })
            .unwrap();
        assert_eq!(handled.len(), 2);
        let socket = connection.into_inner();
        assert_eq!(socket.sent.len(), 1);

        let socket = MockSocket::with_texts([
            r#"{"type":"error","message":"stale","code":"stale_epoch","messageId":"message-1"}"#,
        ]);
        let mut connection = RelayConnection::new(socket);
        assert_eq!(
            connection.publish_and_wait_for_ack(
                &publish_message(),
                Duration::from_secs(1),
                &mut |_| Ok(())
            ),
            Err(RelayTransportError::AckRejected(Some(
                RelayErrorCode::StaleEpoch
            )))
        );
    }

    #[test]
    fn join_ack_waits_for_prior_messages_and_exact_room_correlation() {
        let socket = MockSocket::with_texts([
            r#"{"type":"joined","teamId":"team-other","roomId":"room-other"}"#,
            r#"{"type":"mls.message","message":{"id":"message-1","teamId":"team-1","roomId":"room-1","senderDeviceId":"device-1","senderUserId":"user-1","createdAt":"2026-07-18T12:34:56.000Z","messageType":"application","epochHint":7,"mlsMessage":"AA=="}}"#,
            r#"{"type":"joined","teamId":"team-1","roomId":"room-1"}"#,
        ]);
        let mut connection = RelayConnection::new(socket);
        let mut order = Vec::new();
        connection
            .join_and_wait_for_ack(&join_message(), Duration::from_secs(1), &mut |message| {
                order.push(match message {
                    RelayServerMessage::Joined { .. } => "joined",
                    RelayServerMessage::MlsMessage { .. } => "mls",
                    _ => "other",
                });
                Ok(())
            })
            .unwrap();
        assert_eq!(order, ["joined", "mls", "joined"]);
    }

    #[test]
    fn ack_timeouts_and_unscoped_errors_map_without_server_prose() {
        let mut timed_out = RelayConnection::new(MockSocket::default());
        assert_eq!(
            timed_out.publish_and_wait_for_ack(
                &publish_message(),
                Duration::from_millis(1),
                &mut |_| Ok(())
            ),
            Err(RelayTransportError::AckTimeout(AckOperation::Publish))
        );

        let socket =
            MockSocket::with_texts([r#"{"type":"error","message":"attacker-controlled prose"}"#]);
        let mut rejected = RelayConnection::new(socket);
        let error = rejected
            .join_and_wait_for_ack(&join_message(), Duration::from_secs(1), &mut |_| Ok(()))
            .unwrap_err();
        assert_eq!(error, RelayTransportError::AckRejected(None));
        assert!(!format!("{error:?} {error}").contains("attacker-controlled"));
    }

    #[test]
    fn send_failure_and_timeout_cleanup_allow_a_later_retry() {
        let mut socket = MockSocket {
            send_failures: 1,
            ..MockSocket::default()
        };
        socket.events.push_back(Ok(SocketEvent::Text(
            r#"{"type":"published","messageId":"message-1"}"#.to_owned(),
        )));
        let mut connection = RelayConnection::new(socket);
        assert_eq!(
            connection.publish_and_wait_for_ack(
                &publish_message(),
                Duration::from_secs(1),
                &mut |_| Ok(())
            ),
            Err(RelayTransportError::ConnectionClosed)
        );
        connection
            .publish_and_wait_for_ack(&publish_message(), Duration::from_secs(1), &mut |_| Ok(()))
            .unwrap();

        let mut timed_out = RelayConnection::new(MockSocket::default());
        assert_eq!(
            timed_out.join_and_wait_for_ack(
                &join_message(),
                Duration::from_millis(1),
                &mut |_| Ok(())
            ),
            Err(RelayTransportError::AckTimeout(AckOperation::Join))
        );
        timed_out.socket.events.push_back(Ok(SocketEvent::Text(
            r#"{"type":"joined","teamId":"team-1","roomId":"room-1"}"#.to_owned(),
        )));
        timed_out
            .join_and_wait_for_ack(&join_message(), Duration::from_secs(1), &mut |_| Ok(()))
            .unwrap();
    }

    #[test]
    fn unrelated_correlated_errors_and_events_do_not_complete_the_operation() {
        let socket = MockSocket::with_texts([
            r#"{"type":"error","message":"other","code":"stale_epoch","messageId":"message-other"}"#,
            r#"{"type":"workspace.subscribed"}"#,
            r#"{"type":"published","messageId":"message-1"}"#,
        ]);
        let mut connection = RelayConnection::new(socket);
        let mut handled = Vec::new();
        connection
            .publish_and_wait_for_ack(&publish_message(), Duration::from_secs(1), &mut |message| {
                handled.push(message.clone());
                Ok(())
            })
            .unwrap();
        assert_eq!(handled.len(), 3);
    }

    #[test]
    fn handler_failure_or_delay_never_reorders_later_messages() {
        let socket = MockSocket::with_texts([
            r#"{"type":"workspace.subscribed"}"#,
            r#"{"type":"team.subscribed","teamId":"team-1"}"#,
            r#"{"type":"joined","teamId":"team-1","roomId":"room-1"}"#,
        ]);
        let mut connection = RelayConnection::new(socket);
        assert_eq!(
            connection.receive_one(Duration::from_secs(1), &mut |_| {
                Err(RelayTransportError::ConnectionFailed)
            }),
            Err(RelayTransportError::ConnectionFailed)
        );
        let mut order = Vec::new();
        connection
            .receive_one(Duration::from_secs(1), &mut |message| {
                thread::sleep(Duration::from_millis(5));
                order.push(match message {
                    RelayServerMessage::TeamSubscribed { .. } => "team",
                    _ => "other",
                });
                Ok(())
            })
            .unwrap();
        connection
            .receive_one(Duration::from_secs(1), &mut |message| {
                order.push(match message {
                    RelayServerMessage::Joined { .. } => "room",
                    _ => "other",
                });
                Ok(())
            })
            .unwrap();
        assert_eq!(order, ["team", "room"]);
    }

    #[test]
    fn server_messages_are_applied_serially_in_wire_order() {
        let socket = MockSocket::with_texts([
            r#"{"type":"workspace.subscribed"}"#,
            r#"{"type":"team.subscribed","teamId":"team-1"}"#,
            r#"{"type":"joined","teamId":"team-1","roomId":"room-1"}"#,
        ]);
        let mut connection = RelayConnection::new(socket);
        let mut order = Vec::new();
        for _ in 0..3 {
            connection
                .receive_one(Duration::from_secs(1), &mut |message| {
                    order.push(match message {
                        RelayServerMessage::WorkspaceSubscribed => "workspace",
                        RelayServerMessage::TeamSubscribed { .. } => "team",
                        RelayServerMessage::Joined { .. } => "room",
                        _ => "other",
                    });
                    Ok(())
                })
                .unwrap();
        }
        assert_eq!(order, ["workspace", "team", "room"]);
    }

    #[test]
    fn malformed_unknown_binary_and_oversized_server_data_close_safely() {
        let invalid_events = [
            SocketEvent::Text("{not-json".to_owned()),
            SocketEvent::Text(r#"{"type":"future.record"}"#.to_owned()),
            SocketEvent::Binary,
            SocketEvent::Invalid,
            SocketEvent::Text("x".repeat(MAX_SERVER_MESSAGE_BYTES + 1)),
        ];
        for event in invalid_events {
            let mut socket = MockSocket::default();
            socket.events.push_back(Ok(event));
            let mut connection = RelayConnection::new(socket);
            assert_eq!(
                connection.receive_one(Duration::from_secs(1), &mut |_| Ok(())),
                Err(RelayTransportError::InvalidServerMessage)
            );
            assert_eq!(
                connection.into_inner().closed,
                [(1002, "Invalid relay server message".to_owned())]
            );
        }
    }

    #[derive(Default)]
    struct MockConnector {
        failures_remaining: usize,
        attempts: usize,
    }

    impl RelayConnector for MockConnector {
        type Socket = MockSocket;

        fn connect(&mut self) -> Result<Self::Socket, RelayTransportError> {
            self.attempts += 1;
            if self.failures_remaining > 0 {
                self.failures_remaining -= 1;
                Err(RelayTransportError::ConnectionFailed)
            } else {
                Ok(MockSocket::default())
            }
        }
    }

    #[derive(Default)]
    struct RecordingSleeper(Vec<Duration>);

    impl RetrySleeper for RecordingSleeper {
        fn sleep(&mut self, delay: Duration) {
            self.0.push(delay);
        }
    }

    #[derive(Default)]
    struct TerminalConnector {
        attempts: usize,
    }

    impl RelayConnector for TerminalConnector {
        type Socket = MockSocket;

        fn connect(&mut self) -> Result<Self::Socket, RelayTransportError> {
            self.attempts += 1;
            Err(RelayTransportError::OriginMismatch)
        }
    }

    #[test]
    fn reconnect_backoff_is_bounded_and_exhaustion_is_deterministic() {
        let policy = ReconnectPolicy {
            max_reconnects: 3,
            initial_delay: Duration::from_millis(500),
            max_delay: Duration::from_secs(10),
        };
        let mut connector = MockConnector {
            failures_remaining: 2,
            ..MockConnector::default()
        };
        let mut sleeper = RecordingSleeper::default();
        connect_with_retries(&mut connector, policy, &mut sleeper).unwrap();
        assert_eq!(connector.attempts, 3);
        assert_eq!(
            sleeper.0,
            [Duration::from_millis(500), Duration::from_secs(1)]
        );

        let mut exhausted = MockConnector {
            failures_remaining: 10,
            ..MockConnector::default()
        };
        let mut sleeper = RecordingSleeper::default();
        assert!(matches!(
            connect_with_retries(&mut exhausted, policy, &mut sleeper),
            Err(RelayTransportError::ReconnectExhausted)
        ));
        assert_eq!(exhausted.attempts, 4);
        assert_eq!(
            sleeper.0,
            [
                Duration::from_millis(500),
                Duration::from_secs(1),
                Duration::from_secs(2)
            ]
        );

        let mut terminal = TerminalConnector::default();
        let mut sleeper = RecordingSleeper::default();
        assert!(matches!(
            connect_with_retries(&mut terminal, policy, &mut sleeper),
            Err(RelayTransportError::OriginMismatch)
        ));
        assert_eq!(terminal.attempts, 1);
        assert!(sleeper.0.is_empty());
    }
}
