import { z } from "zod";
import type { DomSnapshotParams } from "../generated.js";
import { bigintLike } from "./helpers.js";

// ─── DOM schemas ───────────────────────────────────────────────

export const DomSnapshotParamsSchema = z.object({
	interactive_only: z
		.boolean()
		.default(false)
		.describe("Only include interactive elements"),
	max_nodes: bigintLike()
		.default(500n)
		.describe("Maximum number of nodes to include in snapshot"),
});

export const DomFormatParamsSchema = z.object({
	snapshot: z
		.object({})
		.passthrough()
		.describe("Raw DOM snapshot data to format"),
	format: z.string().optional().describe("Output format (e.g. markdown, html)"),
});


// ─── Page snapshot schemas ─────────────────────────────────────

export const PageSnapshotParamsSchema = z
	.object({
		max_nodes: z.number().optional().describe("Maximum nodes to include"),
		options: z.object({}).passthrough().optional().describe("Snapshot options"),
	})
	.passthrough();
export const PageSnapshotTextParamsSchema = z
	.object({
		max_nodes: z.number().optional().describe("Maximum nodes to include"),
		options: z.object({}).passthrough().optional().describe("Snapshot options"),
	})
	.passthrough();
export const PageSnapshotDataParamsSchema = z
	.object({
		max_nodes: z.number().optional().describe("Maximum nodes to include"),
		options: z.object({}).passthrough().optional().describe("Snapshot options"),
	})
	.passthrough();

export const SnapshotQueryFilterSchema = z
	.object({
		role: z
			.union([z.string(), z.array(z.string())])
			.optional()
			.describe("Filter by ARIA role"),
		tag: z
			.union([z.string(), z.array(z.string())])
			.optional()
			.describe("Filter by HTML tag"),
		text: z
			.string()
			.optional()
			.describe("Filter by text content (case-insensitive substring)"),
		name: z
			.string()
			.optional()
			.describe("Filter by accessible name (case-insensitive substring)"),
		interactiveOnly: z
			.boolean()
			.optional()
			.describe("Only include interactive elements"),
		href: z
			.string()
			.optional()
			.describe("Filter by href pattern (case-insensitive substring)"),
		src: z
			.string()
			.optional()
			.describe("Filter by src pattern (case-insensitive substring)"),
		limit: z
			.number()
			.positive()
			.optional()
			.describe("Maximum filtered nodes to return"),
	})
	.passthrough();

export const PageSnapshotQueryParamsSchema = z
	.object({
		filter: SnapshotQueryFilterSchema.optional().describe(
			"Semantic filter criteria",
		),
		max_nodes: z
			.number()
			.optional()
			.describe("Maximum nodes to collect before filtering"),
	})
	.passthrough();

export const TabSnapshotQueryParamsSchema =
	PageSnapshotQueryParamsSchema.extend({
		tabId: z.number().describe("Tab ID"),
	});

