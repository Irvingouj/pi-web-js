import type { CellError } from "../types/generated";

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

/** User-facing cell error text; mirrors Rust `format_cell_error_text`. */
export function formatCellError(err: CellError): string {
	switch (err.kind) {
		case "compile":
			return formatNamedError(err.name, err.message, err.line);
		case "runtime":
			if (err.action || err.code) {
				const action = err.action ?? "unknown";
				const code = err.code ?? "E_UNKNOWN";
				let out = `[${action}] (${code}): ${err.message ?? ""}`;
				// ponytail: some wasm callback paths lose stack metadata; keep a script location visible.
				out += ` (line ${err.line ?? 1})`;
				return out;
			}
			return formatNamedError(err.name, err.message, err.line);
		case "fuel_exhausted":
			return "Execution stopped: time limit reached";
		case "internal":
			return `Internal error: ${err.message ?? ""}`;
	}
}
