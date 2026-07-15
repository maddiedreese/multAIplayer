use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::validation::ensure_room_id;
use crate::workspace::canonical_project_root;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum CodexConfirmationBinding {
    ProjectRoot {
        room_id: String,
        canonical_root: PathBuf,
        sandbox_mode: String,
        network_access: bool,
    },
    ServerRequest {
        request_key: String,
        room_id: String,
        method: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ProjectRootAuthorization {
    AlreadyAuthorized(PathBuf),
    RequiresConfirmation(PathBuf),
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct AuthorizedProjectRoot {
    canonical_root: PathBuf,
    sandbox_mode: String,
    network_access: bool,
}

#[derive(Default)]
pub(crate) struct CodexAuthorizationState {
    project_roots: Mutex<HashMap<String, AuthorizedProjectRoot>>,
    confirmation_in_flight: Mutex<Option<CodexConfirmationBinding>>,
}

impl CodexAuthorizationState {
    pub(crate) fn classify_project_root(
        &self,
        room_id: &str,
        requested_root: &str,
        sandbox_mode: &str,
        network_access: bool,
    ) -> Result<ProjectRootAuthorization, String> {
        ensure_room_id(room_id)?;
        let canonical_root = canonical_project_root(requested_root)?;
        let roots = self
            .project_roots
            .lock()
            .map_err(|_| "Codex project-root authorization state is unavailable".to_string())?;
        if roots.get(room_id).is_some_and(|authorized| {
            authorized.canonical_root == canonical_root
                && authorized.sandbox_mode == sandbox_mode
                && authorized.network_access == network_access
        }) {
            Ok(ProjectRootAuthorization::AlreadyAuthorized(canonical_root))
        } else {
            Ok(ProjectRootAuthorization::RequiresConfirmation(
                canonical_root,
            ))
        }
    }

    pub(crate) fn authorize_project_root(
        &self,
        room_id: &str,
        expected_canonical_root: &Path,
        sandbox_mode: &str,
        network_access: bool,
    ) -> Result<PathBuf, String> {
        ensure_room_id(room_id)?;
        let current = expected_canonical_root
            .canonicalize()
            .map_err(|error| format!("Failed to revalidate the Codex project root: {error}"))?;
        if current != expected_canonical_root || !current.is_dir() {
            return Err(
                "The Codex project root changed while native confirmation was open".to_string(),
            );
        }
        self.project_roots
            .lock()
            .map_err(|_| "Codex project-root authorization state is unavailable".to_string())?
            .insert(
                room_id.to_string(),
                AuthorizedProjectRoot {
                    canonical_root: current.clone(),
                    sandbox_mode: sandbox_mode.to_string(),
                    network_access,
                },
            );
        Ok(current)
    }

    pub(crate) fn revoke_project_root(&self, room_id: &str) -> Result<bool, String> {
        ensure_room_id(room_id)?;
        Ok(self
            .project_roots
            .lock()
            .map_err(|_| "Codex project-root authorization state is unavailable".to_string())?
            .remove(room_id)
            .is_some())
    }

    pub(crate) fn begin_confirmation(
        &self,
        binding: CodexConfirmationBinding,
    ) -> Result<(), String> {
        let mut in_flight = self
            .confirmation_in_flight
            .lock()
            .map_err(|_| "Codex native-confirmation state is unavailable".to_string())?;
        if in_flight.is_some() {
            return Err("A Codex native confirmation is already open".to_string());
        }
        *in_flight = Some(binding);
        Ok(())
    }

    pub(crate) fn finish_confirmation(
        &self,
        binding: &CodexConfirmationBinding,
    ) -> Result<(), String> {
        let mut in_flight = self
            .confirmation_in_flight
            .lock()
            .map_err(|_| "Codex native-confirmation state is unavailable".to_string())?;
        if in_flight.as_ref() != Some(binding) {
            return Err(
                "Codex native confirmation no longer matches the pending operation".to_string(),
            );
        }
        *in_flight = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn project_roots_are_canonical_room_scoped_and_revocable() {
        let temp = tempdir().expect("temp directory");
        let root = temp.path().join("project");
        let other = temp.path().join("other");
        std::fs::create_dir_all(&root).expect("project root");
        std::fs::create_dir_all(&other).expect("other root");
        let state = CodexAuthorizationState::default();

        let ProjectRootAuthorization::RequiresConfirmation(canonical) = state
            .classify_project_root(
                "room-authority",
                &root.to_string_lossy(),
                "workspace-write",
                false,
            )
            .expect("classify initial root")
        else {
            panic!("initial root must require confirmation");
        };
        state
            .authorize_project_root("room-authority", &canonical, "workspace-write", false)
            .expect("authorize root");
        assert_eq!(
            state
                .classify_project_root(
                    "room-authority",
                    &root.to_string_lossy(),
                    "workspace-write",
                    false,
                )
                .expect("classify authorized root"),
            ProjectRootAuthorization::AlreadyAuthorized(canonical.clone())
        );
        assert!(matches!(
            state
                .classify_project_root(
                    "room-authority",
                    &other.to_string_lossy(),
                    "workspace-write",
                    false,
                )
                .expect("classify changed root"),
            ProjectRootAuthorization::RequiresConfirmation(_)
        ));
        assert!(matches!(
            state
                .classify_project_root(
                    "room-authority",
                    &root.to_string_lossy(),
                    "danger-full-access",
                    true,
                )
                .expect("classify changed execution profile"),
            ProjectRootAuthorization::RequiresConfirmation(_)
        ));
        assert!(matches!(
            state
                .classify_project_root(
                    "room-other",
                    &root.to_string_lossy(),
                    "workspace-write",
                    false,
                )
                .expect("classify other room"),
            ProjectRootAuthorization::RequiresConfirmation(_)
        ));
        assert!(state
            .revoke_project_root("room-authority")
            .expect("revoke root"));
        assert!(matches!(
            state
                .classify_project_root(
                    "room-authority",
                    &root.to_string_lossy(),
                    "workspace-write",
                    false,
                )
                .expect("classify revoked root"),
            ProjectRootAuthorization::RequiresConfirmation(_)
        ));
    }

    #[test]
    fn authorization_rechecks_the_confirmed_canonical_path() {
        let temp = tempdir().expect("temp directory");
        let root = temp.path().join("project");
        std::fs::create_dir_all(&root).expect("project root");
        let canonical = root.canonicalize().expect("canonical root");
        std::fs::remove_dir(&root).expect("remove root after confirmation");
        std::fs::create_dir(&root).expect("replace root after confirmation");
        let state = CodexAuthorizationState::default();

        // Path canonicalization cannot distinguish a same-path inode replacement
        // portably; it can and must still reject a missing or retargeted path.
        assert!(state
            .authorize_project_root("room-recheck", &canonical, "workspace-write", false)
            .is_ok());
        std::fs::remove_dir(&root).expect("remove root");
        assert!(state
            .authorize_project_root("room-recheck", &canonical, "workspace-write", false)
            .is_err());
    }

    #[test]
    fn one_exact_native_confirmation_can_be_in_flight() {
        let state = CodexAuthorizationState::default();
        let first = CodexConfirmationBinding::ServerRequest {
            request_key: "rpc-1-1".to_string(),
            room_id: "room-confirm".to_string(),
            method: "item/fileChange/requestApproval".to_string(),
        };
        let different = CodexConfirmationBinding::ServerRequest {
            request_key: "rpc-1-2".to_string(),
            room_id: "room-confirm".to_string(),
            method: "item/commandExecution/requestApproval".to_string(),
        };
        state
            .begin_confirmation(first.clone())
            .expect("begin confirmation");
        assert!(state.begin_confirmation(different.clone()).is_err());
        assert!(state.finish_confirmation(&different).is_err());
        assert!(state.begin_confirmation(different.clone()).is_err());
        state
            .finish_confirmation(&first)
            .expect("finish exact confirmation");
        assert!(state.begin_confirmation(different).is_ok());
    }
}
