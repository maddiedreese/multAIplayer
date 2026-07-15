use super::*;

impl MlsEngine {
    pub fn roster(&self, room_id: &str) -> Result<Vec<RosterMember>, EngineError> {
        self.groups
            .get(room_id)
            .ok_or(EngineError::GroupNotFound)?
            .roster()
            .members_iter()
            .map(|member| {
                Ok(RosterMember {
                    leaf: member.index,
                    credential: member_credential(&member)?,
                })
            })
            .collect()
    }

    pub fn self_leaf(&self, room_id: &str) -> Result<u32, EngineError> {
        Ok(self
            .groups
            .get(room_id)
            .ok_or(EngineError::GroupNotFound)?
            .current_member_index())
    }

    pub fn current_epoch(&self, room_id: &str) -> Result<u64, EngineError> {
        Ok(self
            .groups
            .get(room_id)
            .ok_or(EngineError::GroupNotFound)?
            .current_epoch())
    }

    pub fn host_context(&self, room_id: &str) -> Result<HostContext, EngineError> {
        self.hosts
            .get(room_id)
            .cloned()
            .ok_or(EngineError::GroupNotFound)
    }

    pub(super) fn ensure_host(&self, room_id: &str) -> Result<(), EngineError> {
        let host = self.hosts.get(room_id).ok_or(EngineError::NotHost)?;
        let group = self.groups.get(room_id).ok_or(EngineError::GroupNotFound)?;
        if host.host_device_id != self.self_device_id
            || group.current_member_index() != host.host_leaf
        {
            return Err(EngineError::NotHost);
        }
        Ok(())
    }

    pub(super) fn ensure_application_outbox_drained(
        &self,
        room_id: &str,
    ) -> Result<(), EngineError> {
        if self
            .group_storage
            .has_room_outbox_kind(room_id, "application")
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "check_application_outbox",
            ))?
        {
            Err(EngineError::InvalidInput)
        } else {
            Ok(())
        }
    }
}
