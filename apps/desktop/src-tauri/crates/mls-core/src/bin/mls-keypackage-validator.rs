use mls_core::{validate_key_package_upload, KeyPackageUpload};
use std::io::{self, Read};

const MAX_STDIN: u64 = 384 * 1024;

fn main() {
    if let Err(message) = run() {
        eprintln!("{message}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), &'static str> {
    let mut bytes = Vec::new();
    io::stdin()
        .take(MAX_STDIN + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "failed to read upload")?;
    if bytes.len() as u64 > MAX_STDIN {
        return Err("upload exceeds validator input limit");
    }
    let upload: KeyPackageUpload =
        serde_json::from_slice(&bytes).map_err(|_| "invalid upload JSON")?;
    let validated =
        validate_key_package_upload(&upload).map_err(|_| "invalid KeyPackage upload")?;
    serde_json::to_writer(io::stdout(), &validated)
        .map_err(|_| "failed to write validation result")?;
    Ok(())
}
