use std::sync::atomic::{AtomicI32, Ordering};
use tracing_subscriber::layer::Layer;
use wasm_bindgen::prelude::*;

static LOG_LEVEL: AtomicI32 = AtomicI32::new(0); // default "trace"

/// 0=trace, 1=debug, 2=info, 3=warn, 4=error, 5=none
#[wasm_bindgen(js_name = setLogLevel)]
pub fn set_log_level(level: i32) {
    LOG_LEVEL.store(level.clamp(0, 5), Ordering::Relaxed);
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
            tracing::Level::TRACE => log_level <= 0,
            tracing::Level::DEBUG => log_level <= 1,
            tracing::Level::INFO => log_level <= 2,
            tracing::Level::WARN => log_level <= 3,
            tracing::Level::ERROR => log_level <= 4,
        }
    }
}
