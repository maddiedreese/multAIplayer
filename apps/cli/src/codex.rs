use codex_host_core::host::{
    capabilities_for_version, extract_text_delta, send_json_shared, thread_id_from_response,
    thread_request, ActiveTimeout, AppServerProcess, AppServerProcessConfig, RpcId, RpcInbox,
    RpcMessage,
};
use multaiplayer_protocol::{
    CatalogSelectionPolicy, ChatPlaintextPayload, ChatRole, CodexReasoningEffort,
    CodexSandboxLevel, CodexSpeed,
};
use serde_json::json;
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use thiserror::Error;

pub const PROPOSAL_TTL_SECONDS: i64 = 15 * 60;
pub const MAX_CONTEXT_MESSAGES: usize = 32;
pub const MAX_CONTEXT_MESSAGE_CHARS: usize = 2_000;
pub const MAX_CONTEXT_CHARS: usize = 24_000;
pub const MAX_ASSISTANT_CHARS: usize = 120_000;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodexProposal {
    pub room_id: String,
    pub proposal_id: String,
    pub proposer: String,
    pub proposer_user_id: String,
    pub task: String,
    pub created_at: String,
    pub expires_at_unix: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProposalPhase {
    Idle,
    Proposed,
    Approved,
    Starting,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum ProposalError {
    #[error("The Codex proposal is invalid or exceeds its bounds.")]
    Invalid,
    #[error("This room already has a pending proposal or active turn.")]
    Busy,
    #[error("The proposal does not match this room and exact proposal id.")]
    BindingMismatch,
    #[error("The proposal expired before approval.")]
    Expired,
    #[error("Only the current active host can approve or start this turn.")]
    NotActiveHost,
    #[error("The proposal transition is invalid.")]
    InvalidTransition,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalMachine {
    room_id: String,
    phase: ProposalPhase,
    proposal: Option<CodexProposal>,
    completed_ids: BTreeSet<String>,
}

impl ProposalMachine {
    pub fn new(room_id: &str) -> Result<Self, ProposalError> {
        if !bounded_identifier(room_id, 160) {
            return Err(ProposalError::Invalid);
        }
        Ok(Self {
            room_id: room_id.to_owned(),
            phase: ProposalPhase::Idle,
            proposal: None,
            completed_ids: BTreeSet::new(),
        })
    }

    pub fn phase(&self) -> ProposalPhase {
        self.phase
    }

    pub fn pending(&self) -> Option<&CodexProposal> {
        self.proposal.as_ref()
    }

    pub fn observe(
        &mut self,
        proposal: CodexProposal,
        now_unix: i64,
    ) -> Result<bool, ProposalError> {
        validate_proposal(&proposal)?;
        if proposal.room_id != self.room_id {
            return Err(ProposalError::BindingMismatch);
        }
        if self.completed_ids.contains(&proposal.proposal_id) {
            return Ok(false);
        }
        if proposal.expires_at_unix <= now_unix {
            return Err(ProposalError::Expired);
        }
        if let Some(current) = &self.proposal {
            if current == &proposal {
                return Ok(false);
            }
            return Err(ProposalError::Busy);
        }
        if !matches!(
            self.phase,
            ProposalPhase::Idle
                | ProposalPhase::Completed
                | ProposalPhase::Failed
                | ProposalPhase::Cancelled
        ) {
            return Err(ProposalError::Busy);
        }
        self.phase = ProposalPhase::Proposed;
        self.proposal = Some(proposal);
        Ok(true)
    }

    pub fn approve(
        &mut self,
        room_id: &str,
        proposal_id: &str,
        now_unix: i64,
        active_host: bool,
    ) -> Result<bool, ProposalError> {
        if room_id == self.room_id && self.completed_ids.contains(proposal_id) {
            return Ok(false);
        }
        self.require_binding(room_id, proposal_id)?;
        if !active_host {
            return Err(ProposalError::NotActiveHost);
        }
        let proposal = self
            .proposal
            .as_ref()
            .ok_or(ProposalError::BindingMismatch)?;
        if proposal.expires_at_unix <= now_unix {
            self.phase = ProposalPhase::Cancelled;
            self.finish_current();
            return Err(ProposalError::Expired);
        }
        if self.phase == ProposalPhase::Approved {
            return Ok(false);
        }
        if self.phase != ProposalPhase::Proposed {
            return Err(ProposalError::InvalidTransition);
        }
        self.phase = ProposalPhase::Approved;
        Ok(true)
    }

    pub fn start(
        &mut self,
        room_id: &str,
        proposal_id: &str,
        active_host: bool,
    ) -> Result<(), ProposalError> {
        self.require_binding(room_id, proposal_id)?;
        if !active_host {
            return Err(ProposalError::NotActiveHost);
        }
        if self.phase != ProposalPhase::Approved {
            return Err(ProposalError::InvalidTransition);
        }
        self.phase = ProposalPhase::Starting;
        self.phase = ProposalPhase::Running;
        Ok(())
    }

    pub fn cancel(&mut self, room_id: &str, proposal_id: &str) -> Result<bool, ProposalError> {
        if room_id == self.room_id && self.completed_ids.contains(proposal_id) {
            return Ok(false);
        }
        self.require_binding(room_id, proposal_id)?;
        if self.phase == ProposalPhase::Cancelled {
            return Ok(false);
        }
        if matches!(self.phase, ProposalPhase::Completed | ProposalPhase::Failed) {
            return Err(ProposalError::InvalidTransition);
        }
        self.phase = ProposalPhase::Cancelled;
        self.finish_current();
        Ok(true)
    }

    pub fn complete(
        &mut self,
        room_id: &str,
        proposal_id: &str,
        active_host: bool,
    ) -> Result<bool, ProposalError> {
        if room_id == self.room_id && self.completed_ids.contains(proposal_id) {
            return Ok(false);
        }
        self.require_binding(room_id, proposal_id)?;
        if !active_host {
            self.phase = ProposalPhase::Cancelled;
            self.finish_current();
            return Err(ProposalError::NotActiveHost);
        }
        if self.phase == ProposalPhase::Completed {
            return Ok(false);
        }
        if self.phase != ProposalPhase::Running {
            return Err(ProposalError::InvalidTransition);
        }
        self.phase = ProposalPhase::Completed;
        self.finish_current();
        Ok(true)
    }

    pub fn fail(&mut self, room_id: &str, proposal_id: &str) -> Result<(), ProposalError> {
        self.require_binding(room_id, proposal_id)?;
        if !matches!(self.phase, ProposalPhase::Starting | ProposalPhase::Running) {
            return Err(ProposalError::InvalidTransition);
        }
        self.phase = ProposalPhase::Failed;
        self.finish_current();
        Ok(())
    }

    pub fn observe_started(
        &mut self,
        room_id: &str,
        proposal_id: &str,
    ) -> Result<(), ProposalError> {
        if room_id != self.room_id {
            return Err(ProposalError::BindingMismatch);
        }
        if self.completed_ids.contains(proposal_id) || self.phase == ProposalPhase::Running {
            return Ok(());
        }
        self.require_binding(room_id, proposal_id)?;
        if self.phase != ProposalPhase::Proposed {
            return Err(ProposalError::InvalidTransition);
        }
        // A persisted started event without a live worker is an interrupted
        // execution. Mark it terminal so restart can never duplicate the turn.
        self.phase = ProposalPhase::Cancelled;
        self.finish_current();
        Ok(())
    }

    fn require_binding(&self, room_id: &str, proposal_id: &str) -> Result<(), ProposalError> {
        if room_id != self.room_id
            || self
                .proposal
                .as_ref()
                .is_none_or(|proposal| proposal.proposal_id != proposal_id)
        {
            Err(ProposalError::BindingMismatch)
        } else {
            Ok(())
        }
    }

    fn finish_current(&mut self) {
        if let Some(proposal) = self.proposal.take() {
            self.completed_ids.insert(proposal.proposal_id);
            while self.completed_ids.len() > 256 {
                if let Some(first) = self.completed_ids.iter().next().cloned() {
                    self.completed_ids.remove(&first);
                }
            }
        }
    }
}

fn validate_proposal(proposal: &CodexProposal) -> Result<(), ProposalError> {
    if !bounded_identifier(&proposal.room_id, 160)
        || !bounded_identifier(&proposal.proposal_id, 160)
        || !bounded_text(&proposal.proposer, 120)
        || !bounded_identifier(&proposal.proposer_user_id, 128)
        || proposal.task.trim().is_empty()
        || proposal.task.chars().count() > 4_096
        || proposal.created_at.chars().count() > 64
        || proposal.expires_at_unix <= 0
    {
        Err(ProposalError::Invalid)
    } else {
        Ok(())
    }
}

fn bounded_identifier(value: &str, max: usize) -> bool {
    !value.is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}

fn bounded_text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.chars().count() <= max
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContextExtent {
    pub included_messages: usize,
    pub excluded_messages: usize,
    pub included_chars: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BuiltContext {
    pub input: String,
    pub extent: ContextExtent,
}

pub fn build_bounded_context(
    proposal: &CodexProposal,
    history: &[ChatPlaintextPayload],
    participant_display_names: &[String],
    room_model_intent: &str,
) -> Result<BuiltContext, ProposalError> {
    validate_proposal(proposal)?;
    let task = sanitize_context_text(&proposal.task, 4_096);
    if task.trim().is_empty() {
        return Err(ProposalError::Invalid);
    }
    let mut participants = participant_display_names
        .iter()
        .map(|name| sanitize_context_text(name, 120))
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    participants.sort();
    participants.dedup();
    participants.truncate(32);
    let model_intent = sanitize_context_text(room_model_intent, 80);
    let mut input = format!(
        "Room proposal by {}:\n{}\n\nParticipants: {}\nRoom model intent: {}\n\nBounded room transcript:\n",
        sanitize_context_text(&proposal.proposer, 120),
        task,
        participants.join(", "),
        model_intent
    );
    let mut included_messages = 0;
    let mut excluded_messages = 0;
    let recent = history
        .iter()
        .rev()
        .take(MAX_CONTEXT_MESSAGES.saturating_mul(2))
        .collect::<Vec<_>>();
    for message in recent.into_iter().rev() {
        if included_messages >= MAX_CONTEXT_MESSAGES {
            excluded_messages += 1;
            continue;
        }
        let body = sanitize_context_text(&message.body, MAX_CONTEXT_MESSAGE_CHARS);
        if body.is_empty() || body == "[excluded]" {
            excluded_messages += 1;
            continue;
        }
        let role = match message.role {
            ChatRole::Human => "participant",
            ChatRole::Codex => "assistant",
            ChatRole::System => {
                excluded_messages += 1;
                continue;
            }
        };
        let line = format!(
            "- {role} {}: {}\n",
            sanitize_context_text(&message.author, 120),
            body
        );
        if input.chars().count().saturating_add(line.chars().count()) > MAX_CONTEXT_CHARS {
            excluded_messages += 1;
            continue;
        }
        input.push_str(&line);
        included_messages += 1;
    }
    if input.chars().count() > MAX_CONTEXT_CHARS {
        input = input.chars().take(MAX_CONTEXT_CHARS).collect();
    }
    Ok(BuiltContext {
        extent: ContextExtent {
            included_messages,
            excluded_messages,
            included_chars: input.chars().count(),
        },
        input,
    })
}

fn sanitize_context_text(value: &str, max_chars: usize) -> String {
    let bounded = value.chars().take(max_chars).collect::<String>();
    let mut output = Vec::new();
    for token in bounded.split_whitespace() {
        let lower = token.to_ascii_lowercase();
        let secret_like = [
            "token",
            "secret",
            "password",
            "authorization",
            "cookie",
            "api_key",
            "apikey",
            "passphrase",
            "multaiplayerjoin=",
            ".env",
        ]
        .iter()
        .any(|marker| lower.contains(marker));
        let local_path = token.starts_with('/')
            || token.starts_with("~/")
            || token.starts_with("file://")
            || token.contains("/Users/")
            || token.contains("/private/");
        if secret_like || local_path {
            output.push("[excluded]");
        } else {
            output.push(token);
        }
    }
    let rendered = output.join(" ");
    if rendered
        .split_whitespace()
        .all(|token| token == "[excluded]")
    {
        "[excluded]".to_owned()
    } else {
        rendered
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodexTurnSettings {
    pub model: String,
    pub model_policy: CatalogSelectionPolicy,
    pub reasoning_effort: CodexReasoningEffort,
    pub reasoning_policy: CatalogSelectionPolicy,
    pub speed: CodexSpeed,
    pub service_tier_policy: CatalogSelectionPolicy,
    pub sandbox: CodexSandboxLevel,
}

impl Default for CodexTurnSettings {
    fn default() -> Self {
        Self {
            model: "gpt-5.6-sol".to_owned(),
            model_policy: CatalogSelectionPolicy::Auto,
            reasoning_effort: CodexReasoningEffort::Medium,
            reasoning_policy: CatalogSelectionPolicy::Auto,
            speed: CodexSpeed::Standard,
            service_tier_policy: CatalogSelectionPolicy::Auto,
            sandbox: CodexSandboxLevel::WorkspaceWrite,
        }
    }
}

impl CodexTurnSettings {
    pub fn reasoning_label(&self) -> &'static str {
        match self.reasoning_effort {
            CodexReasoningEffort::None => "none",
            CodexReasoningEffort::Minimal => "minimal",
            CodexReasoningEffort::Low => "low",
            CodexReasoningEffort::Medium => "medium",
            CodexReasoningEffort::High => "high",
            CodexReasoningEffort::Xhigh => "xhigh",
            CodexReasoningEffort::Max => "max",
        }
    }

    pub fn service_tier(&self) -> &'static str {
        match self.speed {
            CodexSpeed::Standard => "default",
            CodexSpeed::Fast => "fast",
        }
    }

    pub fn sandbox_label(&self) -> &'static str {
        match self.sandbox {
            CodexSandboxLevel::ReadOnly => "read_only",
            CodexSandboxLevel::WorkspaceWrite => "workspace_write",
            CodexSandboxLevel::WorkspaceWriteNetwork => "workspace_write_network",
            CodexSandboxLevel::DangerFullAccess => "danger_full_access",
        }
    }

    fn sandbox_process_mode(&self) -> &'static str {
        match self.sandbox {
            CodexSandboxLevel::ReadOnly => "read-only",
            CodexSandboxLevel::WorkspaceWrite | CodexSandboxLevel::WorkspaceWriteNetwork => {
                "workspace-write"
            }
            CodexSandboxLevel::DangerFullAccess => "danger-full-access",
        }
    }

    fn network_access(&self) -> bool {
        matches!(
            self.sandbox,
            CodexSandboxLevel::WorkspaceWriteNetwork | CodexSandboxLevel::DangerFullAccess
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostPreview {
    pub proposal_id: String,
    pub proposer: String,
    pub task: String,
    pub room_name: String,
    pub project_association: String,
    pub context_extent: ContextExtent,
    pub effective_model: String,
    pub service_tier: String,
    pub reasoning_effort: String,
    pub sandbox: String,
}

impl HostPreview {
    pub fn trusted_text(&self) -> String {
        format!(
            "Codex proposal: {}\nProposer: {}\nTask: {}\nRoom: {}\nProject association: {}\nContext: {} messages, {} excluded, {} chars\nEffective model: {}\nService tier: {}\nReasoning effort: {}\nSandbox: {}\nApprove with: /approve {}\nDeny with: /deny {}",
            self.proposal_id,
            self.proposer,
            self.task,
            self.room_name,
            self.project_association,
            self.context_extent.included_messages,
            self.context_extent.excluded_messages,
            self.context_extent.included_chars,
            self.effective_model,
            self.service_tier,
            self.reasoning_effort,
            self.sandbox,
            self.proposal_id,
            self.proposal_id,
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostedTurnRequest {
    pub project_path: PathBuf,
    pub input: String,
    pub settings: CodexTurnSettings,
    pub previous_thread_id: Option<String>,
    pub timeout: Duration,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostedTurnResult {
    pub thread_id: String,
    pub assistant_message: String,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum HostedTurnError {
    #[error("Codex compatibility could not be verified.")]
    Compatibility,
    #[error("Codex app-server could not be started safely.")]
    Start,
    #[error("Codex app-server returned an invalid or unsupported response.")]
    InvalidResponse,
    #[error("Codex requested a privileged operation that this CLI version cannot approve.")]
    PrivilegedRequestUnsupported,
    #[error("The Codex turn was cancelled because host authority changed.")]
    Cancelled,
    #[error("The Codex turn exceeded its active execution deadline.")]
    Timeout,
    #[error("The Codex turn failed.")]
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostedProcessConfig {
    pub executable: String,
    pub version: String,
    pub extra_arguments: Vec<String>,
}

pub fn probe_codex_process(executable: &str) -> Result<HostedProcessConfig, HostedTurnError> {
    let output = Command::new(executable)
        .arg("--version")
        .output()
        .map_err(|_| HostedTurnError::Compatibility)?;
    if !output.status.success() || output.stdout.len() > 4_096 {
        return Err(HostedTurnError::Compatibility);
    }
    let version_output =
        std::str::from_utf8(&output.stdout).map_err(|_| HostedTurnError::Compatibility)?;
    let version = codex_host_core::host::parse_codex_version(version_output)
        .ok_or(HostedTurnError::Compatibility)?;
    capabilities_for_version(&version).map_err(|_| HostedTurnError::Compatibility)?;
    Ok(HostedProcessConfig {
        executable: executable.to_owned(),
        version,
        extra_arguments: Vec::new(),
    })
}

pub fn resolve_turn_settings(
    process_config: &HostedProcessConfig,
    requested: &CodexTurnSettings,
    cancelled: &AtomicBool,
) -> Result<CodexTurnSettings, HostedTurnError> {
    capabilities_for_version(&process_config.version)
        .map_err(|_| HostedTurnError::Compatibility)?;
    let config = AppServerProcessConfig {
        executable: process_config.executable.clone(),
        cwd: None,
        arguments: process_config
            .extra_arguments
            .iter()
            .cloned()
            .chain(["app-server".to_owned()])
            .collect(),
        capture_stderr: false,
    };
    let mut process = AppServerProcess::spawn(&config).map_err(|_| HostedTurnError::Start)?;
    let result = (|| {
        let stdin = process.stdin();
        let line_rx = process
            .take_stdout_lines()
            .map_err(|_| HostedTurnError::Start)?;
        let mut inbox = RpcInbox::new(line_rx);
        let mut budget = ActiveTimeout::new(Duration::from_secs(8));
        send_json_shared(
            &stdin,
            json!({
                "method":"initialize",
                "id":1,
                "params":{
                    "clientInfo":{"name":"multaiplayer-cli","title":"multAIplayer CLI","version":env!("CARGO_PKG_VERSION")},
                    "capabilities":{"experimentalApi":true}
                }
            }),
        )
        .map_err(|_| HostedTurnError::Start)?;
        wait_exact_response(&mut inbox, RpcId::Number(1.into()), &mut budget, cancelled)?;
        send_json_shared(&stdin, json!({"method":"initialized","params":{}}))
            .map_err(|_| HostedTurnError::Failed)?;
        send_json_shared(
            &stdin,
            json!({
                "method":"model/list",
                "id":2,
                "params":{"includeHidden":false,"limit":100}
            }),
        )
        .map_err(|_| HostedTurnError::Failed)?;
        let response =
            wait_exact_response(&mut inbox, RpcId::Number(2.into()), &mut budget, cancelled)?;
        resolve_catalog_response(requested, &response)
    })();
    process.terminate();
    result
}

fn resolve_catalog_response(
    requested: &CodexTurnSettings,
    response: &serde_json::Value,
) -> Result<CodexTurnSettings, HostedTurnError> {
    let models = response
        .get("result")
        .and_then(|result| result.get("data"))
        .and_then(serde_json::Value::as_array)
        .ok_or(HostedTurnError::InvalidResponse)?;
    let parsed = models
        .iter()
        .take(100)
        .filter_map(parse_catalog_model)
        .collect::<Vec<_>>();
    let selected = match requested.model_policy {
        CatalogSelectionPolicy::Auto => parsed
            .iter()
            .find(|model| model.is_default)
            .or_else(|| parsed.first()),
        CatalogSelectionPolicy::Pinned => parsed
            .iter()
            .find(|model| model.model == requested.model)
            .or_else(|| parsed.iter().find(|model| model.is_default))
            .or_else(|| parsed.first()),
    }
    .ok_or(HostedTurnError::InvalidResponse)?;

    let reasoning_effort = match requested.reasoning_policy {
        CatalogSelectionPolicy::Auto => selected.default_reasoning_effort.clone(),
        CatalogSelectionPolicy::Pinned
            if selected.reasoning.contains(&requested.reasoning_effort) =>
        {
            requested.reasoning_effort.clone()
        }
        CatalogSelectionPolicy::Pinned => selected.default_reasoning_effort.clone(),
    };
    let speed = match requested.service_tier_policy {
        CatalogSelectionPolicy::Auto => selected.default_speed.clone(),
        CatalogSelectionPolicy::Pinned if selected.speeds.contains(&requested.speed) => {
            requested.speed.clone()
        }
        CatalogSelectionPolicy::Pinned => selected.default_speed.clone(),
    };
    Ok(CodexTurnSettings {
        model: selected.model.clone(),
        model_policy: requested.model_policy.clone(),
        reasoning_effort,
        reasoning_policy: requested.reasoning_policy.clone(),
        speed,
        service_tier_policy: requested.service_tier_policy.clone(),
        sandbox: requested.sandbox.clone(),
    })
}

struct CatalogModel {
    model: String,
    is_default: bool,
    default_reasoning_effort: CodexReasoningEffort,
    reasoning: Vec<CodexReasoningEffort>,
    default_speed: CodexSpeed,
    speeds: Vec<CodexSpeed>,
}

fn parse_catalog_model(value: &serde_json::Value) -> Option<CatalogModel> {
    if value.get("hidden").and_then(serde_json::Value::as_bool) == Some(true) {
        return None;
    }
    let model = value
        .get("model")
        .or_else(|| value.get("id"))?
        .as_str()?
        .trim();
    if model.is_empty()
        || model.chars().count() > 128
        || !model.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return None;
    }
    let reasoning = value
        .get("supportedReasoningEfforts")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            item.get("reasoningEffort")
                .and_then(serde_json::Value::as_str)
                .and_then(parse_reasoning_effort)
        })
        .collect::<Vec<_>>();
    let default_reasoning_effort = value
        .get("defaultReasoningEffort")
        .and_then(serde_json::Value::as_str)
        .and_then(parse_reasoning_effort)
        .filter(|effort| reasoning.is_empty() || reasoning.contains(effort))
        .or_else(|| reasoning.first().cloned())?;
    let speeds = value
        .get("serviceTiers")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            item.get("id")
                .and_then(serde_json::Value::as_str)
                .and_then(parse_speed)
        })
        .collect::<Vec<_>>();
    let default_speed = value
        .get("defaultServiceTier")
        .and_then(serde_json::Value::as_str)
        .and_then(parse_speed)
        .filter(|speed| speeds.is_empty() || speeds.contains(speed))
        .or_else(|| speeds.first().cloned())
        .unwrap_or(CodexSpeed::Standard);
    Some(CatalogModel {
        model: model.to_owned(),
        is_default: value
            .get("isDefault")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        default_reasoning_effort,
        reasoning,
        default_speed,
        speeds,
    })
}

fn parse_reasoning_effort(value: &str) -> Option<CodexReasoningEffort> {
    match value {
        "none" => Some(CodexReasoningEffort::None),
        "minimal" => Some(CodexReasoningEffort::Minimal),
        "low" => Some(CodexReasoningEffort::Low),
        "medium" => Some(CodexReasoningEffort::Medium),
        "high" => Some(CodexReasoningEffort::High),
        "xhigh" => Some(CodexReasoningEffort::Xhigh),
        "max" => Some(CodexReasoningEffort::Max),
        _ => None,
    }
}

fn parse_speed(value: &str) -> Option<CodexSpeed> {
    match value {
        "default" => Some(CodexSpeed::Standard),
        "fast" => Some(CodexSpeed::Fast),
        _ => None,
    }
}

pub fn run_hosted_turn(
    process_config: &HostedProcessConfig,
    request: &HostedTurnRequest,
    cancelled: &AtomicBool,
) -> Result<HostedTurnResult, HostedTurnError> {
    capabilities_for_version(&process_config.version)
        .map_err(|_| HostedTurnError::Compatibility)?;
    let canonical_project = canonical_project(&request.project_path)?;
    if request.input.is_empty() || request.input.chars().count() > MAX_CONTEXT_CHARS {
        return Err(HostedTurnError::InvalidResponse);
    }
    let mut arguments = process_config.extra_arguments.clone();
    arguments.extend([
        "-c".to_owned(),
        format!(
            "model_reasoning_effort=\"{}\"",
            request.settings.reasoning_label()
        ),
        "-c".to_owned(),
        format!("service_tier=\"{}\"", request.settings.service_tier()),
        "-c".to_owned(),
        format!(
            "sandbox_mode=\"{}\"",
            request.settings.sandbox_process_mode()
        ),
        "-c".to_owned(),
        "approval_policy=\"on-request\"".to_owned(),
        "-c".to_owned(),
        format!(
            "sandbox_workspace_write.network_access={}",
            request.settings.network_access()
        ),
        "app-server".to_owned(),
    ]);
    let config = AppServerProcessConfig {
        executable: process_config.executable.clone(),
        cwd: Some(canonical_project.clone()),
        arguments,
        capture_stderr: false,
    };
    let mut process = AppServerProcess::spawn(&config).map_err(|_| HostedTurnError::Start)?;
    let stdin = process.stdin();
    let line_rx = process
        .take_stdout_lines()
        .map_err(|_| HostedTurnError::Start)?;
    let mut inbox = RpcInbox::new(line_rx);
    let mut budget = ActiveTimeout::new(request.timeout);
    send_json_shared(
        &stdin,
        json!({
            "method":"initialize",
            "id":1,
            "params":{
                "clientInfo":{"name":"multaiplayer-cli","title":"multAIplayer CLI","version":env!("CARGO_PKG_VERSION")},
                "capabilities":{"experimentalApi":true}
            }
        }),
    )
    .map_err(|_| HostedTurnError::Start)?;
    wait_exact_response(&mut inbox, RpcId::Number(1.into()), &mut budget, cancelled)?;
    send_json_shared(&stdin, json!({"method":"initialized","params":{}}))
        .map_err(|_| HostedTurnError::Failed)?;
    let cwd = canonical_project
        .to_str()
        .ok_or(HostedTurnError::InvalidResponse)?;
    send_json_shared(
        &stdin,
        thread_request(
            2,
            request.previous_thread_id.as_deref(),
            cwd,
            &request.settings.model,
        ),
    )
    .map_err(|_| HostedTurnError::Failed)?;
    let thread_response =
        wait_exact_response(&mut inbox, RpcId::Number(2.into()), &mut budget, cancelled)?;
    let thread_id = thread_id_from_response(&thread_response, "thread")
        .map_err(|_| HostedTurnError::InvalidResponse)?;
    send_json_shared(
        &stdin,
        json!({
            "method":"turn/start",
            "id":3,
            "params":{
                "threadId":thread_id,
                "input":[{"type":"text","text":request.input}],
                "cwd":cwd,
                "model":request.settings.model,
                "modelReasoningEffort":request.settings.reasoning_label(),
                "serviceTier":request.settings.service_tier()
            }
        }),
    )
    .map_err(|_| HostedTurnError::Failed)?;
    let mut acknowledged = false;
    let mut assistant = String::new();
    loop {
        if cancelled.load(Ordering::Acquire) {
            process.terminate();
            return Err(HostedTurnError::Cancelled);
        }
        if budget.expired(false) {
            process.terminate();
            return Err(HostedTurnError::Timeout);
        }
        match inbox.receive(Duration::from_millis(100)) {
            Ok(RpcMessage::Response { id, value }) if id == RpcId::Number(3.into()) => {
                if value.get("error").is_some()
                    || value
                        .get("result")
                        .and_then(|result| result.get("turn"))
                        .and_then(|turn| turn.get("id"))
                        .and_then(serde_json::Value::as_str)
                        .is_none()
                {
                    return Err(HostedTurnError::InvalidResponse);
                }
                acknowledged = true;
            }
            Ok(RpcMessage::Notification { method, value }) => {
                if method.contains("agentMessage") {
                    if let Some(delta) = extract_text_delta(&value) {
                        append_bounded(&mut assistant, &delta, MAX_ASSISTANT_CHARS);
                    }
                }
                if method == "turn/completed" {
                    let status = value
                        .get("params")
                        .and_then(|params| params.get("turn"))
                        .and_then(|turn| turn.get("status"))
                        .and_then(serde_json::Value::as_str)
                        .ok_or(HostedTurnError::InvalidResponse)?;
                    if !acknowledged || status != "completed" || assistant.is_empty() {
                        return Err(HostedTurnError::Failed);
                    }
                    return Ok(HostedTurnResult {
                        thread_id,
                        assistant_message: assistant,
                    });
                }
            }
            Ok(RpcMessage::ServerRequest { .. }) => {
                process.terminate();
                return Err(HostedTurnError::PrivilegedRequestUnsupported);
            }
            Ok(RpcMessage::Response { .. }) => return Err(HostedTurnError::InvalidResponse),
            Err(error) if error == "timeout" => {}
            Err(_) => return Err(HostedTurnError::Failed),
        }
    }
}

fn wait_exact_response(
    inbox: &mut RpcInbox,
    id: RpcId,
    budget: &mut ActiveTimeout,
    cancelled: &AtomicBool,
) -> Result<serde_json::Value, HostedTurnError> {
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err(HostedTurnError::Cancelled);
        }
        if budget.expired(false) {
            return Err(HostedTurnError::Timeout);
        }
        match inbox.receive(Duration::from_millis(100)) {
            Ok(RpcMessage::Response {
                id: response_id,
                value,
            }) if response_id == id => {
                if value.get("error").is_some() {
                    return Err(HostedTurnError::Failed);
                }
                return Ok(value);
            }
            Ok(RpcMessage::ServerRequest { .. }) => {
                return Err(HostedTurnError::PrivilegedRequestUnsupported)
            }
            Ok(_) => return Err(HostedTurnError::InvalidResponse),
            Err(error) if error == "timeout" => {}
            Err(_) => return Err(HostedTurnError::Failed),
        }
    }
}

fn canonical_project(path: &Path) -> Result<PathBuf, HostedTurnError> {
    let canonical = std::fs::canonicalize(path).map_err(|_| HostedTurnError::Start)?;
    if canonical.is_dir() {
        Ok(canonical)
    } else {
        Err(HostedTurnError::Start)
    }
}

fn append_bounded(target: &mut String, value: &str, max_chars: usize) {
    let remaining = max_chars.saturating_sub(target.chars().count());
    target.extend(value.chars().take(remaining));
}

pub fn cancellation_flag() -> Arc<AtomicBool> {
    Arc::new(AtomicBool::new(false))
}

pub fn unix_seconds_from_rfc3339(value: &str) -> Option<i64> {
    if value.len() < 20 || !value.ends_with('Z') {
        return None;
    }
    let bytes = value.as_bytes();
    if bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return None;
    }
    let year = value.get(0..4)?.parse::<i64>().ok()?;
    let month = value.get(5..7)?.parse::<u32>().ok()?;
    let day = value.get(8..10)?.parse::<u32>().ok()?;
    let hour = value.get(11..13)?.parse::<u32>().ok()?;
    let minute = value.get(14..16)?.parse::<u32>().ok()?;
    let second = value.get(17..19)?.parse::<u32>().ok()?;
    let suffix = value.get(19..value.len() - 1)?;
    if (!suffix.is_empty()
        && (!suffix.starts_with('.')
            || suffix.len() == 1
            || !suffix[1..].bytes().all(|byte| byte.is_ascii_digit())))
        || !(1..=12).contains(&month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let days_this_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => return None,
    };
    if day == 0 || day > days_this_month {
        return None;
    }
    let adjusted_year = year - i64::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let adjusted_month = i64::from(month) + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days_since_epoch = era * 146_097 + day_of_era - 719_468;
    days_since_epoch
        .checked_mul(86_400)?
        .checked_add(i64::from(hour) * 3_600 + i64::from(minute) * 60 + i64::from(second))
}

pub fn proposal_expiry_from_rfc3339(created_at: &str, now_unix: i64) -> Result<i64, ProposalError> {
    let created_unix = unix_seconds_from_rfc3339(created_at).ok_or(ProposalError::Invalid)?;
    if created_unix > now_unix {
        return Err(ProposalError::Invalid);
    }
    let expires_at = created_unix
        .checked_add(PROPOSAL_TTL_SECONDS)
        .ok_or(ProposalError::Invalid)?;
    if expires_at <= now_unix {
        return Err(ProposalError::Expired);
    }
    Ok(expires_at)
}

#[cfg(test)]
mod tests {
    use super::*;
    use multaiplayer_protocol::ChatRole;
    use std::sync::atomic::AtomicBool;

    fn proposal() -> CodexProposal {
        CodexProposal {
            room_id: "room-1".into(),
            proposal_id: "proposal-1".into(),
            proposer: "Maddie".into(),
            proposer_user_id: "github:maddie".into(),
            task: "Review the bounded context".into(),
            created_at: "2026-07-19T12:00:00.000Z".into(),
            expires_at_unix: 2_000,
        }
    }

    fn chat(id: &str, role: ChatRole, body: &str) -> ChatPlaintextPayload {
        ChatPlaintextPayload {
            id: id.into(),
            author: "Maddie".into(),
            author_user_id: "github:maddie".into(),
            role,
            body: body.into(),
            time: "12:00".into(),
            created_at: Some("2026-07-19T12:00:00.000Z".into()),
            reply_to: None,
            attachments: None,
        }
    }

    #[test]
    fn proposal_binding_expiry_idempotency_and_authority_are_exact() {
        let mut machine = ProposalMachine::new("room-1").unwrap();
        assert!(machine.observe(proposal(), 1_000).unwrap());
        assert!(!machine.observe(proposal(), 1_000).unwrap());
        assert_eq!(
            machine.observe(
                CodexProposal {
                    proposal_id: "other".into(),
                    ..proposal()
                },
                1_000
            ),
            Err(ProposalError::Busy)
        );
        assert_eq!(
            machine.approve("other-room", "proposal-1", 1_000, true),
            Err(ProposalError::BindingMismatch)
        );
        assert_eq!(
            machine.approve("room-1", "proposal-1", 1_000, false),
            Err(ProposalError::NotActiveHost)
        );
        assert!(machine
            .approve("room-1", "proposal-1", 1_000, true)
            .unwrap());
        assert!(!machine
            .approve("room-1", "proposal-1", 1_000, true)
            .unwrap());
        machine.start("room-1", "proposal-1", true).unwrap();
        assert_eq!(
            machine.complete("room-1", "proposal-1", false),
            Err(ProposalError::NotActiveHost)
        );
        assert_eq!(machine.phase(), ProposalPhase::Cancelled);
        assert!(!machine.observe(proposal(), 1_000).unwrap());

        let mut expired = ProposalMachine::new("room-1").unwrap();
        assert_eq!(
            expired.observe(proposal(), 2_000),
            Err(ProposalError::Expired)
        );
    }

    #[test]
    fn one_pending_and_one_active_turn_are_enforced() {
        let mut machine = ProposalMachine::new("room-1").unwrap();
        machine.observe(proposal(), 1_000).unwrap();
        assert_eq!(
            machine.observe(
                CodexProposal {
                    proposal_id: "proposal-2".into(),
                    ..proposal()
                },
                1_000
            ),
            Err(ProposalError::Busy)
        );
        machine
            .approve("room-1", "proposal-1", 1_000, true)
            .unwrap();
        machine.start("room-1", "proposal-1", true).unwrap();
        assert_eq!(
            machine.observe(
                CodexProposal {
                    proposal_id: "proposal-3".into(),
                    ..proposal()
                },
                1_000
            ),
            Err(ProposalError::Busy)
        );
    }

    #[test]
    fn terminal_and_expired_proposals_release_the_pending_slot() {
        let mut machine = ProposalMachine::new("room-1").unwrap();
        machine.observe(proposal(), 1_000).unwrap();
        machine
            .approve("room-1", "proposal-1", 1_000, true)
            .unwrap();
        machine.start("room-1", "proposal-1", true).unwrap();
        machine.complete("room-1", "proposal-1", true).unwrap();
        assert!(machine
            .observe(
                CodexProposal {
                    proposal_id: "proposal-2".into(),
                    ..proposal()
                },
                1_000,
            )
            .unwrap());
        assert!(machine.cancel("room-1", "proposal-2").unwrap());
        assert!(machine
            .observe(
                CodexProposal {
                    proposal_id: "proposal-3".into(),
                    ..proposal()
                },
                1_000,
            )
            .unwrap());

        let mut expired = ProposalMachine::new("room-1").unwrap();
        expired.observe(proposal(), 1_000).unwrap();
        assert_eq!(
            expired.approve("room-1", "proposal-1", 2_000, true),
            Err(ProposalError::Expired)
        );
        assert!(expired
            .observe(
                CodexProposal {
                    proposal_id: "proposal-2".into(),
                    expires_at_unix: 3_000,
                    ..proposal()
                },
                2_000,
            )
            .unwrap());
    }

    #[test]
    fn auto_catalog_resolution_uses_the_effective_host_defaults() {
        let resolved = resolve_catalog_response(
            &CodexTurnSettings::default(),
            &json!({
                "result": {"data": [
                    {
                        "id": "fallback-model",
                        "isDefault": false,
                        "defaultReasoningEffort": "medium",
                        "supportedReasoningEfforts": [{"reasoningEffort":"medium"}],
                        "serviceTiers": [{"id":"default"}],
                        "defaultServiceTier":"default"
                    },
                    {
                        "id": "catalog-default",
                        "model": "effective-model",
                        "isDefault": true,
                        "defaultReasoningEffort": "high",
                        "supportedReasoningEfforts": [
                            {"reasoningEffort":"medium"},
                            {"reasoningEffort":"high"}
                        ],
                        "serviceTiers": [{"id":"default"},{"id":"fast"}],
                        "defaultServiceTier":"fast"
                    }
                ]}
            }),
        )
        .unwrap();
        assert_eq!(resolved.model, "effective-model");
        assert_eq!(resolved.reasoning_effort, CodexReasoningEffort::High);
        assert_eq!(resolved.speed, CodexSpeed::Fast);
    }

    #[test]
    fn context_is_bounded_typed_and_excludes_secrets_paths_system_and_raw_shapes() {
        let history = vec![
            chat("1", ChatRole::Human, "normal discussion"),
            chat(
                "2",
                ChatRole::System,
                "raw app-server payload accessToken=never",
            ),
            chat(
                "3",
                ChatRole::Human,
                "token=supersecret /Users/example/private.rs",
            ),
            chat("4", ChatRole::Codex, &"a".repeat(10_000)),
        ];
        let built = build_bounded_context(
            &proposal(),
            &history,
            &["Maddie".into(), "Guest".into()],
            "auto",
        )
        .unwrap();
        assert!(built.input.contains("normal discussion"));
        assert!(!built.input.contains("supersecret"));
        assert!(!built.input.contains("/Users/example"));
        assert!(!built.input.contains("accessToken"));
        assert!(!built.input.contains("raw app-server"));
        assert!(built.input.chars().count() <= MAX_CONTEXT_CHARS);
        assert!(built.extent.included_messages <= MAX_CONTEXT_MESSAGES);
    }

    #[test]
    fn trusted_preview_contains_every_required_effective_field_without_project_path() {
        let preview = HostPreview {
            proposal_id: "proposal-1".into(),
            proposer: "Maddie".into(),
            task: "Review".into(),
            room_name: "Room".into(),
            project_association: "associated on this device".into(),
            context_extent: ContextExtent {
                included_messages: 3,
                excluded_messages: 2,
                included_chars: 400,
            },
            effective_model: "gpt-5.6-sol".into(),
            service_tier: "default".into(),
            reasoning_effort: "medium".into(),
            sandbox: "workspace_write".into(),
        };
        let rendered = preview.trusted_text();
        for expected in [
            "Maddie",
            "Review",
            "3 messages",
            "gpt-5.6-sol",
            "default",
            "medium",
            "workspace_write",
        ] {
            assert!(rendered.contains(expected));
        }
        assert!(!rendered.contains("/Users/"));
    }

    #[test]
    fn cancellation_fails_before_start_without_reporting_success() {
        let cancelled = AtomicBool::new(true);
        let result = run_hosted_turn(
            &HostedProcessConfig {
                executable: "does-not-run".into(),
                version: "0.144.0".into(),
                extra_arguments: vec![],
            },
            &HostedTurnRequest {
                project_path: std::env::temp_dir(),
                input: "safe".into(),
                settings: CodexTurnSettings::default(),
                previous_thread_id: None,
                timeout: Duration::from_secs(1),
            },
            &cancelled,
        );
        assert_ne!(
            result,
            Ok(HostedTurnResult {
                thread_id: "x".into(),
                assistant_message: "success".into()
            })
        );
    }

    #[test]
    fn proposal_timestamp_expiry_is_stable_and_fail_closed() {
        assert_eq!(
            unix_seconds_from_rfc3339("1970-01-01T00:00:00.000Z"),
            Some(0)
        );
        assert_eq!(
            unix_seconds_from_rfc3339("2026-07-19T12:00:00.000Z"),
            Some(1_784_462_400)
        );
        assert_eq!(unix_seconds_from_rfc3339("2026-02-30T00:00:00Z"), None);
        assert_eq!(unix_seconds_from_rfc3339("2026-07-19 12:00:00Z"), None);

        let now = 1_784_462_400;
        assert_eq!(
            proposal_expiry_from_rfc3339("2026-07-19T12:00:00.000Z", now),
            Ok(now + PROPOSAL_TTL_SECONDS)
        );
        assert_eq!(
            proposal_expiry_from_rfc3339("2026-07-19T12:00:01.000Z", now),
            Err(ProposalError::Invalid)
        );
        assert_eq!(
            proposal_expiry_from_rfc3339("2026-07-19T11:45:00.000Z", now),
            Err(ProposalError::Expired)
        );
        assert_eq!(
            proposal_expiry_from_rfc3339("malformed", now),
            Err(ProposalError::Invalid)
        );
    }

    #[cfg(unix)]
    #[test]
    fn real_compatible_app_server_fixture_runs_initialize_thread_and_turn_contract() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = std::env::temp_dir().join(format!(
            "multaiplayer-codex-fixture-{}",
            uuid::Uuid::new_v4()
        ));
        let source = r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *\"method\":\"initialize\"*) printf '%s\n' '{"id":1,"result":{"userAgent":"fixture"}}' ;;
    *\"method\":\"model/list\"*) printf '%s\n' '{"id":2,"result":{"data":[{"id":"fixture-model","isDefault":true,"defaultReasoningEffort":"high","supportedReasoningEfforts":[{"reasoningEffort":"high"}],"serviceTiers":[{"id":"fast"}],"defaultServiceTier":"fast"}]}}' ;;
    *\"method\":\"thread/start\"*) printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-fixture"}}}' ;;
    *\"method\":\"turn/start\"*)
      printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-fixture"}}}'
      printf '%s\n' '{"method":"item/agentMessage/delta","params":{"delta":"Fixture assistant response"}}'
      printf '%s\n' '{"method":"turn/completed","params":{"turn":{"status":"completed"}}}' ;;
  esac
done
"#;
        std::fs::write(&fixture, source).unwrap();
        let mut permissions = std::fs::metadata(&fixture).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&fixture, permissions).unwrap();
        let config = HostedProcessConfig {
            executable: fixture.to_string_lossy().into_owned(),
            version: "0.144.0".into(),
            extra_arguments: vec![],
        };
        let settings = resolve_turn_settings(
            &config,
            &CodexTurnSettings::default(),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(settings.model, "fixture-model");
        assert_eq!(settings.reasoning_effort, CodexReasoningEffort::High);
        assert_eq!(settings.speed, CodexSpeed::Fast);
        let result = run_hosted_turn(
            &config,
            &HostedTurnRequest {
                project_path: std::env::temp_dir(),
                input: "bounded input".into(),
                settings,
                previous_thread_id: None,
                timeout: Duration::from_secs(5),
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(result.thread_id, "thread-fixture");
        assert_eq!(result.assistant_message, "Fixture assistant response");
        let _ = std::fs::remove_file(fixture);
    }

    #[test]
    fn interrupted_started_turn_is_terminal_after_restart_reconstruction() {
        let mut machine = ProposalMachine::new("room-1").unwrap();
        machine.observe(proposal(), 1_000).unwrap();
        machine.observe_started("room-1", "proposal-1").unwrap();
        assert_eq!(machine.phase(), ProposalPhase::Cancelled);
        assert!(!machine.observe(proposal(), 1_000).unwrap());
        assert!(!machine
            .approve("room-1", "proposal-1", 1_000, true)
            .unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn authority_cancellation_interrupts_a_live_compatible_turn_and_never_succeeds() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = std::env::temp_dir().join(format!(
            "multaiplayer-codex-cancel-fixture-{}",
            uuid::Uuid::new_v4()
        ));
        let source = r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *\"method\":\"initialize\"*) printf '%s\n' '{"id":1,"result":{}}' ;;
    *\"method\":\"thread/start\"*) printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-fixture"}}}' ;;
    *\"method\":\"turn/start\"*) printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-fixture"}}}' ;;
  esac
