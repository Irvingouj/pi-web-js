/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../shared/cross/schemas.js";
import { registerJsCall } from "../../../shared/main/tool-registry.js";
import type { FetchParams } from "../runtime.js";
import { handleFetch, unwrapResult } from "../runtime.js";

// ─── Network / Sleep ─────────────────────────────────────────────

registerJsCall({
	action: "fetch",
	namespace: "network",
	name: "fetch",
	description: "Make an HTTP request",
	params: schemas.FetchParamsSchema,
	returns: schemas.FetchValueSchema,
	fields: ["url"],
	aliases: [{ namespace: "web", name: "fetch", fields: ["url"] }],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const result = await handleFetch(params as FetchParams, _ctx.signal);
		return unwrapResult(result);
	},
	paramTypes: [
		{
			name: "url",
			type: "string",
			required: true,
			description: "URL to fetch (url)",
		},
		{
			name: "method",
			type: "string",
			required: false,
			description: "HTTP method (GET, POST, etc.) (literal)",
		},
		{
			name: "headers",
			type: "{ [key: string]: string }",
			required: false,
			description: "Request headers (literal)",
		},
		{
			name: "body",
			type: "string",
			required: false,
			description: "Request body (literal)",
		},
		{
			name: "timeout",
			type: "number",
			required: false,
			description: "Timeout in milliseconds (literal)",
		},
	],
	returnDoc:
		"DTO with `{ body, headers, ok, status }` — not a native Response object",
	errorCode: "E_UNKNOWN",
	errorCategory: "network",

	example: 'network.fetch("https://example.com")',
});

registerJsCall({
	action: "sleep",
	namespace: "util",
	name: "sleep",
	description: "Sleep for a duration",
	params: schemas.SleepParamsSchema,
	returns: z.null(),
	fields: ["duration"],
	aliases: [{ namespace: "web", name: "sleep", fields: ["duration"] }],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		await new Promise((resolve) =>
			setTimeout(resolve, Number(params.duration)),
		);
		return null;
	},
	paramTypes: [
		{
			name: "duration",
			type: "number",
			required: true,
			description: "Duration to sleep in milliseconds (literal)",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",

	example: "util.sleep(1000)",
});

registerJsCall({
	action: "mock_async",
	namespace: "util",
	name: "mock_async",
	description: "Mock async call for testing",
	params: z.union([
		z.string(),
		z.object({ label: z.string().optional() }).passthrough(),
	]),
	returns: z.string(),
	owner: "main-thread",
	handler: async (params, _ctx) => {
		// prelude.js passes the argument directly:
		// web.mock_async('label') -> params = 'label' (string)
		// web.mock_async({label: 'x'}) -> params = {label: 'x'} (object)
		if (typeof params === "string") return params;
		if (params && typeof params === "object" && "label" in params) {
			return (
				((params as Record<string, unknown>).label as string) ?? "mock_async"
			);
		}
		return "mock_async";
	},
	paramTypes: [
		{
			name: "label",
			type: "string",
			required: false,
			description: "Test label (label)",
		},
	],
	returnDoc: "Label string",
	errorCode: "E_UNKNOWN",

	example: 'util.mock_async({ tabId: 123, script: "document.title" })',
});
