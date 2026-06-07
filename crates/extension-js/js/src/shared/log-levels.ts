import type { LogLevel } from "./logger.js";

/** Numeric levels shared by JS logger and Rust WASM tracing filter. */
export const LOG_LEVEL_NUMERIC: Record<LogLevel, number> = {
	trace: 0,
	debug: 1,
	info: 2,
	warn: 3,
	error: 4,
	none: 5,
};

const NUMERIC_TO_LEVEL: LogLevel[] = [
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"none",
];

export function numericToLogLevel(level: number): LogLevel {
	const clamped = Math.max(0, Math.min(5, Math.round(level)));
	return NUMERIC_TO_LEVEL[clamped] ?? "error";
}
