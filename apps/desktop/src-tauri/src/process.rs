use std::process::Child;

pub(crate) fn terminate_child(child: &mut Child) {
    if let Err(error) = terminate_child_confirmed(child) {
        eprintln!("Failed to terminate child process: {error}");
    }
}

pub(crate) fn terminate_child_confirmed(child: &mut Child) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|error| format!("Failed to read child process status: {error}"))?
        .is_some()
    {
        return Ok(());
    }
    if let Err(kill_error) = child.kill() {
        if child
            .try_wait()
            .map_err(|error| {
                format!("Failed to read child process status after kill failed: {error}")
            })?
            .is_some()
        {
            return Ok(());
        }
        return Err(format!("Failed to terminate child process: {kill_error}"));
    }
    child
        .wait()
        .map_err(|error| format!("Failed to confirm child process termination: {error}"))?;
    Ok(())
}

pub(crate) fn trim_command_output(value: &str) -> String {
    let trimmed = value.trim();
    crate::output::bound_text_chars(trimmed, 4_000, "...")
}

#[cfg(test)]
mod tests {
    use super::{terminate_child_confirmed, trim_command_output};
    use std::process::Command;

    #[test]
    fn trim_command_output_bounds_unicode_without_splitting_characters() {
        let output = format!("{}tail", "🚀".repeat(5_000));
        let trimmed = trim_command_output(&output);

        assert!(trimmed.chars().count() <= 4_000);
        assert!(trimmed.ends_with("tail"));
    }

    #[test]
    fn terminate_child_confirmed_reaps_the_process() {
        let mut child = Command::new("sleep").arg("30").spawn().unwrap();

        terminate_child_confirmed(&mut child).unwrap();

        assert!(child.try_wait().unwrap().is_some());
    }
}
