use crate::{
    auth::{endpoint, load_relay_transport_session, RestoredSession},
    chat::safe_untrusted_text,
    identity::DeviceIdentity,
    mls::{MlsClientError, MlsClientService},
    platform::{CredentialStore, HttpClient},
    relay::{
        connect_with_retries, ReconnectPolicy, RelayConnection, RelayTransportError, ThreadSleeper,
        TungsteniteConnector, WorkspaceClient, WorkspaceSnapshot, MAX_HTTP_RESPONSE_BYTES,
    },
    CliError,
};
use base64::{engine::general_purpose::STANDARD, Engine};
pub use multaiplayer_protocol::HostStatus;
use multaiplayer_protocol::{ApprovalPolicy, RelayClientMessage, RoomRecord, Validate};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    fmt, fs,
    path::{Path, PathBuf},
    time::Duration,
};
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

#[cfg(test)]
use crate::relay::decode_workspace_response;

pub const ROOM_STATE_ACCOUNT: &str = "room-associations:v1";
const NATIVE_SESSION_HEADER: &str = "x-multaiplayer-session";
const DEVICE_SESSION_HEADER: &str = "x-device-session";
const ROOM_OPERATION_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_LOCAL_ROOM_ASSOCIATIONS: usize = 500;

#[derive(Debug, Error, Eq, PartialEq)]
pub enum RoomError {
    #[error("Sign in with GitHub before using rooms.")]
    AuthenticationRequired,
    #[error("The selected team or room is unavailable or ambiguous.")]
    SelectionUnavailable,
    #[error("The room name is invalid.")]
    InvalidName,
    #[error("The local project must be an existing canonical directory.")]
    InvalidProject,
    #[error("The local room association is unavailable or belongs to another device.")]
    LocalStateUnavailable,
    #[error("Room creation could not be completed safely; retry the same command.")]
    CreationPending,
    #[error("The room requires an explicit rejoin or recovery.")]
    RequiresRejoin,
    #[error("Host handoff is not supported by this CLI version.")]
    HostHandoffUnsupported,
    #[error("The relay room operation failed.")]
    RelayUnavailable,
}

#[derive(Clone, Eq, PartialEq)]
pub struct CreateRoomRequest {
    pub team: Option<String>,
    pub name: String,
    pub project: String,
}

impl fmt::Debug for CreateRoomRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CreateRoomRequest")
            .field("team", &self.team)
            .field("name", &self.name)
            .field("project", &"[local project]")
            .finish()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OpenedRoom {
    pub room: RoomRecord,
    pub is_active_host: bool,
}

pub fn opened_room_message(opened: &OpenedRoom) -> String {
    format!(
        "Opened {} ({}). Local project association retained on this device.",
        safe_terminal_text(&opened.room.name),
        opened.room.id
    )
}

pub trait RoomBackend {
    fn workspace(&mut self) -> Result<WorkspaceSnapshot, RoomError>;
    fn create_room(&mut self, team_id: &str, name: &str) -> Result<RoomRecord, RoomError>;
    fn establish_device_session(&mut self) -> Result<Zeroizing<String>, RoomError>;
    fn join_room(&mut self, room: &RoomRecord, device_session: &str) -> Result<(), RoomError>;
    fn activate_host(
        &mut self,
        room: &RoomRecord,
        device_session: &str,
    ) -> Result<RoomRecord, RoomError>;
}

pub trait RoomMls {
    fn create_group_idempotent(&mut self, room_id: &str) -> Result<u64, RoomError>;
    fn open_group(&mut self, room_id: &str) -> Result<u64, RoomError>;
    fn forget_room_local_state(&mut self, room_id: &str) -> Result<(), RoomError>;
}

impl RoomMls for MlsClientService {
    fn create_group_idempotent(&mut self, room_id: &str) -> Result<u64, RoomError> {
        MlsClientService::create_group_idempotent(self, room_id).map_err(map_mls_error)
    }

    fn open_group(&mut self, room_id: &str) -> Result<u64, RoomError> {
        MlsClientService::open_group(self, room_id).map_err(map_mls_error)
    }

    fn forget_room_local_state(&mut self, room_id: &str) -> Result<(), RoomError> {
        MlsClientService::forget_room_local_state(self, room_id).map_err(map_mls_error)
    }
}

pub struct RelayRoomBackend<'a, S, H> {
    store: &'a S,
    http: &'a H,
    relay_origin: String,
    session: &'a RestoredSession,
    identity: &'a DeviceIdentity,
    #[cfg(test)]
    loopback_session: Option<Zeroizing<String>>,
    #[cfg(test)]
    loopback_websocket_url: Option<String>,
}

impl<'a, S: CredentialStore, H: HttpClient> RelayRoomBackend<'a, S, H> {
    pub fn new(
        store: &'a S,
        http: &'a H,
        relay_origin: &str,
        session: &'a RestoredSession,
        identity: &'a DeviceIdentity,
    ) -> Result<Self, RoomError> {
        WorkspaceClient::new(store, http, relay_origin).map_err(map_cli_error)?;
        Ok(Self {
            store,
            http,
            relay_origin: relay_origin.to_owned(),
            session,
            identity,
            #[cfg(test)]
            loopback_session: None,
            #[cfg(test)]
            loopback_websocket_url: None,
        })
    }

    pub fn establish_device_session_for_invites(&mut self) -> Result<Zeroizing<String>, RoomError> {
        <Self as RoomBackend>::establish_device_session(self)
    }

    #[cfg(test)]
    pub(crate) fn new_for_loopback_test(
        store: &'a S,
        http: &'a H,
        relay_origin: &str,
        websocket_url: &str,
        relay_session: &str,
        session: &'a RestoredSession,
        identity: &'a DeviceIdentity,
    ) -> Result<Self, RoomError> {
        let parsed = reqwest::Url::parse(relay_origin).map_err(|_| RoomError::RelayUnavailable)?;
        let loopback = matches!(parsed.host_str(), Some("127.0.0.1") | Some("::1"));
        if parsed.scheme() != "http"
            || !loopback
            || parsed.port().is_none()
            || parsed.path() != "/"
            || parsed.username() != ""
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || relay_session.is_empty()
        {
            return Err(RoomError::RelayUnavailable);
        }
        TungsteniteConnector::from_loopback_test_url(websocket_url, relay_session)
            .map_err(map_relay)?;
        Ok(Self {
            store,
            http,
            relay_origin: parsed.origin().ascii_serialization(),
            session,
            identity,
            loopback_session: Some(Zeroizing::new(relay_session.to_owned())),
            loopback_websocket_url: Some(websocket_url.to_owned()),
        })
    }

    fn headers(&self) -> Result<Zeroizing<String>, RoomError> {
        #[cfg(test)]
        if let Some(session) = &self.loopback_session {
            return Ok(session.clone());
        }
        load_relay_transport_session(self.store, &self.relay_origin)
            .map_err(map_cli_error)?
            .map(|session| session.secret)
            .ok_or(RoomError::AuthenticationRequired)
    }

