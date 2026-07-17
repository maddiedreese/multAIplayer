use super::*;

#[typed_tauri_command::command]
pub(crate) fn mls_identity_initialize(
    request: IdentityInitializeRequest,
    state: tauri::State<'_, MlsNativeState>,
    app: tauri::AppHandle,
) -> crate::command_error::CommandResult<IdentityPublic> {
    let mut identity_lock = state
        .identity
        .lock()
        .map_err(|_| "MLS identity state is unavailable".to_string())?;
    if let Some((user, device, public)) = identity_lock.as_ref() {
        if user == &request.github_user_id && device == &request.device_id {
            return Ok(public.clone());
        }
        return Err(crate::command_error::CommandError::identity_scope_mismatch(
            "This installation is already bound to another GitHub account or device identity.",
        ));
    }
    let identity = BasicAppCredential {
        github_user_id: request.github_user_id.clone(),
        device_id: request.device_id.clone(),
    };
    validate_credential(
        &serde_json::to_vec(&identity).map_err(|_| "MLS identity is invalid".to_string())?,
    )
    .map_err(safe_error)?;
    let secret = load_or_create_signing_secret(&request.github_user_id, &request.device_id)
        .map_err(identity_initialization_error)?;
    let wrapping_key = load_or_create_store_wrapping_key()?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Failed to resolve MLS data directory".to_string())?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|_| "Failed to create MLS data directory".to_string())?;
    let database_path = data_dir.join("mls-v2.db");
    let mut requires_rejoin = false;
    let engine =
        match MlsEngine::open_persistent(identity, secret.clone(), &database_path, wrapping_key) {
            Ok(engine) => engine,
            Err(error)
                if database_path.exists()
                    && should_quarantine_store(&database_path, wrapping_key) =>
            {
                quarantine_store(&database_path)?;
                requires_rejoin = true;
                MlsEngine::open_persistent(
                    BasicAppCredential {
                        github_user_id: request.github_user_id.clone(),
                        device_id: request.device_id.clone(),
                    },
                    secret.clone(),
                    &database_path,
                    wrapping_key,
                )
                .map_err(|_| safe_error(error))?
            }
            Err(error) => return Err(safe_error(error).into()),
        };
    let store = EncryptedStore::open(&database_path, wrapping_key).map_err(safe_error)?;
    secure_store_permissions(&database_path)?;
    let signer = DeviceAuthSigner::from_secret(
        secret,
        request.github_user_id.clone(),
        request.device_id.clone(),
    )
    .map_err(safe_error)?;
    let signature_public_key = STANDARD.encode(signer.public_key_spki_der().map_err(safe_error)?);
    let hpke = load_or_create_hpke_key_pair()?;
    let hpke_public_key = STANDARD.encode(hpke.public_key_bytes());
    let signature_key_fingerprint = fingerprint(
        &STANDARD
            .decode(&signature_public_key)
            .map_err(|_| "MLS identity encoding failed".to_string())?,
    );
    let hpke_key_fingerprint = fingerprint(hpke.public_key_bytes());
    *state
        .engine
        .lock()
        .map_err(|_| "MLS state is unavailable".to_string())? = Some(engine);
    *state
        .signer
        .lock()
        .map_err(|_| "MLS signer is unavailable".to_string())? = Some(signer);
    *state
        .hpke
        .lock()
        .map_err(|_| "MLS HPKE state is unavailable".to_string())? = Some(hpke);
    *state
        .store
        .lock()
        .map_err(|_| "MLS store is unavailable".to_string())? = Some(store);
    let public = IdentityPublic {
        github_user_id: request.github_user_id.clone(),
        device_id: request.device_id.clone(),
        ciphersuite: 2,
        signature_public_key,
        signature_key_fingerprint,
        hpke_public_key,
        hpke_key_fingerprint,
        requires_rejoin,
    };
    *identity_lock = Some((request.github_user_id, request.device_id, public.clone()));
    Ok(public)
}

fn identity_initialization_error(
    error: SigningSecretLoadError,
) -> crate::command_error::CommandError {
    match error {
        SigningSecretLoadError::ScopeMismatch => {
            crate::command_error::CommandError::identity_scope_mismatch(
                "This installation is already bound to another GitHub account or device identity.",
            )
        }
        SigningSecretLoadError::Internal => "MLS identity could not be loaded".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_stored_identity_scope_mismatch_gets_scope_remediation() {
        let mismatch = identity_initialization_error(SigningSecretLoadError::ScopeMismatch);
        assert_eq!(
            mismatch.code,
            crate::command_error::CommandErrorCode::IdentityScopeMismatch
        );

        let keychain = identity_initialization_error(SigningSecretLoadError::Internal);
        assert_eq!(
            keychain.code,
            crate::command_error::CommandErrorCode::InternalError
        );
        assert_ne!(keychain.code, mismatch.code);
    }
}
