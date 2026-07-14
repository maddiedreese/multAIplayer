use tauri::{AppHandle, Runtime, Url};
use tauri_plugin_opener::OpenerExt;

const OPENAI_AUTH_HOSTS: [&str; 3] = ["auth.openai.com", "chatgpt.com", "platform.openai.com"];

#[tauri::command]
pub fn open_trusted_authentication_url<R: Runtime>(
    app: AppHandle<R>,
    provider: String,
    url: String,
) -> crate::command_error::CommandResult<()> {
    let trusted = validate_authentication_url(&provider, &url).map_err(|()| {
        crate::command_error::CommandError::from("The authentication URL was not trusted.")
    })?;
    app.opener()
        .open_url(trusted.as_str(), None::<&str>)
        .map_err(|_| "The system browser could not be opened.".into())
}

fn validate_authentication_url(provider: &str, value: &str) -> Result<Url, ()> {
    if value.len() > 4_096 {
        return Err(());
    }
    let url = Url::parse(value).map_err(|_| ())?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(());
    }

    match provider {
        "github" => {
            if url.host_str() != Some("github.com")
                || !matches!(url.path(), "/login/device" | "/login/device/")
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(());
            }
        }
        "openai" => {
            if !OPENAI_AUTH_HOSTS.contains(&url.host_str().unwrap_or_default()) {
                return Err(());
            }
        }
        _ => return Err(()),
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_exact_github_device_and_approved_openai_hosts() {
        for github in [
            "https://github.com/login/device",
            "https://github.com/login/device/",
        ] {
            assert!(validate_authentication_url("github", github).is_ok());
        }
        for openai in [
            "https://auth.openai.com/authorize?client_id=test&state=opaque",
            "https://chatgpt.com/auth/login#continue",
            "https://platform.openai.com/login",
        ] {
            assert!(validate_authentication_url("openai", openai).is_ok());
        }
    }

    #[test]
    fn rejects_provider_confusion_and_untrusted_url_shapes() {
        for (provider, value) in [
            ("github", "http://github.com/login/device"),
            ("github", "https://github.com.evil.example/login/device"),
            ("github", "https://user@github.com/login/device"),
            ("github", "https://github.com:444/login/device"),
            ("github", "https://github.com/login/device?continue=evil"),
            ("github", "https://github.com/login/oauth/authorize"),
            ("openai", "https://auth.openai.com.evil.example/authorize"),
            ("openai", "https://user@chatgpt.com/auth/login"),
            ("openai", "javascript:alert(1)"),
            ("unknown", "https://github.com/login/device"),
        ] {
            assert!(
                validate_authentication_url(provider, value).is_err(),
                "accepted {provider} {value}"
            );
        }
    }

    #[test]
    fn rejects_oversize_authentication_urls_without_reflecting_them() {
        let value = format!(
            "https://auth.openai.com/authorize?state={}",
            "a".repeat(4_096)
        );
        assert!(validate_authentication_url("openai", &value).is_err());
    }
}
