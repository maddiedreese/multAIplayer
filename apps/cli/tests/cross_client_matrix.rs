use std::{path::Path, process::Command};

#[test]
fn required_desktop_cli_interoperability_matrix_executes() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repository = manifest
        .parent()
        .and_then(Path::parent)
        .expect("CLI workspace must remain inside the repository");
    let script = repository.join("e2e/cross-client/matrix.ts");
    let output = Command::new("node")
        .args(["--import", "tsx"])
        .arg(script)
        .current_dir(repository)
        .env(
            "MULTAIPLAYER_CLI_INTEROP_BINARY",
            env!("CARGO_BIN_EXE_cli-interoperability-client"),
        )
        .output()
        .expect("cross-client matrix must execute rather than skip");
    assert!(
        output.status.success(),
        "cross-client matrix failed; stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("Mixed-client matrix passed"),
        "cross-client matrix did not report complete evidence"
    );
}
