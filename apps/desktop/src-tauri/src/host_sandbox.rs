#[cfg(target_os = "macos")]
use std::path::Path;
use std::process::Command;

pub(crate) fn sandboxed_shell_command(
    shell: &str,
    workspace: &str,
    command: &str,
) -> Result<Command, String> {
    #[cfg(target_os = "macos")]
    {
        let profile = macos_profile(workspace);
        let mut process = Command::new("/usr/bin/sandbox-exec");
        process.args(["-p", &profile, shell, "-c", command]);
        process.current_dir(workspace);
        Ok(process)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (shell, workspace, command);
        Err("Host command execution is disabled: OS-level project confinement is not available on this platform".to_string())
    }
}

pub(crate) fn sandboxed_terminal_program(
    shell: &str,
    workspace: &str,
    command: &str,
) -> Result<(String, Vec<String>), String> {
    #[cfg(target_os = "macos")]
    {
        Ok((
            "/usr/bin/sandbox-exec".to_string(),
            vec![
                "-p".to_string(),
                macos_profile(workspace),
                shell.to_string(),
                "-c".to_string(),
                command.to_string(),
            ],
        ))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (shell, workspace, command);
        Err("Host terminal execution is disabled: OS-level project confinement is not available on this platform".to_string())
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn macos_profile(workspace: &str) -> String {
    let workspace = sandbox_literal(Path::new(workspace).to_string_lossy().as_ref());
    format!(
        r#"(version 1)
(deny default)
(import "system.sb")
(allow process*)
(allow network*)
(allow sysctl-read)
(allow file-read* (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/Library/Apple") (subpath "/Library/Developer") (subpath "/Applications/Xcode.app") (subpath "/opt/homebrew") (subpath "/nix/store") (subpath "/dev") (subpath "{workspace}"))
(allow file-write* (subpath "{workspace}"))
"#
    )
}

#[cfg(target_os = "macos")]
fn sandbox_literal(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}
