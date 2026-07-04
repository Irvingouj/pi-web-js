// JS wrapper for @pi-oxide/web-js
// Provides init() / stop_with() lifecycle API.
// WebSession runs on the main thread and handles all browser side-effects
// directly via web_sys.

import type { CellResult, WasmGlobalsSnapshot } from "./web_js.js";
import { WebSession as RawWebSession } from "./web_js.js";

export { registerHostHandler, registerHostHandlers } from "./registry.js";
export type {
	CellResult as JsRunResult,
	WasmGlobalsSnapshot as JsGlobalsSnapshot,
};


export class WebSession {
	private raw: RawWebSession;

	private constructor(raw: RawWebSession) {
		this.raw = raw;
	}

	static async init(): Promise<[WebSession, Promise<void>]> {
		const session = new WebSession(new RawWebSession());
		return [session, Promise.resolve()];
	}

	async stopWith(runner: Promise<void>): Promise<void> {
		this.raw.stopWith();
		try {
			await runner;
		} catch (e) {
			console.warn("WebSession runner rejected during stop:", e);
		}
	}

	async runCellAsync(code: string, stdin?: string): Promise<CellResult> {
		console.log("[WebSession] runCellAsync called", code);
		const result = await this.raw.runCellAsync(code, stdin || "");
		console.log(
			"[WebSession] runCellAsync result",
			JSON.stringify(result, null, 2),
		);
		return result;
	}

	reset(): void {
		this.raw.reset();
	}

	hasGlobal(name: string): boolean {
		return this.raw.has_global(name);
	}

	inspectGlobals(): WasmGlobalsSnapshot {
		return this.raw.inspect_globals();
	}

	setFuelLimit(limit: number): void {
		this.raw.set_fuel_limit(limit);
	}

	loadLibrary(source: string): CellResult {
		return this.raw.load_library(source);
	}
}
