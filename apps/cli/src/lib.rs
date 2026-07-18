pub mod auth;
pub mod identity;
pub mod platform;
pub mod relay;

use thiserror::Error;

pub const GITHUB_CLIENT_ID: &str = match option_env!("MULTAIPLAYER_NATIVE_GITHUB_CLIENT_ID") {
    Some(value) => value,
    None => "Ov23licNchghSlAxuCdK",
};
pub const RELAY_HTTP_ORIGIN: &str = match option_env!("MULTAIPLAYER_NATIVE_RELAY_HTTP_ORIGIN") {
    Some(value) => value,
    None => "https://relay.multaiplayer.com",
};

#[derive(Debug, Error, Clone, Copy, Eq, PartialEq)]
pub enum CliError {
    #[error("GitHub OAuth is not configured.")]
    GitHubNotConfigured,
    #[error("GitHub returned an invalid or unsupported response.")]
    InvalidGitHubResponse,
    #[error("GitHub authorization is pending.")]
    AuthorizationPending,
    #[error("GitHub authorization was denied.")]
    AuthorizationDenied,
    #[error("The GitHub authorization code expired. Start again.")]
    AuthorizationExpired,
    #[error("GitHub sign-in could not be completed.")]
    GitHubUnavailable,
    #[error("The relay origin is invalid or does not match the stored session.")]
    RelayOriginMismatch,
    #[error("The relay could not complete authentication.")]
    RelayUnavailable,
    #[error("Sign in with GitHub before reading workspace state.")]
    RelayAuthenticationRequired,
    #[error("The relay returned invalid or unsupported data.")]
    InvalidRelayResponse,
    #[error("The secure credential store is unavailable.")]
    CredentialStoreUnavailable,
    #[error("Stored credentials are invalid.")]
    InvalidStoredCredential,
    #[error("This installation is already bound to another GitHub account.")]
    IdentityScopeMismatch,
    #[error("The device identity could not be prepared securely.")]
    IdentityUnavailable,
    #[error("The trusted authentication URL could not be opened.")]
    UrlOpenFailed,
}
