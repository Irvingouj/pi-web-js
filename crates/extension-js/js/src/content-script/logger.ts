const __LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3, none: 4 } as const;
let __logLevel: number = __LOG_LEVELS.error;

function __formatMeta(meta: Record<string, unknown> | undefined): string {
	if (!meta) return "";
	const parts: string[] = [];
	for (const [key, value] of Object.entries(meta)) {
		let str: string;
		if (value === null) str = "null";
		else if (value === undefined) str = "undefined";
		else if (typeof value === "string") str = value;
		else if (typeof value === "number" || typeof value === "boolean")
			str = String(value);
		else
			try {
				str = JSON.stringify(value);
			} catch {
				str = "[Circular]";
			}
		parts.push(`${key}=${str}`);
	}
	return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function __log(level: number, event: string, meta?: Record<string, unknown>) {
	if (level < __logLevel) return;
	const metaStr = __formatMeta(meta);
	const msg = `[extension-js][content-script] ${event}${metaStr}`;
	if (level >= __LOG_LEVELS.error) console.error(msg);
	else if (level === __LOG_LEVELS.warn) console.warn(msg);
	else console.log(msg);
}

export const logger = {
	debug: (event: string, meta?: Record<string, unknown>) => {
		__log(__LOG_LEVELS.debug, event, meta);
	},
	info: (event: string, meta?: Record<string, unknown>) => {
		__log(__LOG_LEVELS.info, event, meta);
	},
	warn: (event: string, meta?: Record<string, unknown>) => {
		__log(__LOG_LEVELS.warn, event, meta);
	},
	error: (event: string, meta?: Record<string, unknown>) => {
		__log(__LOG_LEVELS.error, event, meta);
	},
};

export function initContentScriptLogger(): void {
	window.__jsNotebookSetLogLevel = (level: string) => {
		__logLevel =
			__LOG_LEVELS[level as keyof typeof __LOG_LEVELS] ?? __LOG_LEVELS.error;
	};
}

declare global {
	interface Window {
		__jsNotebookSetLogLevel?: (level: string) => void;
	}
}
