/// <reference types="chrome" />
export const DEFAULT_MAX_NODES = 500;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_SCROLL_AMOUNT = 300;
export const DEFAULT_POLL_INTERVAL_MS = 100;
export const RETRY_DELAY_MS = 500;
export const INJECTION_DELAY_MS = 300;
/** Brief pause after tabs.update so status can transition to loading. */
export const NAVIGATION_SETTLE_MS = 100;
/** Grace period after content-script ping before returning from page.goto. */
export const CONTENT_SCRIPT_GRACE_MS = 500;
/** Fast fail-fast ping before content-script mutations (health, relay). */
export const CS_FAST_PING_MS = 500;
