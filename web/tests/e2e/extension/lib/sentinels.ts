import { RESULT_PREFIX } from "./constants.ts";
import type { ContractResult } from "./types.ts";

export function decodeRenderedOutput(text: string): string {
	return text
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");
}

export function parseSentinelLine(
	line: string,
): (ContractResult & { api?: string }) | null {
	const idx = line.indexOf(RESULT_PREFIX);
	if (idx < 0) return null;
	const json = line.slice(idx + RESULT_PREFIX.length).trim();
	try {
		return JSON.parse(json) as ContractResult & { api?: string };
	} catch {
		return null;
	}
}

export function parseAllSentinels(
	stdout: string,
): Array<ContractResult & { api?: string }> {
	const results: Array<ContractResult & { api?: string }> = [];
	for (const line of stdout.split("\n")) {
		const parsed = parseSentinelLine(line);
		if (parsed) results.push(parsed);
	}
	if (results.length > 0) return results;

	let searchFrom = 0;
	while (searchFrom < stdout.length) {
		const idx = stdout.indexOf(RESULT_PREFIX, searchFrom);
		if (idx < 0) break;
		const lineParsed = parseSentinelLine(stdout.slice(idx).split("\n")[0] ?? "");
		if (lineParsed) results.push(lineParsed);
		searchFrom = idx + RESULT_PREFIX.length + 1;
	}
	return results;
}
