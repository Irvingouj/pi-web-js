export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "none";

import { LOG_LEVEL_NUMERIC } from "./log-levels.js";

export { LOG_LEVEL_NUMERIC, numericToLogLevel } from "./log-levels.js";

let currentLevel: LogLevel = "trace";
let wasmSetLogLevel: ((level: number) => void) | null = null;

export function setLogLevel(level: LogLevel) {
	currentLevel = level;
	if (wasmSetLogLevel) {
		wasmSetLogLevel(LOG_LEVEL_NUMERIC[level]);
	}
}

export function getLogLevel(): LogLevel {
	return currentLevel;
}

export function registerWasmSetLogLevel(fn: (level: number) => void) {
	wasmSetLogLevel = fn;
	fn(LOG_LEVEL_NUMERIC[currentLevel]);
}

function shouldLog(level: LogLevel): boolean {
	return LOG_LEVEL_NUMERIC[level] >= LOG_LEVEL_NUMERIC[currentLevel];
}

function safeStringify(value: unknown, logLevel: LogLevel = "info"): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	if (typeof value === "bigint") return `${value}n`;
	if (value instanceof Error) {
		const stack =
			logLevel === "debug" || logLevel === "trace"
				? value.stack
				: value.stack?.split("\n")[0];
		return JSON.stringify({ message: value.message, name: value.name, stack });
	}
	if (typeof value === "function") return "[Function]";
	if (typeof value === "symbol") return String(value);
	if (typeof value === "object") {
		try {
			return JSON.stringify(value);
		} catch (err) {
			if (err instanceof TypeError && err.message.includes("circular")) {
				return "[Circular]";
			}
			return `[Unserializable: ${err instanceof Error ? err.message : String(err)}]`;
		}
	}
	return String(value);
}

function formatPrefix(namespace: string): string {
	return `[extension-js][${namespace}]`;
}

function formatMetadata(
	metadata: Record<string, unknown> | undefined,
	logLevel: LogLevel,
): string {
	if (!metadata) return "";
	const parts: string[] = [];
	try {
		for (const [key, value] of Object.entries(metadata)) {
			parts.push(`${key}=${safeStringify(value, logLevel)}`);
		}
	} catch {
		return " metadata=[unreadable]";
	}
	return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function normalizeArgs(
	event: string,
	rest: unknown[],
): { event: string; metadata?: Record<string, unknown> } {
	if (rest.length === 0) {
		return { event };
	}
	if (
		rest.length === 1 &&
		typeof rest[0] === "object" &&
		rest[0] !== null &&
		!Array.isArray(rest[0])
	) {
		return { event, metadata: rest[0] as Record<string, unknown> };
	}
	return {
		event,
		metadata: { _args: rest.map((v) => safeStringify(v)).join(" ") },
	};
}

export class Logger {
	constructor(private namespace: string = "root") {}

	private log(
		level: LogLevel,
		event: string,
		metadata?: Record<string, unknown>,
	) {
		try {
			if (!shouldLog(level)) return;
			const prefix = formatPrefix(this.namespace);
			const meta = formatMetadata(metadata, level);
			const message = `${prefix} ${event}${meta}`;
			switch (level) {
				case "trace":
				case "debug":
				case "info":
					console.log(message);
					break;
				case "warn":
					console.warn(message);
					break;
				case "error":
					console.error(message);
					break;
				case "none":
					break;
				default: {
					const _exhaustive: never = level;
					break;
				}
			}
		} catch {
			// Logger must never throw
		}
	}

	trace(event: string, ...rest: unknown[]) {
		const { event: ev, metadata } = normalizeArgs(event, rest);
		this.log("trace", ev, metadata);
	}
	debug(event: string, ...rest: unknown[]) {
		const { event: ev, metadata } = normalizeArgs(event, rest);
		this.log("debug", ev, metadata);
	}
	info(event: string, ...rest: unknown[]) {
		const { event: ev, metadata } = normalizeArgs(event, rest);
		this.log("info", ev, metadata);
	}
	warn(event: string, ...rest: unknown[]) {
		const { event: ev, metadata } = normalizeArgs(event, rest);
		this.log("warn", ev, metadata);
	}
	error(event: string, ...rest: unknown[]) {
		const { event: ev, metadata } = normalizeArgs(event, rest);
		this.log("error", ev, metadata);
	}

	child(namespace: string): Logger {
		return new Logger(`${this.namespace}.${namespace}`);
	}

	timer(
		event: string,
		metadata?: Record<string, unknown>,
		level: LogLevel = "info",
	): (finishMetadata?: Record<string, unknown>) => void {
		const usePerformance =
			typeof performance !== "undefined" && performance.now;
		const start = usePerformance ? performance.now() : Date.now();
		return (finishMetadata?: Record<string, unknown>) => {
			try {
				const end = usePerformance ? performance.now() : Date.now();
				const duration = Math.round(end - start);
				const combined = {
					...metadata,
					...finishMetadata,
					duration_ms: duration,
				};
				this.log(level, event, combined);
			} catch {
				// Timer finish must never throw
			}
		};
	}
}

export const logger = new Logger("root");
