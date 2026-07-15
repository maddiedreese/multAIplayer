use super::*;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};

impl MlsEngine {
    pub fn export_blob_key(&self, room_id: &str, blob_id: &[u8]) -> Result<Vec<u8>, EngineError> {
        if blob_id.is_empty() || blob_id.len() > 128 {
            return Err(EngineError::InvalidInput);
        }
        self.groups
            .get(room_id)
            .ok_or(EngineError::GroupNotFound)?
            .export_secret(b"multaiplayer blob v1", blob_id, 32)
            .map(|secret| secret.as_bytes().to_vec())
            .map_err(engine_failure(EngineErrorCategory::Crypto, "export_secret"))
    }

    pub fn encrypt_blob(
        &self,
        room_id: &str,
        blob_id: &[u8],
        plaintext: &[u8],
    ) -> Result<ExporterCiphertext, EngineError> {
        bounded(plaintext)?;
        let group = self.groups.get(room_id).ok_or(EngineError::GroupNotFound)?;
        let epoch = group.current_epoch();
        let key = self.export_blob_key(room_id, blob_id)?;
        self.group_storage
            .put_blob_key(room_id, blob_id, epoch, &key)
            .map_err(engine_failure(
                EngineErrorCategory::Crypto,
                "encrypt_export",
            ))?;
        seal_exporter(&key, epoch, blob_aad(room_id, blob_id, epoch), plaintext)
    }
    pub fn prepare_blob(&self, room_id: &str, blob_id: &[u8]) -> Result<u64, EngineError> {
        let group = self.groups.get(room_id).ok_or(EngineError::GroupNotFound)?;
        let epoch = group.current_epoch();
        let key = self.export_blob_key(room_id, blob_id)?;
        self.group_storage
            .put_blob_key(room_id, blob_id, epoch, &key)
            .map_err(engine_failure(
                EngineErrorCategory::Crypto,
                "decrypt_export",
            ))?;
        Ok(epoch)
    }
    pub fn encrypt_history(
        &self,
        room_id: &str,
        plaintext: &[u8],
    ) -> Result<ExporterCiphertext, EngineError> {
        bounded(plaintext)?;
        let group = self.groups.get(room_id).ok_or(EngineError::GroupNotFound)?;
        let epoch = group.current_epoch();
        let key = self
            .group_storage
            .history_secret(room_id, epoch)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_history_secret",
            ))?
            .ok_or(EngineError::GroupNotFound)?;
        seal_exporter(&key, epoch, history_aad(room_id, epoch), plaintext)
    }
    pub fn decrypt_history(
        &self,
        room_id: &str,
        value: &ExporterCiphertext,
    ) -> Result<Vec<u8>, EngineError> {
        if value.version != 1 || !self.groups.contains_key(room_id) {
            return Err(EngineError::InvalidInput);
        }
        let key = self
            .group_storage
            .history_secret(room_id, value.epoch)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_history_secret",
            ))?
            .ok_or(EngineError::GroupNotFound)?;
        open_exporter(&key, history_aad(room_id, value.epoch), value)
    }
    pub fn set_history_retention(
        &self,
        room_id: &str,
        retention_days: u16,
    ) -> Result<(), EngineError> {
        if !self.groups.contains_key(room_id) {
            return Err(EngineError::GroupNotFound);
        }
        self.group_storage
            .set_history_retention(room_id, retention_days)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "set_history_retention",
            ))
    }

    pub fn history_retention_days(&self, room_id: &str) -> Result<u16, EngineError> {
        if !self.groups.contains_key(room_id) {
            return Err(EngineError::GroupNotFound);
        }
        self.group_storage
            .history_retention_days(room_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_history_retention",
            ))
    }

    pub fn forget_history_epoch(&self, room_id: &str, epoch: u64) -> Result<(), EngineError> {
        if !self.groups.contains_key(room_id) {
            return Err(EngineError::GroupNotFound);
        }
        self.group_storage
            .delete_history_epoch(room_id, epoch)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "delete_history_epoch",
            ))
    }
    pub fn forget_history(&self, room_id: &str) -> Result<(), EngineError> {
        if !self.groups.contains_key(room_id) {
            return Err(EngineError::GroupNotFound);
        }
        self.group_storage
            .delete_history_records(room_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "delete_room_history",
            ))
    }

    pub fn prune_expired_material(&self, room_id: &str) -> Result<(), EngineError> {
        if !self.groups.contains_key(room_id) {
            return Err(EngineError::GroupNotFound);
        }
        self.group_storage
            .prune_expired_material(room_id)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "prune_history",
            ))
    }
    pub fn decrypt_blob(
        &self,
        room_id: &str,
        blob_id: &[u8],
        value: &ExporterCiphertext,
    ) -> Result<Vec<u8>, EngineError> {
        if value.version != 1 || !self.groups.contains_key(room_id) {
            return Err(EngineError::InvalidInput);
        }
        let key = self
            .group_storage
            .blob_key(room_id, blob_id, value.epoch)
            .map_err(engine_failure(
                EngineErrorCategory::Storage,
                "load_history_secret",
            ))?
            .ok_or(EngineError::GroupNotFound)?;
        open_exporter(&key, blob_aad(room_id, blob_id, value.epoch), value)
    }
}

