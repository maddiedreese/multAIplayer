use std::path::Path;

const DEFAULT_LOGIN_SHELL: &str = "/bin/zsh";

pub(crate) fn user_login_shell() -> String {
    account_login_shell().unwrap_or_else(|| DEFAULT_LOGIN_SHELL.to_string())
}

#[cfg(unix)]
fn account_login_shell() -> Option<String> {
    use std::ffi::CStr;

    let suggested_buffer_size = unsafe { libc::sysconf(libc::_SC_GETPW_R_SIZE_MAX) };
    let buffer_size = if suggested_buffer_size > 0 {
        usize::try_from(suggested_buffer_size)
            .ok()?
            .min(1024 * 1024)
    } else {
        16 * 1024
    };
    let mut buffer = vec![0_u8; buffer_size];
    let mut record = unsafe { std::mem::zeroed::<libc::passwd>() };
    let mut result = std::ptr::null_mut();
    let status = unsafe {
        libc::getpwuid_r(
            libc::geteuid(),
            &mut record,
            buffer.as_mut_ptr().cast(),
            buffer.len(),
            &mut result,
        )
    };
    if status != 0 || result.is_null() || record.pw_shell.is_null() {
        return None;
    }
    let shell = unsafe { CStr::from_ptr(record.pw_shell) }
        .to_str()
        .ok()?
        .to_string();
    let path = Path::new(&shell);
    (path.is_absolute() && path.is_file()).then_some(shell)
}

#[cfg(not(unix))]
fn account_login_shell() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolved_login_shell_is_an_existing_absolute_file() {
        let shell = user_login_shell();
        let path = Path::new(&shell);
        assert!(path.is_absolute());
        assert!(path.is_file());
    }
}
