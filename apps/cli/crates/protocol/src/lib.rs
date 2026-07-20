//! Strict, bounded Rust representations of the TypeScript protocol authority.

mod events;
mod records;
mod relay;
mod validation;

pub use events::*;
pub use records::*;
pub use relay::*;
pub use validation::{Nullable, ProtocolError, Validate};

use serde::{de::DeserializeOwned, Serialize};

/// Deserialize JSON and apply the semantic bounds enforced by the TypeScript
/// Zod authority. Unknown-field behavior is controlled by each wire type.
pub fn from_json<T>(json: &str) -> Result<T, ProtocolError>
where
    T: DeserializeOwned + Validate,
{
    let mut value: serde_json::Value = serde_json::from_str(json).map_err(ProtocolError::json)?;
    validation::normalize_integral_json_numbers(&mut value);
    let value: T = serde_json::from_value(value).map_err(ProtocolError::json)?;
    value.validate()?;
    Ok(value)
}

/// Serialize a validated wire value using its canonical field names.
pub fn to_json<T>(value: &T) -> Result<String, ProtocolError>
where
    T: Serialize + Validate,
{
    value.validate()?;
    serde_json::to_string(value).map_err(ProtocolError::json)
}