pub(super) fn history_secret_for_group(group: &AppGroup) -> Result<Vec<u8>, EngineError> {
    group
        .export_secret(b"multaiplayer history v1", b"", 32)
        .map(|secret| secret.as_bytes().to_vec())
        .map_err(engine_failure(
            EngineErrorCategory::Crypto,
            "derive_history_secret",
        ))
}
fn blob_aad(room: &str, blob: &[u8], epoch: u64) -> Vec<u8> {
    let mut out = b"multaiplayer:blob:v1\0".to_vec();
    out.extend_from_slice(&(room.len() as u16).to_be_bytes());
    out.extend_from_slice(room.as_bytes());
    out.extend_from_slice(&(blob.len() as u16).to_be_bytes());
    out.extend_from_slice(blob);
    out.extend_from_slice(&epoch.to_be_bytes());
    out
}
fn history_aad(room: &str, epoch: u64) -> Vec<u8> {
    let mut out = b"multaiplayer:history:v1\0".to_vec();
    out.extend_from_slice(&(room.len() as u16).to_be_bytes());
    out.extend_from_slice(room.as_bytes());
    out.extend_from_slice(&epoch.to_be_bytes());
    out
}
fn seal_exporter(
    key: &[u8],
    epoch: u64,
    aad: Vec<u8>,
    plaintext: &[u8],
) -> Result<ExporterCiphertext, EngineError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(engine_failure(
        EngineErrorCategory::Crypto,
        "initialize_export_cipher",
    ))?;
    let mut nonce = vec![0u8; 12];
    rand::fill(&mut nonce[..]);
    let nonce_array = Nonce::try_from(nonce.as_slice()).map_err(|_| EngineError::InvalidInput)?;
    let ciphertext = cipher
        .encrypt(
            &nonce_array,
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(engine_failure(
            EngineErrorCategory::Crypto,
            "encrypt_export_payload",
        ))?;
    Ok(ExporterCiphertext {
        version: 1,
        epoch,
        nonce,
        ciphertext,
    })
}
fn open_exporter(
    key: &[u8],
    aad: Vec<u8>,
    value: &ExporterCiphertext,
) -> Result<Vec<u8>, EngineError> {
    if value.nonce.len() != 12 {
        return Err(EngineError::InvalidInput);
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(engine_failure(
        EngineErrorCategory::Crypto,
        "initialize_export_cipher",
    ))?;
    let nonce = Nonce::try_from(value.nonce.as_slice()).map_err(|_| EngineError::InvalidInput)?;
    cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &value.ciphertext,
                aad: &aad,
            },
        )
        .map_err(engine_failure(
            EngineErrorCategory::Crypto,
            "decrypt_export_payload",
        ))
}
