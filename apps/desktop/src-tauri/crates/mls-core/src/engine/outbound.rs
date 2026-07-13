use super::*;

impl MlsEngine {
    pub(super) fn stage_current_history_secret(
        staged: &StagedWriteGuard,
        room_id: &str,
        group: &AppGroup,
    ) -> Result<(), EngineError> {
        staged
            .stage_history_secret(
                room_id,
                group.current_epoch(),
                history_secret_for_group(group)?,
            )
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "stage_outbox_item",
            ))
    }

    pub(super) fn persist_outbound_with_metadata(
        storage: &AtomicGroupStateStorage,
        group: &mut AppGroup,
        room_id: &str,
        epoch: u64,
        kind: &str,
        payload: Vec<u8>,
        metadata: Option<Vec<u8>>,
    ) -> Result<String, EngineError> {
        let id = format!("{:x}", Sha256::digest(&payload));
        Self::persist_outbound_with_id(storage, group, room_id, epoch, kind, payload, metadata, id)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn persist_outbound_with_id(
        storage: &AtomicGroupStateStorage,
        group: &mut AppGroup,
        room_id: &str,
        epoch: u64,
        kind: &str,
        payload: Vec<u8>,
        metadata: Option<Vec<u8>>,
        id: String,
    ) -> Result<String, EngineError> {
        let staged = storage.staged_write();
        staged
            .stage_outbox(OutboxItem {
                id: id.clone(),
                room_id: room_id.to_owned(),
                epoch,
                kind: kind.to_owned(),
                payload,
                metadata,
            })
            .map_err(engine_failure(
                EngineErrorCategory::Protocol,
                "clear_pending_commit",
            ))?;
        group.write_to_storage().map_err(engine_failure(
            EngineErrorCategory::Storage,
            "write_group_state",
        ))?;
        Ok(id)
    }
}

pub(super) fn stage_outbox_with_metadata(
    staged: &StagedWriteGuard,
    room_id: &str,
    epoch: u64,
    kind: &str,
    payload: Vec<u8>,
    metadata: Option<Vec<u8>>,
) -> Result<String, EngineError> {
    let id = format!("{:x}", Sha256::digest(&payload));
    staged
        .stage_outbox(OutboxItem {
            id: id.clone(),
            room_id: room_id.to_owned(),
            epoch,
            kind: kind.to_owned(),
            payload,
            metadata,
        })
        .map_err(engine_failure(
            EngineErrorCategory::Serialization,
            "encode_outbox_metadata",
        ))?;
    Ok(id)
}
