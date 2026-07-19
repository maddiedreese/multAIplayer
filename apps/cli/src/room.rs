use crate::{
    auth::{endpoint, load_relay_transport_session, RestoredSession},
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
use multaiplayer_protocol::{ApprovalPolicy, HostStatus, RelayClientMessage, RoomRecord, Validate};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{fs, path::Path, time::Duration};
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub const ROOM_STATE_ACCOUNT: &str = "room-associations:v1";
const NATIVE_SESSION_HEADER: &str = "x-multaiplayer-session";
const DEVICE_SESSION_HEADER: &str = "x-device-session";
const ROOM_OPERATION_TIMEOUT: Duration = Duration::from_secs(10);

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

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreateRoomRequest {
    pub team: Option<String>,
    pub name: String,
    pub project: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OpenedRoom {
    pub room: RoomRecord,
    pub is_active_host: bool,
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
}

impl RoomMls for MlsClientService {
    fn create_group_idempotent(&mut self, room_id: &str) -> Result<u64, RoomError> {
        MlsClientService::create_group_idempotent(self, room_id).map_err(map_mls_error)
    }

    fn open_group(&mut self, room_id: &str) -> Result<u64, RoomError> {
        MlsClientService::open_group(self, room_id).map_err(map_mls_error)
    }
}

pub struct RelayRoomBackend<'a, S, H> {
    store: &'a S,
    http: &'a H,
    relay_origin: String,
    session: &'a RestoredSession,
    identity: &'a DeviceIdentity,
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
        })
    }

    fn headers(&self) -> Result<Zeroizing<String>, RoomError> {
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
        if response.final_url != challenge_url || response.status != 200 {
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
        if response.final_url != session_url || response.status != 200 {
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
    project_path: String,
    complete: bool,
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
        let index = match state.associations.iter().position(|association| {
            association.team_id == team_id
                && association.room_name == request.name
                && association.project_path == project_path
        }) {
            Some(index) => index,
            None => {
                state.associations.push(StoredAssociation {
                    team_id: team_id.clone(),
                    room_id: None,
                    room_name: request.name.clone(),
                    project_path,
                    complete: false,
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
            let created = match candidates.as_slice() {
                [] => self.backend.create_room(&team_id, &request.name)?,
                [room] => room.clone(),
                _ => return Err(RoomError::CreationPending),
            };
            validate_created_room(&created, &team_id, &request.name, self.user_id)?;
            state.associations[index].room_id = Some(created.id.clone());
            self.save_state(&state)?;
            created
        };

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
        canonical_stored_project(&association.project_path)?;
        self.mls.open_group(&room.id)?;
        if room.host_status == HostStatus::Active
            && (room.host_user_id.as_deref() != Some(self.user_id)
                || room.active_host_device_id.as_deref() != Some(self.device_id))
        {
            return Err(RoomError::HostHandoffUnsupported);
        }
        Ok(OpenedRoom {
            is_active_host: room.host_status == HostStatus::Active,
            room,
        })
    }

    fn load_state(&self) -> Result<StoredRoomState, RoomError> {
        let Some(encoded) = self
            .store
            .get(ROOM_STATE_ACCOUNT)
            .map_err(|_| RoomError::LocalStateUnavailable)?
        else {
            return Ok(StoredRoomState {
                version: 1,
                user_id: self.user_id.to_owned(),
                device_id: self.device_id.to_owned(),
                relay_origin: self.relay_origin.to_owned(),
                associations: Vec::new(),
            });
        };
        let state: StoredRoomState =
            serde_json::from_str(&encoded).map_err(|_| RoomError::LocalStateUnavailable)?;
        if state.version != 1
            || state.user_id != self.user_id
            || state.device_id != self.device_id
            || state.relay_origin != self.relay_origin
        {
            return Err(RoomError::LocalStateUnavailable);
        }
        Ok(state)
    }

    fn save_state(&self, state: &StoredRoomState) -> Result<(), RoomError> {
        let encoded = Zeroizing::new(
            serde_json::to_string(state).map_err(|_| RoomError::LocalStateUnavailable)?,
        );
        self.store
            .set(ROOM_STATE_ACCOUNT, encoded.as_str())
            .map_err(|_| RoomError::LocalStateUnavailable)
    }
}

fn validate_room_name(name: &str) -> Result<(), RoomError> {
    if name.is_empty() || name.encode_utf16().count() > 120 || name.chars().any(char::is_control) {
        Err(RoomError::InvalidName)
    } else {
        Ok(())
    }
}

fn canonical_project(project: &str) -> Result<String, RoomError> {
    if project.is_empty() || project.chars().any(|value| value == '\0') {
        return Err(RoomError::InvalidProject);
    }
    let canonical = fs::canonicalize(Path::new(project)).map_err(|_| RoomError::InvalidProject)?;
    canonical_stored_project(canonical.to_str().ok_or(RoomError::InvalidProject)?)
}

fn canonical_stored_project(project: &str) -> Result<String, RoomError> {
    let path = Path::new(project);
    if !path.is_absolute() || !path.is_dir() || project.chars().count() > 4096 {
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
    use crate::platform::tests::MemoryCredentialStore;
    use multaiplayer_protocol::{TeamRecord, TeamRole};
    use std::{cell::RefCell, collections::VecDeque};

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
        fail_create: bool,
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
                project_path: fs::canonicalize(std::env::temp_dir())
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                complete: false,
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
}
