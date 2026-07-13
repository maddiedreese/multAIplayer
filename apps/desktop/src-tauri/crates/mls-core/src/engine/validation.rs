use super::*;

pub(super) fn initialize_group_schema(
    connection: &rusqlite::Connection,
) -> Result<(), EngineError> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS mls_group (group_id BLOB PRIMARY KEY, snapshot BLOB NOT NULL) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS epoch (group_id BLOB, epoch_id INTEGER, epoch_data BLOB NOT NULL, PRIMARY KEY(group_id, epoch_id)) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS kvs (key TEXT PRIMARY KEY, value BLOB NOT NULL) WITHOUT ROWID;",
        )
        .map_err(engine_failure(EngineErrorCategory::Protocol, "read_member_credential"))
}

pub(super) fn member_credential(
    member: &mls_rs::group::Member,
) -> Result<BasicAppCredential, EngineError> {
    let basic = member
        .signing_identity()
        .credential
        .as_basic()
        .ok_or(EngineError::InvalidInput)?;
    validate_credential(basic.identifier()).map_err(engine_failure(
        EngineErrorCategory::Protocol,
        "validate_member_credential",
    ))?;
    serde_json::from_slice(basic.identifier()).map_err(engine_failure(
        EngineErrorCategory::Serialization,
        "decode_member_credential",
    ))
}

pub(super) fn roster_credential(
    group: &AppGroup,
    leaf: u32,
) -> Result<BasicAppCredential, EngineError> {
    let member = group
        .roster()
        .member_with_index(leaf)
        .map_err(engine_failure(
            EngineErrorCategory::Protocol,
            "read_roster_member",
        ))?;
    member_credential(&member)
}

pub(super) fn bounded(bytes: &[u8]) -> Result<(), EngineError> {
    if bytes.is_empty() || bytes.len() > MAX_MESSAGE {
        Err(EngineError::InvalidInput)
    } else {
        Ok(())
    }
}
pub(super) fn valid_room(value: &str) -> Result<(), EngineError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
    {
        Err(EngineError::InvalidInput)
    } else {
        Ok(())
    }
}

pub(super) fn valid_authenticated_text(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && value.bytes().all(|byte| !byte.is_ascii_control())
}
