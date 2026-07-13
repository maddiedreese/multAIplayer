use std::fmt;

const MAX_CAUSE_CHARS: usize = 1024;

fn bounded_cause(cause: impl fmt::Debug) -> String {
    let rendered = format!("{cause:?}");
    if rendered.chars().count() <= MAX_CAUSE_CHARS {
        rendered
    } else {
        rendered
            .chars()
            .take(MAX_CAUSE_CHARS - 1)
            .chain(std::iter::once('…'))
            .collect()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EngineErrorCategory {
    Storage,
    Protocol,
    Serialization,
    Crypto,
    Internal,
}

impl fmt::Display for EngineErrorCategory {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Storage => "storage",
            Self::Protocol => "protocol",
            Self::Serialization => "serialization",
            Self::Crypto => "crypto",
            Self::Internal => "internal",
        })
    }
}

#[derive(Debug, Eq, PartialEq)]
pub enum EngineError {
    InvalidInput,
    Failure {
        category: EngineErrorCategory,
        operation: &'static str,
        cause: String,
    },
    GroupNotFound,
    NotHost,
    UnexpectedMessage,
    RequiresRejoin {
        category: EngineErrorCategory,
        operation: &'static str,
        cause: String,
    },
}

impl EngineError {
    pub fn operation_failed(
        category: EngineErrorCategory,
        operation: &'static str,
        cause: impl fmt::Debug,
    ) -> Self {
        Self::Failure {
            category,
            operation,
            cause: bounded_cause(cause),
        }
    }

    pub fn requires_rejoin(operation: &'static str, cause: impl fmt::Debug) -> Self {
        Self::RequiresRejoin {
            category: EngineErrorCategory::Storage,
            operation,
            cause: bounded_cause(cause),
        }
    }

    pub fn is_requires_rejoin(&self) -> bool {
        matches!(self, Self::RequiresRejoin { .. })
    }

    pub fn category(&self) -> Option<EngineErrorCategory> {
        match self {
            Self::Failure { category, .. } | Self::RequiresRejoin { category, .. } => {
                Some(*category)
            }
            _ => None,
        }
    }

    pub fn operation(&self) -> Option<&'static str> {
        match self {
            Self::Failure { operation, .. } | Self::RequiresRejoin { operation, .. } => {
                Some(operation)
            }
            _ => None,
        }
    }

    pub fn cause_detail(&self) -> Option<&str> {
        match self {
            Self::Failure { cause, .. } | Self::RequiresRejoin { cause, .. } => Some(cause),
            _ => None,
        }
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput => formatter.write_str("invalid MLS input"),
            Self::Failure {
                category,
                operation,
                ..
            } => write!(formatter, "MLS {category} operation {operation} failed"),
            Self::GroupNotFound => formatter.write_str("group is not open"),
            Self::NotHost => formatter.write_str("operation requires active host"),
            Self::UnexpectedMessage => formatter.write_str("message is not an application message"),
            Self::RequiresRejoin { .. } => formatter.write_str("MLS_REQUIRES_REJOIN"),
        }
    }
}

impl std::error::Error for EngineError {}

pub(super) fn engine_failure<E: fmt::Debug>(
    category: EngineErrorCategory,
    operation: &'static str,
) -> impl FnOnce(E) -> EngineError {
    move |cause| EngineError::operation_failed(category, operation, cause)
}

pub(super) fn engine_failure_without_source(
    category: EngineErrorCategory,
    operation: &'static str,
    cause: &'static str,
) -> EngineError {
    EngineError::operation_failed(category, operation, cause)
}
