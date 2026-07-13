#![no_main]

use base64::{engine::general_purpose::STANDARD, Engine};
use libfuzzer_sys::fuzz_target;
use mls_core::{validate_credential, validate_key_package_upload, KeyPackageUpload};

fuzz_target!(|data: &[u8]| {
    // Exercise both the bounded application credential decoder and the genuine
    // RFC 9420 MLSMessage::from_bytes path used for attacker-supplied uploads.
    let _ = validate_credential(data);
    let _ = validate_key_package_upload(&KeyPackageUpload {
        key_package: STANDARD.encode(data),
        uploader_github_user_id: "github:fuzzer".into(),
        uploader_device_id: "device-fuzzer".into(),
    });
});
