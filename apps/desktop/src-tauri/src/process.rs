use std::process::Child;

pub(crate) fn terminate_child_confirmed(child: &mut Child) -> std::io::Result<()> {
    if child.try_wait()?.is_some() {
        return Ok(());
    }
    child.kill()?;
    child.wait()?;
    Ok(())
}

pub(crate) fn terminate_child(child: &mut Child) {
    let _ = terminate_child_confirmed(child);
}

pub(crate) fn trim_command_output(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= 4_000 {
        return trimmed.to_string();
    }
    format!("...{}", &trimmed[trimmed.len().saturating_sub(4_000)..])
}