    fn decode_room_response(
        &self,
        response: crate::platform::HttpResponse,
        expected_url: &str,
        expected_status: &[u16],
    ) -> Result<RoomRecord, RoomError> {
        if response.final_url != expected_url || !expected_status.contains(&response.status) {
            return Err(if response.status == 401 {
                RoomError::AuthenticationRequired
            } else {
                RoomError::RelayUnavailable
            });
        }
        if response.body.len() > MAX_HTTP_RESPONSE_BYTES {
            return Err(RoomError::RelayUnavailable);
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Response {
            room: RoomRecord,
        }
        let body: Response =
            serde_json::from_slice(&response.body).map_err(|_| RoomError::RelayUnavailable)?;
        body.room
            .validate()
            .map_err(|_| RoomError::RelayUnavailable)?;
        Ok(body.room)
    }
}

impl<S: CredentialStore, H: HttpClient> RoomBackend for RelayRoomBackend<'_, S, H> {
    fn workspace(&mut self) -> Result<WorkspaceSnapshot, RoomError> {
        #[cfg(test)]
        if self.loopback_session.is_some() {
            let url = endpoint(&self.relay_origin, "/teams").map_err(map_cli_error)?;
            let session = self.headers()?;
            let response = self
                .http
                .get(&url, &[(NATIVE_SESSION_HEADER, session.as_str())])
                .map_err(map_cli_error)?;
            return decode_workspace_response(response, &url).map_err(map_cli_error);
        }
        WorkspaceClient::new(self.store, self.http, &self.relay_origin)
            .and_then(|client| client.load())
            .map_err(map_cli_error)
    }

    fn create_room(&mut self, team_id: &str, name: &str) -> Result<RoomRecord, RoomError> {
        let url = endpoint(&self.relay_origin, "/rooms").map_err(map_cli_error)?;
        let session = self.headers()?;
        let response = self
            .http
            .post_json(
                &url,
                &[(NATIVE_SESSION_HEADER, session.as_str())],
                &json!({
                    "teamId": team_id,
                    "name": name,
                    "approvalPolicy": "ask_every_turn"
                }),
            )
            .map_err(map_cli_error)?;
        self.decode_room_response(response, &url, &[201])
    }

