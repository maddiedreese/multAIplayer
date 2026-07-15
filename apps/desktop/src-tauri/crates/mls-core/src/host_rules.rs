use crate::{
    validate_credential, validate_host_commit, BasicAppCredential, HostContext,
    HOST_CONTEXT_EXTENSION_TYPE,
};
use mls_rs::{
    extension::ExtensionType,
    group::{GroupContext, Roster},
    mls_rules::{CommitDirection, CommitOptions, CommitSource, EncryptionOptions, ProposalBundle},
    ExtensionList, MlsRules,
};
use thiserror::Error;

#[derive(Clone, Debug, Default)]
pub(crate) struct HostRules;

#[derive(Debug, Error)]
#[error("invalid authenticated host authority")]
pub(crate) struct HostRuleError;

pub(crate) fn host_extension(host: &HostContext) -> Result<ExtensionList, HostRuleError> {
    let data = serde_json::to_vec(host).map_err(|_| HostRuleError)?;
    Ok(core::iter::once(mls_rs::Extension::new(
        ExtensionType::new(HOST_CONTEXT_EXTENSION_TYPE),
        data,
    ))
    .collect())
}

pub(crate) fn host_from_extensions(
    extensions: &ExtensionList,
) -> Result<HostContext, HostRuleError> {
    let extension = extensions
        .iter()
        .find(|value| value.extension_type.raw_value() == HOST_CONTEXT_EXTENSION_TYPE)
        .ok_or(HostRuleError)?;
    let host: HostContext =
        serde_json::from_slice(&extension.extension_data).map_err(|_| HostRuleError)?;
    if validate_host_commit(host.host_leaf, &host).is_err() {
        return Err(HostRuleError);
    }
    Ok(host)
}

fn credential_at(roster: &Roster<'_>, leaf: u32) -> Result<BasicAppCredential, HostRuleError> {
    let member = roster.member_with_index(leaf).map_err(|_| HostRuleError)?;
    let bytes = member
        .signing_identity()
        .credential
        .as_basic()
        .ok_or(HostRuleError)?
        .identifier();
    validate_credential(bytes).map_err(|_| HostRuleError)?;
    serde_json::from_slice(bytes).map_err(|_| HostRuleError)
}

pub(crate) fn validate_host(
    roster: &Roster<'_>,
    extensions: &ExtensionList,
) -> Result<HostContext, HostRuleError> {
    let host = host_from_extensions(extensions)?;
    if credential_at(roster, host.host_leaf)?.device_id != host.host_device_id {
        return Err(HostRuleError);
    }
    Ok(host)
}

impl mls_rs::error::IntoAnyError for HostRuleError {}

impl MlsRules for HostRules {
    type Error = HostRuleError;

    fn filter_proposals(
        &self,
        _direction: CommitDirection,
        source: CommitSource,
        current_roster: &Roster,
        current_context: &GroupContext,
        proposals: ProposalBundle,
    ) -> Result<ProposalBundle, Self::Error> {
        let host = validate_host(current_roster, &current_context.extensions)?;
        match source {
            CommitSource::ExistingMember(member) if member.index == host.host_leaf => {}
            _ => return Err(HostRuleError),
        }
        if let Some(change) = proposals.group_context_ext_proposals().first() {
            validate_host(current_roster, &change.proposal)?;
        }
        Ok(proposals)
    }

    fn commit_options(
        &self,
        roster: &Roster,
        context: &GroupContext,
        _: &ProposalBundle,
    ) -> Result<CommitOptions, Self::Error> {
        validate_host(roster, &context.extensions)?;
        Ok(CommitOptions::default())
    }

    fn encryption_options(
        &self,
        _: &Roster,
        _: &GroupContext,
    ) -> Result<EncryptionOptions, Self::Error> {
        Ok(EncryptionOptions::default())
    }
}
