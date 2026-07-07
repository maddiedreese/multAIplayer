use std::process::Child;

pub(crate) fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

pub(crate) fn trim_command_output(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= 4_000 {
        return trimmed.to_string();
    }
    format!("...{}", &trimmed[trimmed.len().saturating_sub(4_000)..])
}
