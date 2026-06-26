// Multi-frame snapshot merge.
// Pure-ish: enumerate → collect → merge pipeline.
/// <reference types="chrome" />

import type { InlineSnapshotNode } from "../../shared/cross/collect-inline-snapshot.js";
import type { Command } from "../../shared/cross/manifest.js";
import { unwrapContentScriptMessage } from "../../shared/main/content-script-response.js";

// ─── Types ───────────────────────────────────────────────────────

type FrameInfo = { frameId: number; url: string };

type FrameSnapshot = {
	frameId: number;
	url: string;
	ok: boolean;
	text?: string;
	data?: Record<string, unknown>;
	error?: string;
};

const SNAPSHOT_ACTIONS = new Set([
	"page_snapshot_text",
	"page_snapshot_data",
	"page_snapshot",
	"page_snapshot_query",
]);

export function isSnapshotAction(action: string): boolean {
	return SNAPSHOT_ACTIONS.has(action);
}

function isTextAction(action: string): boolean {
	return action === "page_snapshot_text" || action === "page_snapshot";
}

// ─── Frame enumeration ───────────────────────────────────────────

/**
 * Enumerate http(s) frames in a tab. Falls back to frame-0 only if
 * webNavigation is unavailable or throws.
 */
async function enumerateFrames(tabId: number): Promise<FrameInfo[]> {
	const chromeApi = window.chrome;
	try {
		const raw = await new Promise<
			chrome.webNavigation.GetAllFrameResultDetails[] | null
		>((resolve, reject) => {
			chromeApi.webNavigation.getAllFrames({ tabId }, (result) => {
				if (chrome.runtime.lastError) {
					reject(new Error(chrome.runtime.lastError.message));
				} else {
					resolve(result);
				}
			});
		});
		if (raw && raw.length > 0) {
			return raw
				.filter((f) => f.frameId === 0 || /^https?:/.test(f.url ?? ""))
				.map((f) => ({ frameId: f.frameId, url: f.url ?? "" }));
		}
	} catch {
		// webNavigation unavailable — fall through to frame-0 fallback
	}
	return [{ frameId: 0, url: "" }];
}

// ─── Collect per-frame snapshots ─────────────────────────────────

/**
 * Send a registryCall to each frame in parallel and collect results.
 */
async function collectFrameSnapshots(
	frames: FrameInfo[],
	cmd: Command,
	tabId: number,
	relayId?: string,
): Promise<FrameSnapshot[]> {
	const chromeApi = window.chrome;

	return Promise.all(
		frames.map(async (frame): Promise<FrameSnapshot> => {
			try {
				const sendOpts = { frameId: frame.frameId };
				const raw = await chromeApi.tabs.sendMessage(
					tabId,
					{
						type: "registryCall",
						id: relayId,
						action: cmd.action,
						params: cmd.params,
						callId: cmd.call_id,
						runId: cmd.runId,
					},
					sendOpts,
				);
				const parsed = unwrapContentScriptMessage(raw);
				if (!parsed.ok) {
					return {
						frameId: frame.frameId,
						url: frame.url,
						ok: false,
						error:
							(parsed.error as { message?: string })?.message ??
							"Snapshot error",
					};
				}
				if (typeof parsed.value === "string") {
					return {
						frameId: frame.frameId,
						url: frame.url,
						ok: true,
						text: parsed.value,
					};
				}
				return {
					frameId: frame.frameId,
					url: frame.url,
					ok: true,
					data: parsed.value as Record<string, unknown>,
				};
			} catch (err) {
				return {
					frameId: frame.frameId,
					url: frame.url,
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		}),
	);
}

// ─── RefId rewriting (pure) ──────────────────────────────────────

/** Replace [eN] with [fX_eN] in snapshot text. */
function rewriteTextRefIds(text: string, frameId: number): string {
	if (frameId === 0) return text;
	return text.replace(/\[e(\d+)\]/g, (_m, n) => `[f${frameId}_e${n}]`);
}

/** Replace refId/parentRefId in snapshot nodes. */
function rewriteNodeRefIds(
	nodes: InlineSnapshotNode[],
	frameId: number,
): InlineSnapshotNode[] {
	if (frameId === 0) return nodes;
	const prefix = `f${frameId}_`;
	return nodes.map((n) => ({
		...n,
		refId: prefix + n.refId,
		parentRefId: n.parentRefId ? prefix + n.parentRefId : undefined,
	}));
}

// ─── Merge text snapshots ────────────────────────────────────────

function mergeText(results: FrameSnapshot[]): string {
	const parts: string[] = [];

	for (const r of results) {
		if (!r.ok) {
			parts.push(
				`--- Frame ${r.frameId}: ${r.url || "unknown"} (unreachable) ---`,
			);
			continue;
		}
		const text = rewriteTextRefIds(r.text ?? "", r.frameId);
		if (r.frameId === 0) {
			parts.push(text);
		} else {
			parts.push(`--- Frame ${r.frameId}: ${r.url} ---\n${text}`);
		}
	}

	return parts.join("\n\n");
}

// ─── Merge object snapshots ──────────────────────────────────────

function mergeObject(results: FrameSnapshot[]): Record<string, unknown> {
	const allText: string[] = [];
	const allNodes: InlineSnapshotNode[] = [];
	let url = "";
	let title = "";
	let viewport: { width: number; height: number } = { width: 0, height: 0 };
	let observationId: string | undefined;

	for (const r of results) {
		if (!r.ok || !r.data) {
			allText.push(
				`--- Frame ${r.frameId}: ${r.url || "unknown"} (unreachable) ---`,
			);
			continue;
		}
		const t = rewriteTextRefIds(String(r.data.text ?? ""), r.frameId);
		const nodes = rewriteNodeRefIds(
			Array.isArray(r.data.nodes) ? (r.data.nodes as InlineSnapshotNode[]) : [],
			r.frameId,
		);

		if (r.frameId === 0) {
			url = String(r.data.url ?? "");
			title = String(r.data.title ?? "");
			viewport =
				(r.data.viewport as { width: number; height: number }) ?? viewport;
			observationId =
				typeof r.data.observationId === "string"
					? r.data.observationId
					: undefined;
			allText.push(t);
		} else {
			allText.push(`--- Frame ${r.frameId}: ${r.url} ---\n${t}`);
		}
		allNodes.push(...nodes);
	}

	const merged: Record<string, unknown> = {
		text: allText.join("\n\n"),
		nodes: allNodes,
		url,
		title,
		viewport,
	};
	if (observationId) merged.observationId = observationId;
	return merged;
}

// ─── Entry point ─────────────────────────────────────────────────

/**
 * Collect snapshots from every http(s) frame in the tab, merge them,
 * and return the unified result. Pipeline: enumerate → collect → merge.
 */
export async function executeMultiFrameSnapshot(
	cmd: Command,
	tabId: number,
	relayId?: string,
): Promise<unknown> {
	const frames = await enumerateFrames(tabId);
	const results = await collectFrameSnapshots(frames, cmd, tabId, relayId);

	if (isTextAction(cmd.action)) {
		return { ok: true, value: mergeText(results) };
	}
	return { ok: true, value: mergeObject(results) };
}
