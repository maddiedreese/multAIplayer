use age::secrecy::SecretString;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};

use super::{ArchiveBody, ArchiveEnvelope, ARCHIVE_VERSION, MAX_ARCHIVE_BYTES};

const MAX_PLAINTEXT_BYTES: usize = 12 * 1024 * 1024;
const MIN_PASSPHRASE_BYTES: usize = 12;

pub(super) fn seal_archive(mut archive: ArchiveBody, passphrase: &str) -> Result<Vec<u8>, String> {
    validate_passphrase(passphrase)?;
    normalize_and_validate(&mut archive)?;
    let envelope = ArchiveEnvelope {
        payload_sha256: archive_hash(&archive)?,
        body: archive,
    };
    let plaintext =
        serde_json::to_vec(&envelope).map_err(|_| "Archive could not be encoded.".to_string())?;
    if plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err("Archive exceeds the 12 MiB plaintext limit.".to_string());
    }
    let encryptor = age::Encryptor::with_user_passphrase(SecretString::from(passphrase.to_owned()));
    let mut encrypted = Vec::new();
    let mut writer = encryptor
        .wrap_output(&mut encrypted)
        .map_err(|_| "Archive encryption failed.".to_string())?;
    writer
        .write_all(&plaintext)
        .map_err(|_| "Archive encryption failed.".to_string())?;
    writer
        .finish()
        .map_err(|_| "Archive encryption failed.".to_string())?;
    if encrypted.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err("Encrypted archive exceeds the 16 MiB limit.".to_string());
    }
    Ok(encrypted)
}

pub(super) fn open_archive_bytes(
    encrypted: &[u8],
    passphrase: &str,
) -> Result<ArchiveBody, String> {
    validate_passphrase(passphrase)?;
    if encrypted.is_empty() || encrypted.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err("Archive is empty or exceeds the 16 MiB limit.".to_string());
    }
    let decryptor =
        age::Decryptor::new(encrypted).map_err(|_| "Archive format is invalid.".to_string())?;
    let identity = age::scrypt::Identity::new(SecretString::from(passphrase.to_owned()));
    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|_| "Archive passphrase is incorrect or the file was modified.".to_string())?;
    let mut plaintext = Vec::new();
    reader
        .by_ref()
        .take((MAX_PLAINTEXT_BYTES + 1) as u64)
        .read_to_end(&mut plaintext)
        .map_err(|_| "Archive passphrase is incorrect or the file was modified.".to_string())?;
    if plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err("Archive exceeds the 12 MiB plaintext limit.".to_string());
    }
    let mut envelope: ArchiveEnvelope = serde_json::from_slice(&plaintext)
        .map_err(|_| "Archive payload is invalid.".to_string())?;
    normalize_and_validate(&mut envelope.body)?;
    let digest = archive_hash(&envelope.body)?;
    if digest != envelope.payload_sha256 {
        return Err("Archive integrity check failed.".to_string());
    }
    Ok(envelope.body)
}

fn normalize_and_validate(archive: &mut ArchiveBody) -> Result<(), String> {
    if archive.version != ARCHIVE_VERSION {
        return Err(format!(
            "Unsupported room archive version {}.",
            archive.version
        ));
    }
    archive.source.room_name = bounded_text(&archive.source.room_name, "room name", 200)?;
    archive.source.team_name = archive
        .source
        .team_name
        .as_deref()
        .map(|value| bounded_text(value, "team name", 200))
        .transpose()?;
    if archive.exported_at.len() > 64
        || chrono::DateTime::parse_from_rfc3339(&archive.exported_at).is_err()
    {
        return Err("Archive export timestamp is invalid.".to_string());
    }
    if archive.omissions.is_empty() || archive.omissions.len() > 32 {
        return Err("Archive omission manifest is invalid.".to_string());
    }
    for omission in &archive.omissions {
        bounded_text(omission, "omission", 160)?;
    }
    if archive.history.version != 1 {
        return Err("Unsupported archive history version.".to_string());
    }
    let history = serde_json::to_value(&archive.history)
        .map_err(|_| "Archive history could not be validated.".to_string())?;
    validate_json_shape(&history, 0, &mut 0)?;
    Ok(())
}

fn validate_json_shape(value: &Value, depth: usize, nodes: &mut usize) -> Result<(), String> {
    *nodes += 1;
    if depth > 16 || *nodes > 100_000 {
        return Err("Archive history is too deeply nested or complex.".to_string());
    }
    match value {
        Value::String(text) if text.len() > 2 * 1024 * 1024 => {
            Err("Archive contains an oversized text value.".to_string())
        }
        Value::Array(values) if values.len() > 20_000 => {
            Err("Archive contains too many list entries.".to_string())
        }
        Value::Array(values) => values
            .iter()
            .try_for_each(|value| validate_json_shape(value, depth + 1, nodes)),
        Value::Object(values) if values.len() > 128 => {
            Err("Archive contains an oversized object.".to_string())
        }
        Value::Object(values) => values
            .values()
            .try_for_each(|value| validate_json_shape(value, depth + 1, nodes)),
        _ => Ok(()),
    }
}

fn archive_hash(archive: &ArchiveBody) -> Result<String, String> {
    let encoded =
        serde_json::to_vec(archive).map_err(|_| "Archive could not be hashed.".to_string())?;
    Ok(format!("{:x}", Sha256::digest(encoded)))
}

pub(super) fn validate_passphrase(passphrase: &str) -> Result<(), String> {
    if passphrase.len() < MIN_PASSPHRASE_BYTES || passphrase.len() > 1024 {
        return Err("Archive passphrase must be between 12 and 1024 bytes.".to_string());
    }
    Ok(())
}

fn bounded_text(value: &str, label: &str, max: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(format!("Archive {label} is invalid."));
    }
    Ok(value.to_string())
}
