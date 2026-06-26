import { z } from "zod";
import { bigintLike } from "./helpers.js";

// ─── Network / Sleep schemas ───────────────────────────────────

export const FetchParamsSchema = z
	.object({
		url: z.string().describe("URL to fetch"),
		method: z
			.string()
			.default("GET")
			.describe("HTTP method (GET, POST, PUT, DELETE, etc.)"),
		headers: z
			.record(z.string())
			.default({})
			.describe("Request headers as key-value pairs"),
		body: z.string().nullable().default(null).describe("Request body string"),
		timeout: bigintLike().default(30000n).describe("Timeout in milliseconds"),
		store: z
			.boolean()
			.optional()
			.describe(
				"When true, store binary responses as a handle instead of returning body bytes",
			),
		options: z.object({}).passthrough().optional().describe("Fetch options"),
	})
	.passthrough();

export const SleepParamsSchema = z.object({
	duration: bigintLike().describe("Duration to sleep in milliseconds"),
});
