use std::sync::atomic::{AtomicI32, Ordering};
use tracing_subscriber::layer::Layer;
use wasm_bindgen::prelude::*;

static LOG_LEVEL: AtomicI32 = AtomicI32::new(3); // default "error"

/// 0=debug, 1=info, 2=warn, 3=error, 4=none
#[wasm_bindgen(js_name = setLogLevel)]
pub fn set_log_level(level: i32) {
    LOG_LEVEL.store(level.clamp(0, 4), Ordering::Relaxed);
}

pub struct LogLevelFilterLayer;

impl<S> Layer<S> for LogLevelFilterLayer
where
    S: tracing::Subscriber,
{
    fn enabled(
        &self,
        metadata: &tracing::Metadata<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) -> bool {
        let level = metadata.level();
        let log_level = LOG_LEVEL.load(Ordering::Relaxed);
        match *level {
            tracing::Level::DEBUG => log_level <= 0,
            tracing::Level::INFO => log_level <= 1,
            tracing::Level::WARN => log_level <= 2,
            tracing::Level::ERROR => log_level <= 3,
            _ => false,
        }
    }
}