    fn establish_device_session(&mut self) -> Result<Zeroizing<String>, RoomError> {
        let session = self.headers()?;
        let device_id = &self.identity.public.device_id;
        let challenge_url = endpoint(
            &self.relay_origin,
            &format!("/devices/{device_id}/challenge"),
        )
        .map_err(map_cli_error)?;
        let response = self
            .http
            .post_json(
                &challenge_url,
                &[(NATIVE_SESSION_HEADER, session.as_str())],
                &json!({}),
            )
            .map_err(map_cli_error)?;
        if response.final_url != challenge_url
            || response.status != 200
            || response.body.len() > MAX_HTTP_RESPONSE_BYTES
        {
            return Err(RoomError::RelayUnavailable);
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct ChallengeResponse {
            challenge: String,
            expires_at: String,
        }
        let challenge: ChallengeResponse =
            serde_json::from_slice(&response.body).map_err(|_| RoomError::RelayUnavailable)?;
        if challenge.expires_at.is_empty() {
            return Err(RoomError::RelayUnavailable);
        }
        let challenge_bytes = STANDARD
            .decode(&challenge.challenge)
            .map_err(|_| RoomError::RelayUnavailable)?;
        let signature = self
            .identity
            .signer
            .sign(&challenge_bytes)
            .map_err(|_| RoomError::RelayUnavailable)?;
        let session_url = endpoint(&self.relay_origin, &format!("/devices/{device_id}/session"))
            .map_err(map_cli_error)?;
        let response = self
            .http
            .post_json(
                &session_url,
                &[(NATIVE_SESSION_HEADER, session.as_str())],
                &json!({
                    "challenge": challenge.challenge,
                    "signature": STANDARD.encode(signature.signature_der)
                }),
            )
            .map_err(map_cli_error)?;
        if response.final_url != session_url
            || response.status != 200
            || response.body.len() > MAX_HTTP_RESPONSE_BYTES
        {
            return Err(RoomError::RelayUnavailable);
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct SessionResponse {
            device_session_token: String,
            expires_at: String,
        }
        let body: SessionResponse =
            serde_json::from_slice(&response.body).map_err(|_| RoomError::RelayUnavailable)?;
        if body.device_session_token.is_empty()
            || body.device_session_token.len() > 512
            || body.expires_at.is_empty()
            || !body
                .device_session_token
                .chars()
                .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
        {
            return Err(RoomError::RelayUnavailable);
        }
        Ok(Zeroizing::new(body.device_session_token))
    }

    fn join_room(&mut self, room: &RoomRecord, device_session: &str) -> Result<(), RoomError> {
        #[cfg(test)]
        let mut connector = if let Some(websocket_url) = &self.loopback_websocket_url {
            let session = self.headers()?;
            TungsteniteConnector::from_loopback_test_url(websocket_url, session.as_str())
                .map_err(map_relay)?
        } else {
            TungsteniteConnector::from_store(self.store, &self.relay_origin).map_err(map_relay)?
        };
        #[cfg(not(test))]
        let mut connector =
            TungsteniteConnector::from_store(self.store, &self.relay_origin).map_err(map_relay)?;
        let socket = connect_with_retries(
            &mut connector,
            ReconnectPolicy::default(),
            &mut ThreadSleeper,
        )
        .map_err(map_relay)?;
        let mut connection = RelayConnection::new(socket);
        let message = RelayClientMessage::Join {
            team_id: room.team_id.clone(),
            room_id: room.id.clone(),
            user_id: self.session.user.id.clone(),
            device_id: self.identity.public.device_id.clone(),
            invite_id: None,
            device_session_token: Some(device_session.to_owned()),
        };
        connection
            .join_and_wait_for_ack(&message, ROOM_OPERATION_TIMEOUT, &mut |_| Ok(()))
            .map_err(map_relay)
    }

    fn activate_host(
        &mut self,
        room: &RoomRecord,
        device_session: &str,
    ) -> Result<RoomRecord, RoomError> {
        let url = endpoint(&self.relay_origin, &format!("/rooms/{}/host", room.id))
            .map_err(map_cli_error)?;
        let session = self.headers()?;
        let response = self
            .http
            .patch_json(
                &url,
                &[
                    (NATIVE_SESSION_HEADER, session.as_str()),
                    (DEVICE_SESSION_HEADER, device_session),
                ],
                &json!({
                    "host": room.host,
                    "hostUserId": self.session.user.id,
                    "hostDeviceId": self.identity.public.device_id,
                    "hostStatus": "active"
                }),
            )
            .map_err(map_cli_error)?;
        self.decode_room_response(response, &url, &[200])
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredRoomState {
    version: u8,
    user_id: String,
    device_id: String,
    relay_origin: String,
    associations: Vec<StoredAssociation>,
}

impl Zeroize for StoredRoomState {
    fn zeroize(&mut self) {
        for association in &mut self.associations {
            association.project_path.zeroize();
        }
    }
}

impl ZeroizeOnDrop for StoredRoomState {}

impl Drop for StoredRoomState {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredAssociation {
    team_id: String,
    room_id: Option<String>,
    room_name: String,
    #[serde(default)]
    project_path: Option<String>,
    complete: bool,
    #[serde(default)]
    left: bool,
    #[serde(default)]
    forget_pending: bool,
}

pub struct RoomService<'a, S, B, M> {
    store: &'a S,
    backend: &'a mut B,
    mls: &'a mut M,
    user_id: &'a str,
    device_id: &'a str,
    relay_origin: &'a str,
}

impl<'a, S: CredentialStore, B: RoomBackend, M: RoomMls> RoomService<'a, S, B, M> {
    pub fn new(
        store: &'a S,
        backend: &'a mut B,
        mls: &'a mut M,
        user_id: &'a str,
        device_id: &'a str,
        relay_origin: &'a str,
    ) -> Self {
        Self {
            store,
            backend,
            mls,
            user_id,
            device_id,
            relay_origin,
        }
    }

    pub fn list(&mut self) -> Result<Vec<RoomRecord>, RoomError> {
        Ok(self
            .backend
            .workspace()?
            .rooms
            .into_iter()
            .filter(|room| room.deleted_at.is_none())
            .collect())
    }

    pub fn create(&mut self, request: &CreateRoomRequest) -> Result<OpenedRoom, RoomError> {
        validate_room_name(&request.name)?;
        let project_path = canonical_project(&request.project)?;
        let workspace = self.backend.workspace()?;
        let team_id = select_team(&workspace, request.team.as_deref())?;
        let mut state = self.load_state()?;
        let existing_index = state.associations.iter().position(|association| {
            association.team_id == team_id
                && association.room_name == request.name
                && association.project_path.as_deref() == Some(project_path.as_str())
        });
        let index = match existing_index {
            Some(index) => {
                if state.associations[index].forget_pending {
                    return Err(RoomError::LocalStateUnavailable);
                }
                if state.associations[index].left {
                    state.associations[index].left = false;
                    self.save_state(&state)?;
                }
                index
            }
            None => {
                if state.associations.len() >= MAX_LOCAL_ROOM_ASSOCIATIONS {
                    return Err(RoomError::LocalStateUnavailable);
                }
                state.associations.push(StoredAssociation {
                    team_id: team_id.clone(),
                    room_id: None,
                    room_name: request.name.clone(),
                    project_path: Some(project_path),
                    complete: false,
                    left: false,
                    forget_pending: false,
                });
                self.save_state(&state)?;
                state.associations.len() - 1
            }
        };

        let mut room = if let Some(room_id) = state.associations[index].room_id.as_deref() {
            workspace
                .rooms
                .iter()
                .find(|room| room.id == room_id)
                .cloned()
                .ok_or(RoomError::CreationPending)?
        } else {
            let created = if existing_index.is_none() {
                self.backend.create_room(&team_id, &request.name)?
            } else {
                let candidates: Vec<_> = workspace
                    .rooms
                    .iter()
                    .filter(|room| {
                        room.team_id == team_id
                            && room.name == request.name
                            && room.host_user_id.as_deref() == Some(self.user_id)
                            && room.host_status == HostStatus::Offline
                            && room.accepted_mls_epoch.is_none()
                            && room.active_host_device_id.is_none()
                    })
                    .cloned()
                    .collect();
                match candidates.as_slice() {
                    [] => self.backend.create_room(&team_id, &request.name)?,
                    [room] => room.clone(),
                    _ => return Err(RoomError::CreationPending),
                }
            };
            validate_created_room(&created, &team_id, &request.name, self.user_id)?;
            state.associations[index].room_id = Some(created.id.clone());
            self.save_state(&state)?;
            created
        };

        canonical_stored_project(
            state.associations[index]
                .project_path
                .as_deref()
                .ok_or(RoomError::InvalidProject)?,
        )?;
        self.mls.create_group_idempotent(&room.id)?;
        if room.host_status == HostStatus::Active {
            if room.host_user_id.as_deref() != Some(self.user_id)
                || room.active_host_device_id.as_deref() != Some(self.device_id)
                || room.accepted_mls_epoch != Some(0)
            {
                return Err(RoomError::HostHandoffUnsupported);
            }
        } else {
            let device_session = self.backend.establish_device_session()?;
            self.backend.join_room(&room, device_session.as_str())?;
            match self.backend.activate_host(&room, device_session.as_str()) {
                Ok(updated) => room = updated,
                Err(RoomError::RelayUnavailable) => {
                    room = self
                        .backend
                        .workspace()?
                        .rooms
                        .into_iter()
                        .find(|candidate| candidate.id == room.id)
                        .filter(|candidate| {
                            candidate.host_status == HostStatus::Active
                                && candidate.host_user_id.as_deref() == Some(self.user_id)
                                && candidate.active_host_device_id.as_deref()
                                    == Some(self.device_id)
                                && candidate.accepted_mls_epoch == Some(0)
                        })
                        .ok_or(RoomError::CreationPending)?;
                }
                Err(error) => return Err(error),
            }
        }
        validate_active_host(&room, self.user_id, self.device_id)?;
        canonical_stored_project(
            state.associations[index]
                .project_path
                .as_deref()
                .ok_or(RoomError::InvalidProject)?,
        )?;
        state.associations[index].complete = true;
        self.save_state(&state)?;
        Ok(OpenedRoom {
            room,
            is_active_host: true,
        })
    }

    pub fn open(&mut self, selector: &str) -> Result<OpenedRoom, RoomError> {
        let workspace = self.backend.workspace()?;
        let room = select_room(&workspace, selector)?;
        let state = self.load_state()?;
        let association = state
            .associations
            .iter()
            .find(|association| association.room_id.as_deref() == Some(room.id.as_str()))
            .ok_or(RoomError::SelectionUnavailable)?;
        if !association.complete || association.left || association.forget_pending {
            return Err(RoomError::CreationPending);
        }
        if let Some(project_path) = association.project_path.as_deref() {
            canonical_stored_project(project_path)?;
        }
        self.mls.open_group(&room.id)?;
        let is_active_host = room.host_status == HostStatus::Active
            && room.host_user_id.as_deref() == Some(self.user_id)
            && room.active_host_device_id.as_deref() == Some(self.device_id);
        let created_as_host = association.project_path.is_some();
        if room.host_status == HostStatus::Active {
            validate_cli_host_role(created_as_host, is_active_host)?;
        }
        Ok(OpenedRoom {
            is_active_host,
            room,
        })
    }

    pub fn local_project_path(&self, room_id: &str) -> Result<Option<PathBuf>, RoomError> {
        let state = self.load_state()?;
        let association = state
            .associations
            .iter()
            .find(|association| association.room_id.as_deref() == Some(room_id))
            .filter(|association| {
                association.complete && !association.left && !association.forget_pending
            })
            .ok_or(RoomError::LocalStateUnavailable)?;
        association
            .project_path
            .as_deref()
            .map(canonical_stored_project)
            .transpose()
            .map(|path| path.map(PathBuf::from))
    }

    pub fn leave(&mut self, selector: &str) -> Result<RoomRecord, RoomError> {
        let workspace = self.backend.workspace()?;
        let room = select_room(&workspace, selector)?;
        let mut state = self.load_state()?;
        let association = state
            .associations
            .iter_mut()
            .find(|association| association.room_id.as_deref() == Some(room.id.as_str()))
            .ok_or(RoomError::SelectionUnavailable)?;
        if !association.complete || association.forget_pending {
            return Err(RoomError::CreationPending);
        }
        association.left = true;
        self.save_state(&state)?;
        Ok(room)
    }

    pub fn forget(&mut self, selector: &str) -> Result<String, RoomError> {
        let mut state = self.load_state()?;
        let matches: Vec<_> = state
            .associations
            .iter()
            .enumerate()
            .filter(|(_, association)| {
                association.room_id.as_deref() == Some(selector)
                    || association.room_name == selector
            })
            .map(|(index, _)| index)
            .collect();
        let [index] = matches.as_slice() else {
            return Err(RoomError::SelectionUnavailable);
        };
        let room_id = state.associations[*index]
            .room_id
            .clone()
            .ok_or(RoomError::CreationPending)?;

        // Hide the association first. A crash or storage failure can leave an
        // encrypted orphan, but never a visible association whose local data
        // has been only partly removed. Retrying resumes the tombstoned delete.
        state.associations[*index].left = true;
        state.associations[*index].forget_pending = true;
        self.save_state(&state)?;
        self.mls.forget_room_local_state(&room_id)?;
        state.associations.remove(*index);
        self.save_state(&state)?;
        Ok(room_id)
    }

    fn load_state(&self) -> Result<StoredRoomState, RoomError> {
        load_stored_room_state(self.store, self.user_id, self.device_id, self.relay_origin)
    }

    fn save_state(&self, state: &StoredRoomState) -> Result<(), RoomError> {
        save_stored_room_state(self.store, state)
    }
}

fn validate_cli_host_role(created_as_host: bool, is_active_host: bool) -> Result<(), RoomError> {
    if created_as_host != is_active_host {
        return Err(RoomError::HostHandoffUnsupported);
    }
    Ok(())
}

/// Debug-only adapter for the required cross-client handoff rejection journey.
#[cfg(debug_assertions)]
#[doc(hidden)]
pub fn interoperability_validate_cli_host_role(
    created_as_host: bool,
    is_active_host: bool,
) -> Result<(), RoomError> {
    validate_cli_host_role(created_as_host, is_active_host)
}

pub fn record_joined_room_association(
    store: &impl CredentialStore,
    user_id: &str,
    device_id: &str,
    relay_origin: &str,
    room: &RoomRecord,
) -> Result<(), RoomError> {
    room.validate().map_err(|_| RoomError::RelayUnavailable)?;
    if room.deleted_at.is_some()
        || room.accepted_mls_epoch.is_none()
        || room.host_status != HostStatus::Active
        || room.host_user_id.as_deref() == Some(user_id)
    {
        return Err(RoomError::RelayUnavailable);
    }
    let mut state = load_stored_room_state(store, user_id, device_id, relay_origin)?;
    if let Some(existing) = state
        .associations
        .iter_mut()
        .find(|association| association.room_id.as_deref() == Some(room.id.as_str()))
    {
        if existing.project_path.is_some() || existing.forget_pending {
            return Err(RoomError::HostHandoffUnsupported);
        }
        existing.team_id = room.team_id.clone();
        existing.room_name = room.name.clone();
        existing.complete = true;
        existing.left = false;
        return save_stored_room_state(store, &state);
    }
    if state.associations.len() >= MAX_LOCAL_ROOM_ASSOCIATIONS {
        return Err(RoomError::LocalStateUnavailable);
    }
    state.associations.push(StoredAssociation {
        team_id: room.team_id.clone(),
        room_id: Some(room.id.clone()),
        room_name: room.name.clone(),
        project_path: None,
        complete: true,
        left: false,
        forget_pending: false,
    });
    save_stored_room_state(store, &state)
}

fn load_stored_room_state(
    store: &impl CredentialStore,
    user_id: &str,
    device_id: &str,
    relay_origin: &str,
) -> Result<StoredRoomState, RoomError> {
    let Some(encoded) = store
        .get(ROOM_STATE_ACCOUNT)
        .map_err(|_| RoomError::LocalStateUnavailable)?
    else {
        return Ok(StoredRoomState {
            version: 1,
            user_id: user_id.to_owned(),
            device_id: device_id.to_owned(),
            relay_origin: relay_origin.to_owned(),
            associations: Vec::new(),
        });
    };
    let encoded = Zeroizing::new(encoded);
    let state: StoredRoomState =
        serde_json::from_str(encoded.as_str()).map_err(|_| RoomError::LocalStateUnavailable)?;
    if state.version != 1
        || state.user_id != user_id
        || state.device_id != device_id
        || state.relay_origin != relay_origin
        || state.associations.len() > MAX_LOCAL_ROOM_ASSOCIATIONS
    {
        return Err(RoomError::LocalStateUnavailable);
    }
    Ok(state)
}

fn save_stored_room_state(
    store: &impl CredentialStore,
    state: &StoredRoomState,
) -> Result<(), RoomError> {
    let encoded =
        Zeroizing::new(serde_json::to_string(state).map_err(|_| RoomError::LocalStateUnavailable)?);
    store
        .set(ROOM_STATE_ACCOUNT, encoded.as_str())
        .map_err(|_| RoomError::LocalStateUnavailable)
}

fn validate_room_name(name: &str) -> Result<(), RoomError> {
    if name.is_empty() || name.encode_utf16().count() > 120 || name.chars().any(char::is_control) {
        Err(RoomError::InvalidName)
    } else {
        Ok(())
    }
}

fn safe_terminal_text(value: &str) -> String {
    safe_untrusted_text(value, 120)
}

fn canonical_project(project: &str) -> Result<String, RoomError> {
    if project.is_empty() || project.chars().count() > 4096 || project.chars().any(char::is_control)
    {
        return Err(RoomError::InvalidProject);
    }
    let canonical = fs::canonicalize(Path::new(project)).map_err(|_| RoomError::InvalidProject)?;
    canonical_stored_project(canonical.to_str().ok_or(RoomError::InvalidProject)?)
}

fn canonical_stored_project(project: &str) -> Result<String, RoomError> {
    let path = Path::new(project);
    if !path.is_absolute()
        || !path.is_dir()
        || project.chars().count() > 4096
        || project.chars().any(char::is_control)
    {
        return Err(RoomError::InvalidProject);
    }
    let canonical = fs::canonicalize(path).map_err(|_| RoomError::InvalidProject)?;
    let value = canonical.to_str().ok_or(RoomError::InvalidProject)?;
    if value != project {
        return Err(RoomError::InvalidProject);
    }
    Ok(value.to_owned())
}

fn select_team(workspace: &WorkspaceSnapshot, selector: Option<&str>) -> Result<String, RoomError> {
    let teams: Vec<_> = workspace
        .teams
        .iter()
        .filter(|team| team.archived_at.is_none() && team.deleted_at.is_none())
        .filter(|team| selector.is_none_or(|value| team.id == value || team.name == value))
        .collect();
    match teams.as_slice() {
        [team] => Ok(team.id.clone()),
        _ => Err(RoomError::SelectionUnavailable),
    }
}

fn select_room(workspace: &WorkspaceSnapshot, selector: &str) -> Result<RoomRecord, RoomError> {
    let rooms: Vec<_> = workspace
        .rooms
        .iter()
        .filter(|room| room.deleted_at.is_none() && (room.id == selector || room.name == selector))
        .cloned()
        .collect();
    match rooms.as_slice() {
        [room] => Ok(room.clone()),
        _ => Err(RoomError::SelectionUnavailable),
    }
}

fn validate_created_room(
    room: &RoomRecord,
    team_id: &str,
    name: &str,
    user_id: &str,
) -> Result<(), RoomError> {
    room.validate().map_err(|_| RoomError::RelayUnavailable)?;
    if room.team_id != team_id
        || room.name != name
        || room.host_user_id.as_deref() != Some(user_id)
        || room.host_status != HostStatus::Offline
        || room.accepted_mls_epoch.is_some()
        || room.active_host_device_id.is_some()
        || room.approval_policy != ApprovalPolicy::AskEveryTurn
    {
        return Err(RoomError::RelayUnavailable);
    }
    Ok(())
}

fn validate_active_host(
    room: &RoomRecord,
    user_id: &str,
    device_id: &str,
) -> Result<(), RoomError> {
    room.validate().map_err(|_| RoomError::RelayUnavailable)?;
    if room.host_status != HostStatus::Active
        || room.host_user_id.as_deref() != Some(user_id)
        || room.active_host_device_id.as_deref() != Some(device_id)
        || room.accepted_mls_epoch != Some(0)
        || room.approval_policy != ApprovalPolicy::AskEveryTurn
    {
        return Err(RoomError::RelayUnavailable);
    }
    Ok(())
}

fn map_mls_error(error: MlsClientError) -> RoomError {
    match error {
        MlsClientError::RequiresRejoin | MlsClientError::IdentityScopeMismatch => {
            RoomError::RequiresRejoin
        }
        MlsClientError::GroupNotFound => RoomError::SelectionUnavailable,
        _ => RoomError::CreationPending,
    }
}

fn map_cli_error(error: CliError) -> RoomError {
    match error {
        CliError::RelayAuthenticationRequired => RoomError::AuthenticationRequired,
        _ => RoomError::RelayUnavailable,
    }
}

fn map_relay(_error: RelayTransportError) -> RoomError {
    RoomError::RelayUnavailable
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        auth::SignedInUser,
        identity::load_or_create_identity,
        platform::{tests::MemoryCredentialStore, HttpResponse},
    };
    use multaiplayer_protocol::{TeamRecord, TeamRole};
    use serde_json::Value;
    use std::{
        cell::RefCell,
        collections::{BTreeMap, VecDeque},
        io::{BufRead, BufReader, Read, Write},
        path::PathBuf,
        process::{Child, ChildStdout, Command, Stdio},
    };

    const USER: &str = "github:42";
    const DEVICE: &str = "device_cli";
    const ORIGIN: &str = "https://relay.example.com";

    fn team() -> TeamRecord {
        TeamRecord {
            id: "team-core".into(),
            name: "Core".into(),
            members: 1,
            role: Some(TeamRole::Owner),
            archived_at: None,
            deleted_at: None,
        }
    }

    fn offline_room() -> RoomRecord {
        RoomRecord {
            id: "room-cli".into(),
            team_id: "team-core".into(),
            accepted_mls_epoch: None,
            name: "Compiler work".into(),
            host: "Maddie".into(),
            host_user_id: Some(USER.into()),
            active_host_device_id: None,
            host_status: HostStatus::Offline,
            approval_policy: ApprovalPolicy::AskEveryTurn,
            archived_at: None,
            deleted_at: None,
        }
    }

    fn active_room() -> RoomRecord {
        RoomRecord {
            accepted_mls_epoch: Some(0),
            active_host_device_id: Some(DEVICE.into()),
            host_status: HostStatus::Active,
            ..offline_room()
        }
    }

    struct FakeBackend {
        snapshots: VecDeque<WorkspaceSnapshot>,
        created: usize,
        joined: usize,
        activated: usize,
        fail_activate: bool,
        transmitted: RefCell<Vec<String>>,
    }

    impl FakeBackend {
        fn new(snapshots: Vec<WorkspaceSnapshot>) -> Self {
            Self {
                snapshots: snapshots.into(),
                created: 0,
                joined: 0,
                activated: 0,
                fail_activate: false,
                transmitted: RefCell::new(Vec::new()),
            }
        }
    }

    impl RoomBackend for FakeBackend {
        fn workspace(&mut self) -> Result<WorkspaceSnapshot, RoomError> {
            self.snapshots
                .pop_front()
                .or_else(|| self.snapshots.back().cloned())
                .ok_or(RoomError::RelayUnavailable)
        }

        fn create_room(&mut self, team_id: &str, name: &str) -> Result<RoomRecord, RoomError> {
            self.created += 1;
            self.transmitted
                .borrow_mut()
                .extend([team_id.into(), name.into()]);
            Ok(offline_room())
        }

        fn establish_device_session(&mut self) -> Result<Zeroizing<String>, RoomError> {
            Ok(Zeroizing::new("device-session".into()))
        }

        fn join_room(&mut self, room: &RoomRecord, _: &str) -> Result<(), RoomError> {
            self.joined += 1;
            self.transmitted.borrow_mut().push(room.id.clone());
            Ok(())
        }

        fn activate_host(&mut self, room: &RoomRecord, _: &str) -> Result<RoomRecord, RoomError> {
            self.activated += 1;
            self.transmitted.borrow_mut().push(room.id.clone());
            if self.fail_activate {
                Err(RoomError::RelayUnavailable)
            } else {
                Ok(active_room())
            }
        }
    }

    #[derive(Default)]
    struct FakeMls {
        creates: usize,
        opens: usize,
        deletes: usize,
        fail_create: bool,
        fail_delete: bool,
    }

    impl RoomMls for FakeMls {
        fn create_group_idempotent(&mut self, _: &str) -> Result<u64, RoomError> {
            self.creates += 1;
            if self.fail_create {
                Err(RoomError::CreationPending)
            } else {
                Ok(0)
            }
        }

        fn open_group(&mut self, _: &str) -> Result<u64, RoomError> {
            self.opens += 1;
            Ok(0)
        }

        fn forget_room_local_state(&mut self, _: &str) -> Result<(), RoomError> {
            self.deletes += 1;
            if self.fail_delete {
                Err(RoomError::CreationPending)
            } else {
                Ok(())
            }
        }
    }

    fn workspace(rooms: Vec<RoomRecord>) -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            teams: vec![team()],
            rooms,
        }
    }

    fn request(project: &Path) -> CreateRoomRequest {
        CreateRoomRequest {
            team: None,
            name: "Compiler work".into(),
            project: project.to_string_lossy().into_owned(),
        }
    }

    #[test]
    fn leave_retains_local_data_while_forget_uses_a_destructive_tombstone() {
        let store = MemoryCredentialStore::default();
        let mut creator = FakeBackend::new(vec![workspace(vec![])]);
        let mut creator_mls = FakeMls::default();
        let created =
            RoomService::new(&store, &mut creator, &mut creator_mls, USER, DEVICE, ORIGIN)
                .create(&request(&std::env::temp_dir()))
                .unwrap();

        let mut leave_backend = FakeBackend::new(vec![workspace(vec![created.room.clone()])]);
        let mut lifecycle_mls = FakeMls::default();
        RoomService::new(
            &store,
            &mut leave_backend,
            &mut lifecycle_mls,
            USER,
            DEVICE,
            ORIGIN,
        )
        .leave(&created.room.id)
        .unwrap();
        assert_eq!(lifecycle_mls.deletes, 0);
        assert!(store
            .get(ROOM_STATE_ACCOUNT)
            .unwrap()
            .unwrap()
            .contains(&created.room.id));

        let mut open_backend = FakeBackend::new(vec![workspace(vec![created.room.clone()])]);
        assert_eq!(
            RoomService::new(
                &store,
                &mut open_backend,
                &mut lifecycle_mls,
                USER,
                DEVICE,
                ORIGIN,
            )
            .open(&created.room.id),
            Err(RoomError::CreationPending)
        );

        let mut forget_backend = FakeBackend::new(vec![]);
        lifecycle_mls.fail_delete = true;
        assert_eq!(
            RoomService::new(
                &store,
                &mut forget_backend,
                &mut lifecycle_mls,
                USER,
                DEVICE,
                ORIGIN,
            )
            .forget(&created.room.id),
            Err(RoomError::CreationPending)
        );
        let tombstone = store.get(ROOM_STATE_ACCOUNT).unwrap().unwrap();
        assert!(tombstone.contains(&created.room.id));
        assert!(tombstone.contains("\"forgetPending\":true"));

        lifecycle_mls.fail_delete = false;
        assert_eq!(
            RoomService::new(
                &store,
                &mut forget_backend,
                &mut lifecycle_mls,
                USER,
                DEVICE,
                ORIGIN,
            )
            .forget(&created.room.id),
            Ok(created.room.id.clone())
        );
        assert_eq!(lifecycle_mls.deletes, 2);
        assert!(!store
            .get(ROOM_STATE_ACCOUNT)
            .unwrap()
            .unwrap()
            .contains(&created.room.id));
    }

    #[test]
    fn create_is_private_durable_and_idempotent_across_restart() {
        let project = std::env::temp_dir();
        let canonical_project = fs::canonicalize(&project).unwrap();
        let store = MemoryCredentialStore::default();
        let mut backend = FakeBackend::new(vec![workspace(vec![])]);
        let mut mls = FakeMls::default();
        let created = RoomService::new(&store, &mut backend, &mut mls, USER, DEVICE, ORIGIN)
            .create(&request(&project))
            .unwrap();
        assert_eq!(created.room, active_room());
        assert_eq!(
            (backend.created, backend.joined, backend.activated),
            (1, 1, 1)
        );
        assert_eq!(mls.creates, 1);
        assert!(!backend
            .transmitted
            .borrow()
            .iter()
            .any(|value| value == canonical_project.to_str().unwrap()));
        let stored = store
            .values
            .borrow()
            .get(ROOM_STATE_ACCOUNT)
            .unwrap()
            .clone();
        assert!(stored.contains(canonical_project.to_str().unwrap()));

        let mut restarted = FakeBackend::new(vec![workspace(vec![active_room()])]);
        let mut restarted_mls = FakeMls::default();
        let opened = RoomService::new(
            &store,
            &mut restarted,
            &mut restarted_mls,
            USER,
            DEVICE,
            ORIGIN,
        )
        .create(&request(&project))
        .unwrap();
        assert_eq!(opened.room, active_room());
        assert_eq!(
            (restarted.created, restarted.joined, restarted.activated),
            (0, 0, 0)
        );
    }

    #[test]
    fn invalid_path_fails_before_local_or_remote_mutation() {
        let store = MemoryCredentialStore::default();
        let mut backend = FakeBackend::new(vec![workspace(vec![])]);
        let mut mls = FakeMls::default();
        let result = RoomService::new(&store, &mut backend, &mut mls, USER, DEVICE, ORIGIN).create(
            &CreateRoomRequest {
                team: None,
                name: "Compiler work".into(),
                project: "/definitely/missing/private/project".into(),
            },
        );
        assert_eq!(result, Err(RoomError::InvalidProject));
        assert_eq!(backend.created, 0);
        assert!(!store.values.borrow().contains_key(ROOM_STATE_ACCOUNT));
    }

    #[test]
    fn local_state_failure_rolls_back_before_room_or_mls_creation() {
        let store = MemoryCredentialStore::default();
        *store.fail_set_account.borrow_mut() = Some(ROOM_STATE_ACCOUNT.into());
        let mut backend = FakeBackend::new(vec![workspace(vec![])]);
        let mut mls = FakeMls::default();
        let result = RoomService::new(&store, &mut backend, &mut mls, USER, DEVICE, ORIGIN)
            .create(&request(&std::env::temp_dir()));
        assert_eq!(result, Err(RoomError::LocalStateUnavailable));
        assert_eq!(
            (backend.created, backend.joined, backend.activated),
            (0, 0, 0)
        );
        assert_eq!(mls.creates, 0);
        assert!(!store.values.borrow().contains_key(ROOM_STATE_ACCOUNT));
    }

    #[test]
    fn request_debug_redacts_the_local_path() {
        let private = "/private/secret/project";
        let rendered = format!(
            "{:?}",
            CreateRoomRequest {
                team: None,
                name: "Compiler work".into(),
                project: private.into(),
            }
        );
        assert!(!rendered.contains(private));
        assert!(rendered.contains("[local project]"));
    }

    #[test]
    fn room_output_neutralizes_directional_and_zero_width_spoofing() {
        let mut room = active_room();
        room.name = "trusted\u{202e}tpmorp\u{200b}\u{1b}[2J".into();
        let rendered = opened_room_message(&OpenedRoom {
            room,
            is_active_host: true,
        });
        assert!(!rendered.contains('\u{202e}'));
        assert!(!rendered.contains('\u{200b}'));
        assert!(!rendered.contains('\u{1b}'));
        assert!(rendered.contains("trusted�tpmorp��[2J"));
    }

    #[test]
    fn first_attempt_never_adopts_an_unrelated_offline_room() {
        let store = MemoryCredentialStore::default();
        let mut unrelated = offline_room();
        unrelated.id = "room-unrelated".into();
        let mut backend = FakeBackend::new(vec![workspace(vec![unrelated])]);
        let mut mls = FakeMls::default();
        let result = RoomService::new(&store, &mut backend, &mut mls, USER, DEVICE, ORIGIN)
            .create(&request(&std::env::temp_dir()))
            .unwrap();
        assert_eq!(result.room, active_room());
        assert_eq!(backend.created, 1);
    }

    #[test]
    fn mls_failure_preserves_recoverable_room_and_never_claims_host() {
        let store = MemoryCredentialStore::default();
        let mut backend = FakeBackend::new(vec![workspace(vec![])]);
        let mut mls = FakeMls {
            fail_create: true,
            ..FakeMls::default()
        };
        let result = RoomService::new(&store, &mut backend, &mut mls, USER, DEVICE, ORIGIN)
            .create(&request(&std::env::temp_dir()));
        assert_eq!(result, Err(RoomError::CreationPending));
        assert_eq!(
            (backend.created, backend.joined, backend.activated),
            (1, 0, 0)
        );
        let stored = store
            .values
            .borrow()
            .get(ROOM_STATE_ACCOUNT)
            .unwrap()
            .clone();
        assert!(stored.contains("room-cli"));

        let mut retry_backend = FakeBackend::new(vec![workspace(vec![offline_room()])]);
        let mut retry_mls = FakeMls::default();
        let retried = RoomService::new(
            &store,
            &mut retry_backend,
            &mut retry_mls,
            USER,
            DEVICE,
            ORIGIN,
        )
        .create(&request(&std::env::temp_dir()))
        .unwrap();
        assert_eq!(retried.room, active_room());
        assert_eq!(
            (
                retry_backend.created,
                retry_backend.joined,
                retry_backend.activated
            ),
            (0, 1, 1)
        );
    }

    #[test]
    fn lost_host_response_recovers_only_the_exact_active_authority_tuple() {
        let store = MemoryCredentialStore::default();
        let mut backend = FakeBackend::new(vec![workspace(vec![]), workspace(vec![active_room()])]);
        backend.fail_activate = true;
        let mut mls = FakeMls::default();
        let result = RoomService::new(&store, &mut backend, &mut mls, USER, DEVICE, ORIGIN)
            .create(&request(&std::env::temp_dir()))
            .unwrap();
        assert_eq!(result.room, active_room());
        assert_eq!(
            (backend.created, backend.joined, backend.activated),
            (1, 1, 1)
        );
    }

    #[test]
    fn ambiguous_offline_recovery_fails_without_creating_or_claiming() {
        let store = MemoryCredentialStore::default();
        let pending = StoredRoomState {
            version: 1,
            user_id: USER.into(),
            device_id: DEVICE.into(),
            relay_origin: ORIGIN.into(),
            associations: vec![StoredAssociation {
                team_id: "team-core".into(),
                room_id: None,
                room_name: "Compiler work".into(),
                project_path: Some(
                    fs::canonicalize(std::env::temp_dir())
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                ),
                complete: false,
                left: false,
                forget_pending: false,
            }],
        };
        store
            .set(
                ROOM_STATE_ACCOUNT,
                &serde_json::to_string(&pending).unwrap(),
            )
            .unwrap();
        let mut duplicate = offline_room();
        duplicate.id = "room-cli-duplicate".into();
        let mut backend = FakeBackend::new(vec![workspace(vec![offline_room(), duplicate])]);
        let mut mls = FakeMls::default();
        let result = RoomService::new(&store, &mut backend, &mut mls, USER, DEVICE, ORIGIN)
            .create(&request(&std::env::temp_dir()));
        assert_eq!(result, Err(RoomError::CreationPending));
        assert_eq!(
            (backend.created, backend.joined, backend.activated),
            (0, 0, 0)
        );
        assert_eq!(mls.creates, 0);
    }

    #[test]
    fn open_revalidates_path_and_rejects_host_handoff() {
        let project = std::env::temp_dir();
        let store = MemoryCredentialStore::default();
        let mut creator = FakeBackend::new(vec![workspace(vec![])]);
        let mut creator_mls = FakeMls::default();
        RoomService::new(&store, &mut creator, &mut creator_mls, USER, DEVICE, ORIGIN)
            .create(&request(&project))
            .unwrap();

        let mut foreign = active_room();
        foreign.active_host_device_id = Some("device_other".into());
        let mut backend = FakeBackend::new(vec![workspace(vec![foreign])]);
        let mut mls = FakeMls::default();
        let result =
            RoomService::new(&store, &mut backend, &mut mls, USER, DEVICE, ORIGIN).open("room-cli");
        assert_eq!(result, Err(RoomError::HostHandoffUnsupported));
        assert_eq!(mls.opens, 1);
    }

    #[test]
    fn joined_participant_opens_remote_host_without_a_project_and_rejects_handoff_to_cli() {
        let store = MemoryCredentialStore::default();
        let mut remote = active_room();
        remote.host = "Desktop Host".into();
        remote.host_user_id = Some("github:desktop-host".into());
        remote.active_host_device_id = Some("device_desktop_host".into());
        record_joined_room_association(&store, USER, DEVICE, ORIGIN, &remote).unwrap();

        let mut backend = FakeBackend::new(vec![workspace(vec![remote.clone()])]);
        let mut mls = FakeMls::default();
        let mut service = RoomService::new(&store, &mut backend, &mut mls, USER, DEVICE, ORIGIN);
        let opened = service.open("room-cli").unwrap();
        assert!(!opened.is_active_host);
        assert_eq!(service.local_project_path("room-cli").unwrap(), None);

        let mut handed_off = remote;
        handed_off.host = "CLI Participant".into();
        handed_off.host_user_id = Some(USER.into());
        handed_off.active_host_device_id = Some(DEVICE.into());
        let mut backend = FakeBackend::new(vec![workspace(vec![handed_off])]);
        let mut mls = FakeMls::default();
        assert_eq!(
            RoomService::new(&store, &mut backend, &mut mls, USER, DEVICE, ORIGIN).open("room-cli"),
            Err(RoomError::HostHandoffUnsupported)
        );
    }

    struct RecordingLoopbackHttp {
        client: reqwest::blocking::Client,
        trace: RefCell<Vec<String>>,
        required_mls_before_host_patch: Option<PathBuf>,
    }

    impl RecordingLoopbackHttp {
        fn new() -> Self {
            Self {
                client: reqwest::blocking::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .unwrap(),
                trace: RefCell::new(Vec::new()),
                required_mls_before_host_patch: None,
            }
        }

        fn require_mls_before_host_patch(mut self, path: &Path) -> Self {
            self.required_mls_before_host_patch = Some(path.to_owned());
            self
        }

        fn send(
            &self,
            method: reqwest::Method,
            url: &str,
            headers: &[(&str, &str)],
            body: Option<&Value>,
        ) -> Result<HttpResponse, CliError> {
            let parsed = reqwest::Url::parse(url).map_err(|_| CliError::RelayUnavailable)?;
            if parsed.scheme() != "http"
                || !matches!(parsed.host_str(), Some("127.0.0.1") | Some("::1"))
                || parsed.port().is_none()
            {
                return Err(CliError::RelayUnavailable);
            }
            self.trace
                .borrow_mut()
                .push(format!("{} {}", method.as_str(), parsed));
            if method == reqwest::Method::PATCH && parsed.path().ends_with("/host") {
                if let Some(path) = &self.required_mls_before_host_patch {
                    let metadata = fs::metadata(path).map_err(|_| CliError::RelayUnavailable)?;
                    if !metadata.is_file() || metadata.len() == 0 {
                        return Err(CliError::RelayUnavailable);
                    }
                }
            }
            let mut request = self.client.request(method, parsed);
            for (name, value) in headers {
                request = request.header(*name, *value);
            }
            if let Some(body) = body {
                self.trace.borrow_mut().push(body.to_string());
                request = request.json(body);
            }
            let response = request.send().map_err(|_| CliError::RelayUnavailable)?;
            let status = response.status().as_u16();
            let final_url = response.url().to_string();
            let response_headers: BTreeMap<_, _> = response
                .headers()
                .iter()
                .filter_map(|(name, value)| {
                    value
                        .to_str()
                        .ok()
                        .map(|value| (name.as_str().to_owned(), value.to_owned()))
                })
                .collect();
            let mut response_body = Vec::new();
            response
                .take((MAX_HTTP_RESPONSE_BYTES + 1) as u64)
                .read_to_end(&mut response_body)
                .map_err(|_| CliError::RelayUnavailable)?;
            if response_body.len() > MAX_HTTP_RESPONSE_BYTES {
                return Err(CliError::RelayUnavailable);
            }
            self.trace
                .borrow_mut()
                .push(String::from_utf8_lossy(&response_body).into_owned());
            Ok(HttpResponse {
                status,
                final_url,
                headers: response_headers,
                body: response_body,
            })
        }

        fn joined_trace(&self) -> String {
            self.trace.borrow().join("\n")
        }
    }

    impl HttpClient for RecordingLoopbackHttp {
        fn get(&self, url: &str, headers: &[(&str, &str)]) -> Result<HttpResponse, CliError> {
            self.send(reqwest::Method::GET, url, headers, None)
        }

        fn post_json(
            &self,
            url: &str,
            headers: &[(&str, &str)],
            body: &Value,
        ) -> Result<HttpResponse, CliError> {
            self.send(reqwest::Method::POST, url, headers, Some(body))
        }

        fn patch_json(
            &self,
            url: &str,
            headers: &[(&str, &str)],
            body: &Value,
        ) -> Result<HttpResponse, CliError> {
            self.send(reqwest::Method::PATCH, url, headers, Some(body))
        }
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RelayFixtureInfo {
        base_url: String,
        ws_url: String,
        temp_dir: PathBuf,
    }

    struct RelayFixture {
        child: Option<Child>,
        stdout: BufReader<ChildStdout>,
        info: RelayFixtureInfo,
    }

    impl RelayFixture {
        fn start(forbidden: &str) -> Self {
            let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/real-relay-fixture.ts");
            let mut command = Command::new("node");
            command
                .arg("--import")
                .arg("tsx")
                .arg(fixture)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit());
            let mut child = command.spawn().expect("start real relay fixture");
            child
                .stdin
                .as_mut()
                .unwrap()
                .write_all(format!("{}\n", serde_json::to_string(forbidden).unwrap()).as_bytes())
                .unwrap();
            let mut stdout = BufReader::new(child.stdout.take().unwrap());
            let mut line = String::new();
            stdout
                .read_line(&mut line)
                .expect("read real relay fixture address");
            let info = serde_json::from_str(&line).expect("decode real relay fixture address");
            Self {
                child: Some(child),
                stdout,
                info,
            }
        }

        fn restart(&mut self) {
            let child = self.child.as_mut().unwrap();
            child
                .stdin
                .as_mut()
                .unwrap()
                .write_all(b"restart\n")
                .unwrap();
            let mut line = String::new();
            self.stdout.read_line(&mut line).unwrap();
            assert_eq!(line.trim(), r#"{"restarted":true}"#);
        }

        fn stop(&mut self) {
            if let Some(mut child) = self.child.take() {
                child.stdin.take().unwrap().write_all(b"stop\n").unwrap();
                assert!(child.wait().unwrap().success());
            }
        }
    }

    impl Drop for RelayFixture {
        fn drop(&mut self) {
            self.stop();
        }
    }

    struct JourneyDirectory(PathBuf);

    impl JourneyDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "multaiplayer-cli-room-journey-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for JourneyDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn create_debug_session(http: &RecordingLoopbackHttp, origin: &str) -> String {
        let response = http
            .post_json(
                &endpoint(origin, "/debug/auth-session").unwrap(),
                &[],
                &json!({
                    "id": "github:maddiedreese",
                    "login": "maddiedreese",
                    "name": "Maddie"
                }),
            )
            .unwrap();
        assert_eq!(response.status, 201);
        response
            .headers
            .get("set-cookie")
            .and_then(|value| value.split(';').next())
            .and_then(|value| value.strip_prefix("multaiplayer_session="))
            .unwrap()
            .to_owned()
    }

    fn register_identity(
        http: &RecordingLoopbackHttp,
        origin: &str,
        relay_session: &str,
        identity: &DeviceIdentity,
    ) {
        let response = http
            .post_json(
                &endpoint(origin, "/devices").unwrap(),
                &[("cookie", &format!("multaiplayer_session={relay_session}"))],
                &json!({
                    "deviceId": identity.public.device_id,
                    "signaturePublicKey": identity.public.signature_public_key,
                    "signatureKeyFingerprint": identity.public.signature_key_fingerprint,
                    "hpkePublicKey": identity.public.hpke_public_key,
                    "hpkeKeyFingerprint": identity.public.hpke_key_fingerprint
                }),
            )
            .unwrap();
        assert!(matches!(response.status, 200 | 201));
    }

    fn assert_tree_excludes(root: &Path, forbidden: &[u8]) {
        for entry in fs::read_dir(root).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                assert_tree_excludes(&path, forbidden);
            } else {
                let bytes = fs::read(&path).unwrap();
                assert!(
                    !bytes
                        .windows(forbidden.len())
                        .any(|value| value == forbidden),
                    "relay persistence unexpectedly contained the local project path in {}",
                    path.display()
                );
            }
        }
    }

    #[test]
    fn production_room_create_open_and_restart_journey_keeps_project_path_local() {
        let journey = JourneyDirectory::new();
        let project = journey.0.join("project");
        fs::create_dir(&project).unwrap();
        let canonical_project = fs::canonicalize(&project).unwrap();
        let canonical_text = canonical_project.to_str().unwrap();
        let mls_path = journey.0.join("mls.sqlite");
        let store = MemoryCredentialStore::default();
        let identity = load_or_create_identity(&store, "github:maddiedreese", "Maddie").unwrap();
        let mut relay = RelayFixture::start(canonical_text);
        let original_origin = relay.info.base_url.clone();
        let restored = RestoredSession {
            user: SignedInUser {
                id: "github:maddiedreese".into(),
                login: "maddiedreese".into(),
                name: Some("Maddie".into()),
                avatar_url: None,
            },
            relay_origin: original_origin.clone(),
        };
        let relay_temp_dir = relay.info.temp_dir.clone();
        let first_http = RecordingLoopbackHttp::new().require_mls_before_host_patch(&mls_path);
        let relay_session = create_debug_session(&first_http, &original_origin);
        register_identity(&first_http, &original_origin, &relay_session, &identity);

        let mut first_mls = MlsClientService::open(&store, &identity, &mls_path).unwrap();
        let mut first_backend = RelayRoomBackend::new_for_loopback_test(
            &store,
            &first_http,
            &original_origin,
            &relay.info.ws_url,
            &relay_session,
            &restored,
            &identity,
        )
        .unwrap();
        let created = RoomService::new(
            &store,
            &mut first_backend,
            &mut first_mls,
            &restored.user.id,
            &identity.public.device_id,
            &original_origin,
        )
        .create(&CreateRoomRequest {
            team: Some("team-core".into()),
            name: "CLI production restart journey".into(),
            project: project.to_string_lossy().into_owned(),
        })
        .unwrap();

        assert_eq!(created.room.team_id, "team-core");
        assert_eq!(
            created.room.host_user_id.as_deref(),
            Some(restored.user.id.as_str())
        );
        assert_eq!(
            created.room.active_host_device_id.as_deref(),
            Some(identity.public.device_id.as_str())
        );
        assert_eq!(created.room.host_status, HostStatus::Active);
        assert_eq!(created.room.accepted_mls_epoch, Some(0));
        assert_eq!(created.room.approval_policy, ApprovalPolicy::AskEveryTurn);
        assert_eq!(
            MlsClientService::open_group(&mut first_mls, &created.room.id),
            Ok(0)
        );
        let association = store
            .values
            .borrow()
            .get(ROOM_STATE_ACCOUNT)
            .unwrap()
            .clone();
        assert!(association.contains(canonical_text));
        assert!(!first_http.joined_trace().contains(canonical_text));
        assert!(!opened_room_message(&created).contains(canonical_text));

        drop(first_backend);
        drop(first_mls);
        relay.restart();
        assert_eq!(relay.info.base_url, original_origin);
        let restarted_http = RecordingLoopbackHttp::new();
        let mut restarted_mls = MlsClientService::open(&store, &identity, &mls_path).unwrap();
        let mut restarted_backend = RelayRoomBackend::new_for_loopback_test(
            &store,
            &restarted_http,
            &relay.info.base_url,
            &relay.info.ws_url,
            &relay_session,
            &restored,
            &identity,
        )
        .unwrap();
        let opened = RoomService::new(
            &store,
            &mut restarted_backend,
            &mut restarted_mls,
            &restored.user.id,
            &identity.public.device_id,
            &original_origin,
        )
        .open(&created.room.id)
        .unwrap();
        assert_eq!(opened.room, created.room);
        assert!(opened.is_active_host);
        assert!(!restarted_http.joined_trace().contains(canonical_text));
        assert!(!opened_room_message(&opened).contains(canonical_text));

        drop(restarted_backend);
        drop(restarted_mls);
        relay.stop();
        assert_tree_excludes(&relay_temp_dir, canonical_text.as_bytes());
        fs::remove_dir_all(&relay_temp_dir).unwrap();
    }
}
