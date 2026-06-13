/// <reference types="chrome" />

import { encodeFetchResponse } from "../../shared/fetch-response.js";
import type { AsyncResponse } from "../../shared/tool-registry.js";
import { throwIfAborted } from "../../shared/tool-registry.js";
import { DEFAULT_TIMEOUT_MS } from "./lib/constants.js";
import type { FetchParams, FetchValue } from "./lib/types.js";

// ─── Fetch handler ───────────────────────────────────────────────

export async function handleFetch(
	params: FetchParams,
): Promise<AsyncResponse<FetchValue>> {
	throwIfAborted();
	const { url, method, headers, body, timeout } = params;

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(
			() => controller.abort(),
			Number(timeout) ?? DEFAULT_TIMEOUT_MS,
		);
		const fetchOpts: RequestInit = {
			method: method || "GET",
			headers:
				typeof headers === "object" && headers !== null
					? (headers as Record<string, string>)
					: {},
			signal: controller.signal,
		};
		if (body !== null && body !== undefined) {
			fetchOpts.body = typeof body === "string" ? body : String(body);
		}
		const response = await fetch(url, fetchOpts);
		clearTimeout(timeoutId);
		const value = await encodeFetchResponse(response);
		return { ok: true, value };
	} catch (err: unknown) {
		if (err instanceof Error && err.name === "AbortError") {
			return {
				ok: false,
				error: {
					message: `Request timed out after ${timeout || 30_000}ms`,
					code: "ETIMEDOUT",
					category: "timeout",
				},
			};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {
			ok: false,
			error: {
				message: message || String(err),
				code: "E_UNKNOWN",
				category: "network",
			},
		};
	}
}
