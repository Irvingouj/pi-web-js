/// <reference types="chrome" />
import {
	collectDocument,
	formatSnapshot,
	init as initDomSnapshot,
} from "@pi-oxide/dom-semantic-tree";
import { collectInlineSnapshot } from "../../../shared/collect-inline-snapshot.js";
import type { TreeSnapshot } from "../../../shared/generated.js";
import { logger } from "../../../shared/logger.js";
import type { AsyncResponse } from "../../../shared/tool-registry.js";
import type {
	DomFormatParams,
	DomSnapshotParams,
	DomSnapshotValue,
} from "../lib/types.js";

let domSnapshotReady: Promise<void> | null = null;

export function ensureDomSnapshot(): Promise<void> {
	if (!domSnapshotReady) {
		domSnapshotReady = initDomSnapshot();
	}
	return domSnapshotReady ?? Promise.resolve();
}

export async function handleDomSnapshot(
	params: DomSnapshotParams,
): Promise<AsyncResponse<DomSnapshotValue>> {
	const log = logger.child("runner");
	log.debug("handleDomSnapshot_start", {
		interactive_only: params?.interactive_only,
		max_nodes: params?.max_nodes,
	});
	try {
		await ensureDomSnapshot();
		if (typeof document === "undefined" || !document.body) {
			return {
				ok: false,
				error: {
					message: "Document body not available for snapshot",
					code: "E_SNAPSHOT",
					category: "resource",
				},
			};
		}
		const options: Record<string, unknown> = {};
		if (params) {
			if (params.max_nodes != null) options.maxNodes = Number(params.max_nodes);
			if (params.interactive_only != null)
				options.interactiveOnly = params.interactive_only;
		}
		const snap = collectDocument(options) as TreeSnapshot;
		const text = formatSnapshot(snap, "compact-text");
		log.debug("handleDomSnapshot_result", { status: "ok" });
		return {
			ok: true,
			value: { data: snap, text },
		};
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		log.debug("handleDomSnapshot_result", {
			status: "error",
			error: message || String(err),
		});
		return {
			ok: false,
			error: { message: message || String(err), code: "E_SNAPSHOT" },
		};
	}
}

export async function handleDomFormat(
	params: DomFormatParams,
): Promise<AsyncResponse<string>> {
	const log = logger.child("runner");
	log.debug("handleDomFormat_start", { format: params.format });
	try {
		await ensureDomSnapshot();
		const { snapshot, format } = params;
		const text = formatSnapshot(snapshot, format);
		log.debug("handleDomFormat_result", { status: "ok" });
		return { ok: true, value: text };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		log.debug("handleDomFormat_result", {
			status: "error",
			error: message || String(err),
		});
		return {
			ok: false,
			error: { message: message || String(err), code: "E_FORMAT" },
		};
	}
}

/** Local/test entry — production snapshots use the content-script path. */
export function buildSnapshotInTab(maxNodesArg: unknown) {
	const maxNodesNum =
		typeof maxNodesArg === "number" ? maxNodesArg : Number(maxNodesArg) || 500;
	return collectInlineSnapshot(maxNodesNum);
}
