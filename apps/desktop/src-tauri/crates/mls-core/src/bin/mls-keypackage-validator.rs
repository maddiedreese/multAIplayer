use mls_core::{validate_key_package_document, MAX_KEY_PACKAGE_UPLOAD_BYTES};
use std::io::{self, Read};

fn main() {
    if let Err(message) = run() {
        eprintln!("{message}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), &'static str> {
    let mut bytes = Vec::new();
    io::stdin()
        .take(MAX_KEY_PACKAGE_UPLOAD_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "failed to read upload")?;
    if bytes.len() > MAX_KEY_PACKAGE_UPLOAD_BYTES {
        return Err("upload exceeds validator input limit");
    }
    let validated =
        validate_key_package_document(&bytes).map_err(|_| "invalid KeyPackage upload")?;
    serde_json::to_writer(io::stdout(), &validated)
        .map_err(|_| "failed to write validation result")?;
    Ok(())
}
