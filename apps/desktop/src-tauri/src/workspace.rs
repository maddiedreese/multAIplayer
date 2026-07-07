use std::fs;
use std::path::{Path, PathBuf};

use crate::validation::ensure_project_path;

pub(crate) fn ensure_existing_dir(cwd: &str) -> Result<(), String> {
    ensure_project_path(cwd)?;
    let path = Path::new(cwd);
    if path.is_dir() {
        Ok(())
    } else {
        Err(format!("{cwd} is not an existing directory"))
    }
}

pub(crate) fn canonical_project_root(cwd: &str) -> Result<PathBuf, String> {
    ensure_project_path(cwd)?;
    fs::canonicalize(cwd).map_err(|error| format!("Failed to resolve project path: {error}"))
}
