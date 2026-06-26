import { z } from "zod";
import { bigintLike, elementTargetParams } from "./helpers.js";

// ─── Sidepanel action schemas ──────────────────────────────────

export const SidepanelClickParamsSchema = elementTargetParams();
export const SidepanelDblClickParamsSchema = elementTargetParams();
export const SidepanelFillParamsSchema = elementTargetParams({
	value: z.string().optional().describe("Value to fill into the element"),
});
export const SidepanelTypeParamsSchema = elementTargetParams({
	text: z.string().optional().describe("Text to type into the element"),
});
export const SidepanelPressParamsSchema = z.object({
	key: z
		.string()
		.optional()
		.describe("Key to press (e.g. Enter, Escape, ArrowDown)"),
});
export const SidepanelSelectParamsSchema = elementTargetParams({
	value: z.string().optional().describe("Value to select in the dropdown"),
});
export const SidepanelCheckParamsSchema = elementTargetParams({
	checked: z
		.boolean()
		.optional()
		.describe("Desired checked state (true to check, false to uncheck)"),
});
export const SidepanelHoverParamsSchema = elementTargetParams();
export const SidepanelUnhoverParamsSchema = z.object({});
export const SidepanelScrollParamsSchema = z.object({
	direction: z
		.string()
		.optional()
		.describe("Scroll direction: up, down, left, or right"),
	amount: z.number().optional().describe("Pixels to scroll"),
});
export const SidepanelScrollToParamsSchema = elementTargetParams();
export const SidepanelAppendParamsSchema = elementTargetParams({
	text: z.string().optional().describe("Text to append into the element"),
});

export const SidepanelUrlParamsSchema = z.object({});
export const SidepanelTitleParamsSchema = z.object({});
export const SidepanelWaitParamsSchema = z.object({
	duration: bigintLike()
		.default(1000n)
		.describe("Duration to wait in milliseconds"),
});

export const SidepanelSnapshotParamsSchema = z.object({
	interactive_only: z
		.boolean()
		.default(false)
		.describe("Only include interactive elements"),
	max_nodes: bigintLike()
		.default(500n)
		.describe("Maximum number of nodes to include in snapshot"),
});
export const SidepanelSnapshotTextParamsSchema = z.object({
	interactive_only: z
		.boolean()
		.default(false)
		.describe("Only include interactive elements"),
	max_nodes: bigintLike()
		.default(500n)
		.describe("Maximum number of nodes to include in snapshot"),
});
export const SidepanelSnapshotDataParamsSchema = z.object({
	interactive_only: z
		.boolean()
		.default(false)
		.describe("Only include interactive elements"),
	max_nodes: bigintLike()
		.default(500n)
		.describe("Maximum number of nodes to include in snapshot"),
});
