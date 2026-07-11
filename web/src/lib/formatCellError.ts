import type { CellError } from "../types/generated";

/** Mirror extension-js displayActionName — wire action → agent public name. */
function displayActionName(action: string): string {
	if (action.includes(".")) return action; // already public (page.click, chrome.scripting…)
	const [head, ...tail] = action.split("_");
	if (head === "page") return `page.${tail.join("_")}`;
	if (head === "tab") return `web.tab.${tail.join("_")}`;
	if (head === "sidepanel") return `sidepanel.${tail.join("_")}`;
	if (head === "chrome" && tail.length > 0) {
		// chrome_scripting_executeScript → chrome.scripting.executeScript
		// Last segment is method; earlier segments are dotted API path.
		const method = tail[tail.length - 1] ?? "";
		const apiPath = tail.slice(0, -1);
		if (apiPath.length === 0) return `chrome.${method}`;
		return `chrome.${apiPath.join(".")}.${method}`;
	}
	return action;
}

function formatNamedError(
	name: string | null | undefined,
	message: string | undefined,
	line: number | null | undefined,
): string {
	const detail = message ?? "";
	let out: string;
	if (name && detail) {
		out = `${name}: ${detail}`;
	} else if (name) {
		out = name;
	} else if (detail) {
		out = detail;
	} else {
		out = "Error";
	}
	if (line != null) {
		out += ` (line ${line})`;
	}
	return out;
}

/** Loose error shape from WASM (generated.ts lags WasmCellError). */
type WasmishCellError = CellError | {
	kind: "api_error";
	code: string;
	message: string;
	action: string;
	public_name: string;
	line: number | null;
	param?: {
		path: string;
		expected?: string;
		receivedType?: string;
		receivedPreview?: string;
	};
	hint?: string;
	recovery?: string[];
	stack?: string;
} | {
	kind: "js_runtime";
	name: string | null;
	message: string;
	line: number | null;
	stack?: string;
};

/** User-facing cell error text; mirrors Rust `format_cell_error_text`. */
export function formatCellError(err: WasmishCellError): string {
	switch (err.kind) {
		case "compile":
			return formatNamedError(err.name, err.message, err.line);
		case "runtime":
			if (err.action || err.code) {
				const rawAction = err.action ?? "unknown";
				const action = displayActionName(rawAction);
				const code = err.code ?? "E_UNKNOWN";
				let out = `[${action}] (${code}): ${err.message ?? ""}`;
				// ponytail: some wasm callback paths lose stack metadata; keep a script location visible.
				out += ` (line ${err.line ?? 1})`;
				return out;
			}
			return formatNamedError(err.name, err.message, err.line);
		case "js_runtime":
			return formatNamedError(err.name, err.message, err.line);
		case "api_error": {
			// Mirror crates/web-js-core/src/error/format.rs ApiError arm.
			const publicName = displayActionName(
				err.public_name || err.action || "unknown",
			);
			const code = err.code || "E_UNKNOWN";
			const message = err.message ?? "";
			const alreadyWrapped = message.startsWith("[");
			let out: string;
			if (alreadyWrapped) {
				const close = message.indexOf("]");
				out =
					close >= 0
						? `[${publicName}]${message.slice(close + 1)}`
						: message;
			} else {
				out = `[${publicName}] (${code}): ${message}`;
			}
			const p = err.param;
			if (p) {
				const hasParamDetail = message.includes(`'${p.path}'`);
				const isRoot = p.path === "root";
				if (!hasParamDetail && !isRoot) {
					out += ` at '${p.path}'`;
					if (p.expected) out += `: expected ${p.expected}`;
					if (p.receivedType) out += `, received ${p.receivedType}`;
					if (p.receivedPreview) out += ` (${p.receivedPreview})`;
				}
			}
			if (err.line != null && !out.includes(`(line ${err.line})`)) {
				out += ` (line ${err.line})`;
			} else if (err.line == null && !/\(line \d+\)/.test(out)) {
				// Keep a visible line for agent-facing diagnostics when WASM omits it.
				out += " (line 1)";
			}
			if (err.hint) {
				out += `\n\nHint: ${err.hint}`;
			}
			if (err.recovery && err.recovery.length > 0) {
				out += "\n\nRecovery:";
				err.recovery.forEach((step, idx) => {
					out += `\n  ${idx + 1}. ${step}`;
				});
			}
			return out;
		}
		case "fuel_exhausted":
			return "Execution stopped: time limit reached";
		case "internal":
			return `Internal error: ${err.message ?? ""}`;
		default: {
			// Exhaustiveness fallback — never return undefined (crashes CellOutput escapeHtml).
			const fallback = err as { message?: string; kind?: string };
			return fallback.message ?? `Error (${fallback.kind ?? "unknown"})`;
		}
	}
}
