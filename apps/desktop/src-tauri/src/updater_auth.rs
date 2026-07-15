use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use serde::Deserialize;
use std::{collections::HashMap, fmt};
use tauri_plugin_updater::{ReleaseManifestPlatform, RemoteRelease};

const ENVELOPE_SCHEMA: &str = "multaiplayer-updater-envelope-v1";
const PAYLOAD_SCHEMA: &str = "multaiplayer-updater-metadata-v1";
const SUPPORTED_TARGET: &str = "darwin-aarch64";
const PUBLIC_KEY: &str = include_str!("../updater-public.key");

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct MetadataEnvelope {
    schema: String,
    payload: String,
    signature: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthenticatedMetadata {
    schema: String,
    version: String,
    url: String,
    archive_signature: String,
    notes: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct StaticManifest {
    version: String,
    notes: String,
    platforms: HashMap<String, ReleaseManifestPlatform>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MetadataVerificationError;

impl fmt::Display for MetadataVerificationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("updater metadata authentication failed")
    }
}

impl std::error::Error for MetadataVerificationError {}

fn public_key() -> Result<PublicKey, MetadataVerificationError> {
    let decoded = STANDARD
        .decode(PUBLIC_KEY.trim())
        .map_err(|_| MetadataVerificationError)?;
    let key_text = std::str::from_utf8(&decoded).map_err(|_| MetadataVerificationError)?;
    PublicKey::decode(key_text).map_err(|_| MetadataVerificationError)
}

fn signature(encoded: &str) -> Result<Signature, MetadataVerificationError> {
    let decoded = STANDARD
        .decode(encoded.trim())
        .map_err(|_| MetadataVerificationError)?;
    let signature_text = std::str::from_utf8(&decoded).map_err(|_| MetadataVerificationError)?;
    Signature::decode(signature_text).map_err(|_| MetadataVerificationError)
}

fn verify_metadata_binding(
    notes: &str,
    version: &str,
    url: &str,
    archive_signature: &str,
) -> Result<String, MetadataVerificationError> {
    let envelope: MetadataEnvelope =
        serde_json::from_str(notes).map_err(|_| MetadataVerificationError)?;
    if envelope.schema != ENVELOPE_SCHEMA {
        return Err(MetadataVerificationError);
    }
    let signature = signature(&envelope.signature)?;
    public_key()?
        .verify(envelope.payload.as_bytes(), &signature, false)
        .map_err(|_| MetadataVerificationError)?;

    let metadata: AuthenticatedMetadata =
        serde_json::from_str(&envelope.payload).map_err(|_| MetadataVerificationError)?;
    if metadata.schema != PAYLOAD_SCHEMA
        || metadata.version != version
        || metadata.url != url
        || metadata.archive_signature != archive_signature
        || metadata.notes.is_empty()
        || metadata.notes.len() > 240
        || metadata.notes.chars().any(char::is_control)
    {
        return Err(MetadataVerificationError);
    }
    Ok(metadata.notes)
}

pub fn authenticated_update_is_newer(current: Version, release: RemoteRelease) -> bool {
    if release.version <= current {
        return false;
    }
    let Some(notes) = release.notes.as_deref() else {
        return false;
    };
    let Ok(url) = release.download_url(SUPPORTED_TARGET) else {
        return false;
    };
    let Ok(archive_signature) = release.signature(SUPPORTED_TARGET) else {
        return false;
    };
    verify_metadata_binding(
        notes,
        &release.version.to_string(),
        url.as_str(),
        archive_signature,
    )
    .is_ok()
}

pub fn verify_published_manifest(
    manifest_json: &str,
    archive: &[u8],
) -> Result<(), MetadataVerificationError> {
    let manifest: StaticManifest =
        serde_json::from_str(manifest_json).map_err(|_| MetadataVerificationError)?;
    let platform = manifest
        .platforms
        .get(SUPPORTED_TARGET)
        .ok_or(MetadataVerificationError)?;
    verify_metadata_binding(
        &manifest.notes,
        &manifest.version,
        platform.url.as_str(),
        &platform.signature,
    )?;
    let archive_signature = signature(&platform.signature)?;
    public_key()?
        .verify(archive, &archive_signature, false)
        .map_err(|_| MetadataVerificationError)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_updater::RemoteReleaseInner;

    const FIXTURE_PAYLOAD: &str = include_str!("../test-fixtures/updater-metadata-payload.json");
    const FIXTURE_SIGNATURE: &str =
        include_str!("../test-fixtures/updater-metadata-payload.json.sig");
    const FIXTURE_ARCHIVE_SIGNATURE: &str =
        "fixture-archive-signature-not-used-for-bundle-verification";
    const FIXTURE_URL: &str = "https://github.com/maddiedreese/multAIplayer/releases/download/v0.1.1-alpha.0/multAIplayer-macos-arm64.app.tar.gz";

    fn notes(payload: &str) -> String {
        serde_json::json!({
            "schema": ENVELOPE_SCHEMA,
            "payload": payload,
            "signature": FIXTURE_SIGNATURE,
        })
        .to_string()
    }

    fn release(version: &str, url: &str, payload: &str) -> RemoteRelease {
        RemoteRelease {
            version: Version::parse(version).unwrap(),
            notes: Some(notes(payload)),
            pub_date: None,
            data: RemoteReleaseInner::Static {
                platforms: HashMap::from([(
                    SUPPORTED_TARGET.to_string(),
                    ReleaseManifestPlatform {
                        url: url.parse().unwrap(),
                        signature: FIXTURE_ARCHIVE_SIGNATURE.to_string(),
                    },
                )]),
            },
        }
    }

    #[test]
    fn accepts_valid_authenticated_metadata_for_a_strictly_newer_release() {
        assert!(authenticated_update_is_newer(
            Version::parse("0.1.0-alpha.0").unwrap(),
            release("0.1.1-alpha.0", FIXTURE_URL, FIXTURE_PAYLOAD),
        ));
    }

    #[test]
    fn rejects_tampered_signed_payload_or_bound_archive_url() {
        let tampered_payload =
            FIXTURE_PAYLOAD.replace("Authenticated fixture notes.", "Tampered notes.");
        assert!(!authenticated_update_is_newer(
            Version::parse("0.1.0-alpha.0").unwrap(),
            release("0.1.1-alpha.0", FIXTURE_URL, &tampered_payload),
        ));
        assert!(!authenticated_update_is_newer(
            Version::parse("0.1.0-alpha.0").unwrap(),
            release(
                "0.1.1-alpha.0",
                "https://github.com/maddiedreese/multAIplayer/releases/download/v0.1.0-alpha.0/older.app.tar.gz",
                FIXTURE_PAYLOAD,
            ),
        ));
    }

    #[test]
    fn rejects_version_relabeling_and_non_increasing_versions() {
        assert!(!authenticated_update_is_newer(
            Version::parse("0.1.0-alpha.0").unwrap(),
            release("999.0.0", FIXTURE_URL, FIXTURE_PAYLOAD),
        ));
        assert!(!authenticated_update_is_newer(
            Version::parse("0.1.1-alpha.0").unwrap(),
            release("0.1.1-alpha.0", FIXTURE_URL, FIXTURE_PAYLOAD),
        ));
    }
}
