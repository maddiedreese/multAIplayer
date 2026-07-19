use super::*;

impl MlsEngine {
    pub fn open_group(&mut self, room_id: &str) -> Result<u64, EngineError> {
        valid_room(room_id)?;
        let stored = self
            .group_storage
            .has_group_snapshot(room_id.as_bytes())
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "check_group_snapshot",
            ))?;
        let group = self
            .client
            .load_group(room_id.as_bytes())
            .map_err(|cause| {
                if stored {
                    EngineError::requires_rejoin("load_group", cause)
                } else {
                    EngineError::GroupNotFound
                }
            })?;
        let host =
            validate_host(&group.roster(), &group.context().extensions).map_err(engine_failure(
                EngineErrorCategory::Protocol,
                "validate_stored_host_context",
            ))?;
        let epoch = group.current_epoch();
        self.hosts.insert(room_id.into(), host);
        self.groups.insert(room_id.into(), group);
        Ok(epoch)
    }

    pub fn forget_corrupt_group(&mut self, room_id: &str) -> Result<(), EngineError> {
        if !matches!(self.open_group(room_id), Err(error) if error.is_requires_rejoin()) {
            return Err(EngineError::InvalidInput);
        }
        self.group_storage
            .delete_corrupt_group_records(room_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "delete_corrupt_group",
            ))?;
        self.clear_room_cache(room_id);
        Ok(())
    }

    /// Atomically and idempotently deletes all durable state scoped to one
    /// validated room. Global identity material and sibling rooms are outside
    /// the storage transaction. In-memory authority is cleared only after the
    /// durable transaction succeeds.
    pub fn forget_group(&mut self, room_id: &str) -> Result<(), EngineError> {
        valid_room(room_id)?;
        self.group_storage
            .delete_room_records(room_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "delete_room_records",
            ))?;
        self.clear_room_cache(room_id);
        Ok(())
    }

    fn clear_room_cache(&mut self, room_id: &str) {
        self.groups.remove(room_id);
        self.hosts.remove(room_id);
        self.pending_hosts.remove(room_id);
    }
}