done
"#;
        std::fs::write(&fixture, source).unwrap();
        let mut permissions = std::fs::metadata(&fixture).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&fixture, permissions).unwrap();
        let flag = Arc::new(AtomicBool::new(false));
        let worker_flag = flag.clone();
        let worker_fixture = fixture.clone();
        let worker = std::thread::spawn(move || {
            run_hosted_turn(
                &HostedProcessConfig {
                    executable: worker_fixture.to_string_lossy().into_owned(),
                    version: "0.144.0".into(),
                    extra_arguments: vec![],
                },
                &HostedTurnRequest {
                    project_path: std::env::temp_dir(),
                    input: "bounded input".into(),
                    settings: CodexTurnSettings::default(),
                    previous_thread_id: None,
                    timeout: Duration::from_secs(5),
                },
                &worker_flag,
            )
        });
        std::thread::sleep(Duration::from_millis(150));
        flag.store(true, Ordering::Release);
        assert_eq!(worker.join().unwrap(), Err(HostedTurnError::Cancelled));
        let _ = std::fs::remove_file(fixture);
    }

    #[cfg(unix)]
    #[test]
    fn privileged_or_unknown_server_request_fails_closed_without_reflecting_payload() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = std::env::temp_dir().join(format!(
            "multaiplayer-codex-request-fixture-{}",
            uuid::Uuid::new_v4()
        ));
        let source = r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *\"method\":\"initialize\"*) printf '%s\n' '{"id":1,"result":{}}' ;;
    *\"method\":\"thread/start\"*) printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-fixture"}}}' ;;
    *\"method\":\"turn/start\"*) printf '%s\n' '{"id":99,"method":"unknown/privileged","params":{"accessToken":"never-reflect-this"}}' ;;
  esac
done
"#;
        std::fs::write(&fixture, source).unwrap();
        let mut permissions = std::fs::metadata(&fixture).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&fixture, permissions).unwrap();
        let error = run_hosted_turn(
            &HostedProcessConfig {
                executable: fixture.to_string_lossy().into_owned(),
                version: "0.144.0".into(),
                extra_arguments: vec![],
            },
            &HostedTurnRequest {
                project_path: std::env::temp_dir(),
                input: "bounded input".into(),
                settings: CodexTurnSettings::default(),
                previous_thread_id: None,
                timeout: Duration::from_secs(5),
            },
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(error, HostedTurnError::PrivilegedRequestUnsupported);
        assert!(!error.to_string().contains("never-reflect-this"));
        let _ = std::fs::remove_file(fixture);
    }
}
