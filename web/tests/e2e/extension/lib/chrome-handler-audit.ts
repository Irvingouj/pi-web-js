import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_MANIFEST } from "./contract-metadata.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const CHROME_TOOLS_DIR = path.resolve(
	REPO_ROOT,
	"crates/extension-js/js/src/main/runner/tools/chrome",
);
const CHROME_STORAGE_PATH = path.resolve(
	REPO_ROOT,
	"crates/extension-js/js/src/main/runner/tools/chrome-storage.ts",
);

/** APIs exposed as injected properties, not async handler actions. */
export const CHROME_PROPERTY_ONLY = new Set(["chrome.runtime.id"]);

function collectRegisteredChromeActions(): Set<string> {
	const registered = new Set<string>();
	const passthroughRe = /registerChromePassthrough\(\s*"([^"]+)"/g;
	const regChromeRe = /regChrome\(\s*"([^"]+)"/g;
	const actionRe = /action:\s*"(chrome_[^"]+)"/g;

	function scanFile(content: string): void {
		for (const re of [passthroughRe, regChromeRe, actionRe]) {
			re.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = re.exec(content))) {
				registered.add(match[1]);
			}
		}
	}

	for (const file of readdirSync(CHROME_TOOLS_DIR)) {
		if (!file.endsWith(".ts")) continue;
		scanFile(readFileSync(path.join(CHROME_TOOLS_DIR, file), "utf8"));
	}

	scanFile(readFileSync(CHROME_STORAGE_PATH, "utf8"));

	return registered;
}

export function auditChromeHandlerCoverage(): {
	missing: string[];
	registeredCount: number;
	chromeApiCount: number;
} {
	const registered = collectRegisteredChromeActions();
	const chromeApis = CONTRACT_MANIFEST.filter((api) =>
		api.startsWith("chrome."),
	);
	const missing = chromeApis.filter((api) => {
		if (CHROME_PROPERTY_ONLY.has(api)) return false;
		return !registered.has(api.replace(/\./g, "_"));
	});
	return {
		missing,
		registeredCount: registered.size,
		chromeApiCount: chromeApis.length,
	};
}
