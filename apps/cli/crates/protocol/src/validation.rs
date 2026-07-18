use chrono::DateTime;
use regex::Regex;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::{error::Error, fmt, sync::OnceLock};

pub const MAX_RELAY_ID_CHARS: usize = 160;
pub const MAX_ENVELOPE_ID_CHARS: usize = 160;
pub const MAX_DEVICE_ID_CHARS: usize = 160;
pub const MAX_USER_ID_CHARS: usize = 160;
pub const MAX_DISPLAY_NAME_CHARS: usize = 120;
pub const MAX_ROOM_NAME_CHARS: usize = 160;
pub const MAX_SHORT_TEXT_CHARS: usize = 512;
pub const MAX_MEDIUM_TEXT_CHARS: usize = 4_096;
pub const MAX_LONG_TEXT_CHARS: usize = 120_000;
pub const MAX_PROJECT_PATH_CHARS: usize = 2_048;
pub const MAX_URL_CHARS: usize = 2_048;
pub const MAX_CODEX_MODEL_CHARS: usize = 80;
pub const MAX_CODEX_THREAD_ID_CHARS: usize = 512;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolError(String);

impl ProtocolError {
    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self(message.into())
    }

    pub(crate) fn json(error: serde_json::Error) -> Self {
        Self(format!("invalid JSON: {error}"))
    }
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for ProtocolError {}

pub trait Validate {
    fn validate(&self) -> Result<(), ProtocolError>;
}

pub(crate) fn deserialize_optional_non_null<'de, D, T>(
    deserializer: D,
) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

pub(crate) fn deserialize_required_nullable<'de, D, T>(
    deserializer: D,
) -> Result<Nullable<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Nullable)
}

/// A required JSON field whose value may explicitly be `null`.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct Nullable<T>(pub Option<T>);

impl<T> Nullable<T> {
    pub fn as_ref(&self) -> Option<&T> {
        self.0.as_ref()
    }
}

pub(crate) fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

pub(crate) fn normalize_integral_json_numbers(value: &mut Value) {
    match value {
        Value::Array(values) => {
            for value in values {
                normalize_integral_json_numbers(value);
            }
        }
        Value::Object(values) => {
            for value in values.values_mut() {
                normalize_integral_json_numbers(value);
            }
        }
        Value::Number(number) if number.as_i64().is_none() && number.as_u64().is_none() => {
            if let Some(value) = number.as_f64().filter(|value| {
                value.is_finite() && value.fract() == 0.0 && value.abs() <= MAX_SAFE_INTEGER as f64
            }) {
                *number = if value.is_sign_negative() {
                    serde_json::Number::from(value as i64)
                } else {
                    serde_json::Number::from(value as u64)
                };
            }
        }
        _ => {}
    }
}

pub(crate) fn bounded(
    field: &str,
    value: &str,
    min: usize,
    max: usize,
) -> Result<(), ProtocolError> {
    let len = utf16_len(value);
    if (min..=max).contains(&len) {
        Ok(())
    } else {
        Err(ProtocolError::invalid(format!(
            "{field} must contain {min}..={max} UTF-16 code units"
        )))
    }
}

pub(crate) fn relay_id(field: &str, value: &str) -> Result<(), ProtocolError> {
    bounded(field, value, 3, MAX_RELAY_ID_CHARS)?;
    if value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        Ok(())
    } else {
        Err(ProtocolError::invalid(format!(
            "{field} contains a character outside [A-Za-z0-9_-]"
        )))
    }
}

pub(crate) fn device_id(field: &str, value: &str) -> Result<(), ProtocolError> {
    bounded(field, value, 8, MAX_DEVICE_ID_CHARS)
}

pub(crate) fn user_id(field: &str, value: &str) -> Result<(), ProtocolError> {
    bounded(field, value, 1, MAX_USER_ID_CHARS)
}

pub(crate) fn safe_u64(field: &str, value: u64) -> Result<(), ProtocolError> {
    if value <= MAX_SAFE_INTEGER {
        Ok(())
    } else {
        Err(ProtocolError::invalid(format!(
            "{field} exceeds JavaScript's safe-integer range"
        )))
    }
}

pub(crate) fn safe_i64(field: &str, value: i64) -> Result<(), ProtocolError> {
    if value.unsigned_abs() <= MAX_SAFE_INTEGER {
        Ok(())
    } else {
        Err(ProtocolError::invalid(format!(
            "{field} exceeds JavaScript's safe-integer range"
        )))
    }
}

pub(crate) fn datetime(field: &str, value: &str) -> Result<(), ProtocolError> {
    static ZOD_DATETIME: OnceLock<Regex> = OnceLock::new();
    let pattern = ZOD_DATETIME.get_or_init(|| {
        Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")
            .expect("datetime regex is valid")
    });
    if !pattern.is_match(value) {
        return Err(ProtocolError::invalid(format!(
            "{field} must use the Zod UTC datetime syntax"
        )));
    }
    DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|_| ProtocolError::invalid(format!("{field} must be an RFC 3339 datetime")))
}

pub(crate) fn date_parseable(field: &str, value: &str) -> Result<(), ProtocolError> {
    DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|_| ProtocolError::invalid(format!("{field} must be a parseable datetime")))
}

pub(crate) fn canonical_base64(field: &str, value: &str, min: usize) -> Result<(), ProtocolError> {
    static BASE64: OnceLock<Regex> = OnceLock::new();
    bounded(field, value, min, usize::MAX)?;
    let pattern = BASE64.get_or_init(|| {
        Regex::new(r"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")
            .expect("base64 regex is valid")
    });
    if pattern.is_match(value) {
        Ok(())
    } else {
        Err(ProtocolError::invalid(format!(
            "{field} must be canonical padded base64"
        )))
    }
}

pub(crate) fn sha256_hash(field: &str, value: &str) -> Result<(), ProtocolError> {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return Err(ProtocolError::invalid(format!(
            "{field} must start with sha256:"
        )));
    };
    if hex.len() == 64
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err(ProtocolError::invalid(format!(
            "{field} must contain 64 lowercase hexadecimal digits"
        )))
    }
}

pub(crate) fn fingerprint(field: &str, value: &str) -> Result<(), ProtocolError> {
    let Some(groups) = value.strip_prefix("sha256:") else {
        return Err(ProtocolError::invalid(format!(
            "{field} must start with sha256:"
        )));
    };
    let groups: Vec<_> = groups.split(':').collect();
    if groups.len() == 16
        && groups.iter().all(|group| {
            group.len() == 4
                && group
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        })
    {
        Ok(())
    } else {
        Err(ProtocolError::invalid(format!(
            "{field} must be a grouped lowercase SHA-256 fingerprint"
        )))
    }
}

pub(crate) fn validate_optional<T>(value: &Option<T>) -> Result<(), ProtocolError>
where
    T: Validate,
{
    if let Some(value) = value {
        value.validate()?;
    }
    Ok(())
}
