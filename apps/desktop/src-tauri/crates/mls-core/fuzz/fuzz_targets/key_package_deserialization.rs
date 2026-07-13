#![no_main]

use base64::{engine::general_purpose::STANDARD, Engine};
use libfuzzer_sys::fuzz_target;
use mls_core::{
    validate_credential, validate_key_package_document, validate_key_package_upload,
    KeyPackageUpload,
};

fuzz_target!(|data: &[u8]| {
    // Exercise the exact bounded JSON-to-validation function used by the CLI,
    // plus the inner credential and RFC 9420 parsing paths for arbitrary bytes.
    let _ = validate_key_package_document(data);
    let _ = validate_credential(data);
    let _ = validate_key_package_upload(&KeyPackageUpload {
        key_package: STANDARD.encode(data),
        uploader_github_user_id: "github:fuzzer".into(),
        uploader_device_id: "device-fuzzer".into(),
    });
});
