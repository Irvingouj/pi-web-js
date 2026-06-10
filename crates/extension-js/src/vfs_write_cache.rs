use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

fn cache() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn cache_write(path: &str, data: &str) {
    if let Ok(mut guard) = cache().lock() {
        guard.insert(path.to_string(), data.to_string());
    }
}

pub fn take_write(path: &str) -> Option<String> {
    cache()
        .lock()
        .ok()
        .and_then(|mut guard| guard.remove(path))
}

pub fn clear() {
    if let Ok(mut guard) = cache().lock() {
        guard.clear();
    }
}
