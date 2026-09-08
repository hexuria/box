//! Shared primitives for grok-box daemons.
//!
//! This crate is the only place path jail and bearer-token comparison live so
//! `box-exec` and `box-host` cannot drift.

pub mod auth;
pub mod config;
pub mod cors;
pub mod error;
pub mod jail;
pub mod listen;

pub use auth::{bearer_token, tokens_equal};
pub use config::{wipe_secret_environ, BoxConfig, ConfigError, MIN_TOKEN_LEN, SECRET_ENV_KEYS};
pub use cors::layer as cors_layer;
pub use error::{ApiError, ErrorBody, ErrorResponse};
pub use jail::{resolve_in_canonical_jail, resolve_in_jail, JailError};
pub use listen::{container_local_host, container_local_http_url};

/// Protocol version advertised by both daemons.
pub const PROTOCOL_VERSION: &str = "v1";

/// Well-known insecure token. Rejected unless `BOX_ALLOW_INSECURE_DEV=1`
/// and both daemon binds are loopback.
pub const DEV_BOX_TOKEN: &str = "dev-box-token";
