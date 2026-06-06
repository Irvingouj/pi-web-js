#!/usr/bin/env python3
"""Split runtime.ts into focused modules; leave tools/ and index.ts untouched."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "src/main/runner/runtime.ts"
OUT = ROOT / "src/main/runner"

RANGES: list[tuple[str, int, int]] = [
    ("lib/constants.ts", 54, 59),
    ("lib/types.ts", 63, 128),
    ("lib/host-registry.ts", 130, 152),
    ("lib/params.ts", 154, 256),
    ("dom/snapshot-inline.ts", 258, 402),
    ("command.ts", 404, 417),
    ("fetch.ts", 419, 481),
    ("tab/execute.ts", 483, 631),
    ("tab/messaging.ts", 635, 721),
    ("sidepanel/dom.ts", 729, 741),
    ("dom/snapshot.ts", 745, 803),
    ("host.ts", 807, 849),
    ("chrome/internals.ts", 853, 1328),
]

HEADERS: dict[str, str] = {
    "lib/constants.ts": "",
    "lib/types.ts": '''import type { DomFormatParams, DomSnapshotParams, FetchParams } from "../../../shared/generated.js";

export type { DomFormatParams, DomSnapshotParams, FetchParams };

''',
    "lib/host-registry.ts": '''import { getTool } from "../../../shared/tool-registry.js";
import type { HostHandler } from "./types.js";

''',
    "lib/params.ts": '''import type { AsyncResponse } from "../../../shared/tool-registry.js";
import { makeError } from "./types.js";
import { asRecord } from "./params-helpers.js";

''',
    "dom/snapshot-inline.ts": "",
    "command.ts": '''import type { AsyncResponse, Command } from "../../../shared/tool-registry.js";
import { dispatchTool, getRunnerSignal, logger } from "../../../shared/tool-registry.js";
import { logger as logModule } from "../../../shared/logger.js";
import { isValidMainThreadAction } from "./lib/host-registry.js";
import { normalizeParams } from "./lib/params.js";
import { handleHostCallAction } from "./host.js";

const logger = logModule.child("runner");

''',
    "fetch.ts": '''import type { FetchParams } from "./lib/types.js";
import type { AsyncResponse } from "../../../shared/tool-registry.js";
import { throwIfAborted } from "../../../shared/tool-registry.js";
import { makeError } from "./lib/types.js";

''',
    "tab/execute.ts": '''import type { AsyncResponse } from "../../../shared/tool-registry.js";
import { logger } from "../../../shared/logger.js";
import { throwIfAborted } from "../../../shared/tool-registry.js";
import { getActiveTabId } from "../../tab-context.js";
import { normalizeChromeError } from "../chrome/internals.js";
import { INJECTION_DELAY_MS, RETRY_DELAY_MS } from "../lib/constants.js";

''',
    "tab/messaging.ts": '''import type { AsyncResponse } from "../../../shared/tool-registry.js";
import { logger } from "../../../shared/logger.js";
import { throwIfAborted } from "../../../shared/tool-registry.js";
import { unwrapContentScriptMessage } from "../../../shared/registry/content-script-response.js";
import { getActiveTabId } from "../../tab-context.js";
import { normalizeChromeError } from "../chrome/internals.js";
import { INJECTION_DELAY_MS, RETRY_DELAY_MS } from "../lib/constants.js";
import type { TabMessage } from "../lib/types.js";

''',
    "sidepanel/dom.ts": '''import { asRecord } from "../lib/params.js";

''',
    "dom/snapshot.ts": '''import { collectDocument, formatSnapshot, init as initDomSnapshot } from "@pi-oxide/dom-semantic-tree";
import type { TreeSnapshot } from "../../../shared/generated.js";
import type { DomFormatParams, DomSnapshotParams } from "./lib/types.js";
import type { AsyncResponse } from "../../../shared/tool-registry.js";
import { logger } from "../../../shared/logger.js";

let domSnapshotReady: Promise<void> | null = null;

export function ensureDomSnapshot(): Promise<void> {
	if (!domSnapshotReady) {
		domSnapshotReady = initDomSnapshot();
	}
	return domSnapshotReady ?? Promise.resolve();
}

''',
    "host.ts": '''import type { AsyncResponse } from "../../../shared/tool-registry.js";
import { logger } from "../../../shared/logger.js";
import { hostHandlers } from "./lib/host-registry.js";

''',
    "chrome/internals.ts": '''import { z } from "zod";
import { logger } from "../../../shared/logger.js";
import {
	registerJsCall,
	type CallContext,
	type ToolDocParam,
} from "../../../shared/tool-registry.js";
import type { AsyncError } from "../../../shared/tool-registry.js";
import { asRecord } from "../lib/params.js";
import { makeError } from "../lib/types.js";

''',
}

# params.ts includes asRecord - split helpers first
PARAMS_HELPERS = '''export function asRecord(params: unknown): Record<string, unknown> {
	return typeof params === "object" && params !== null && !Array.isArray(params)
		? (params as Record<string, unknown>)
		: {};
}

function toTabId(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "bigint") {
		const asNumber = Number(value);
		return Number.isSafeInteger(asNumber) ? asNumber : null;
	}
	return null;
}

export function extractTabId(params: unknown): number | null {
	if (Array.isArray(params)) {
		const first = params[0];
		const fromScalar = toTabId(first);
		if (fromScalar !== null) return fromScalar;
		const firstObj = asRecord(first);
		return (
			toTabId(firstObj.id) ??
			toTabId(firstObj.tabId) ??
			toTabId(firstObj.tab_id)
		);
	}
	const fromScalar = toTabId(params);
	if (fromScalar !== null) return fromScalar;
	const obj = asRecord(params);
	return toTabId(obj.id) ?? toTabId(obj.tabId) ?? toTabId(obj.tab_id);
}
'''

HOST_REGISTRY_EXTRA = '''
export { hostHandlers };
'''

RUNTIME_BARREL = '''/// <reference types="chrome" />
// Re-exports from decomposed runner modules.

export {
	type Command,
	setRunnerAbortController,
	throwIfAborted,
} from "../../shared/tool-registry.js";

export {
	getActiveTabId,
	resolveActiveTabId,
	initExtensionListeners,
	removeExtensionListeners,
} from "../tab-context.js";

export {
	DEFAULT_MAX_NODES,
	DEFAULT_TIMEOUT_MS,
	DEFAULT_SCROLL_AMOUNT,
	DEFAULT_POLL_INTERVAL_MS,
} from "./lib/constants.js";

export type { DomFormatParams, DomSnapshotParams, FetchParams } from "./lib/types.js";
export { makeError } from "./lib/types.js";

export {
	registerHostHandler,
	registerHostHandlers,
	isValidMainThreadAction,
} from "./lib/host-registry.js";

export { asRecord, extractTabId, normalizeParams, unwrapResult } from "./lib/params.js";

export { executeMainThreadCommand } from "./command.js";
export { handleFetch } from "./fetch.js";
export { executeInTab, waitForTabLoad } from "./tab/execute.js";
export { sendMessageToTab } from "./tab/messaging.js";
export { getElementByRefId, extractRefId } from "./sidepanel/dom.js";
export {
	ensureDomSnapshot,
	handleDomSnapshot,
	handleDomFormat,
	buildSnapshotInTab,
} from "./dom/snapshot.js";
export { handleHostCallAction } from "./host.js";
export { registerChromePassthrough } from "./chrome/internals.js";
'''


def slice_lines(text: str, start: int, end: int) -> str:
    lines = text.splitlines(keepends=True)
    return "".join(lines[start - 1 : end])


def main() -> None:
    text = RUNTIME.read_text()
    for sub in ["lib", "tab", "sidepanel", "dom", "chrome"]:
        (OUT / sub).mkdir(parents=True, exist_ok=True)

    (OUT / "lib" / "params-helpers.ts").write_text(
        "/// <reference types=\"chrome\" />\n" + PARAMS_HELPERS
    )

    # Fix lib/params to only have normalizeParams + unwrapResult after helpers extracted
    params_body = slice_lines(text, 191, 256)  # normalizers through unwrapResult
    params_imports = '''import type { AsyncResponse } from "../../../shared/tool-registry.js";
import { makeError } from "./types.js";
import { asRecord } from "./params-helpers.js";

'''
    (OUT / "lib" / "params.ts").write_text(
        "/// <reference types=\"chrome\" />\n" + params_imports + params_body
    )
    print("wrote lib/params.ts")

    for rel, start, end in RANGES:
        if rel == "lib/params.ts":
            continue
        body = slice_lines(text, start, end)
        header = HEADERS.get(rel, "")
        path = OUT / rel
        path.write_text("/// <reference types=\"chrome\" />\n" + header + body)
        print(f"wrote {rel}")

    host_reg = (OUT / "lib" / "host-registry.ts").read_text()
    if "export { hostHandlers }" not in host_reg:
        (OUT / "lib" / "host-registry.ts").write_text(
            host_reg.rstrip() + HOST_REGISTRY_EXTRA
        )

    # Merge snapshot-inline into dom/snapshot.ts
    inline = (OUT / "dom" / "snapshot-inline.ts").read_text()
    snap = (OUT / "dom" / "snapshot.ts").read_text()
    merged = snap + "\n" + inline.split("\n", 1)[1]  # strip duplicate reference
    (OUT / "dom" / "snapshot.ts").write_text(merged)
    (OUT / "dom" / "snapshot-inline.ts").unlink()

    # Export buildSnapshotInTab from merged snapshot
    # Fix host-registry: export hostHandlers
    host_content = (OUT / "lib" / "host-registry.ts").read_text()
    host_content = host_content.replace(
        "const hostHandlers",
        "export const hostHandlers",
    )
    (OUT / "lib" / "host-registry.ts").write_text(host_content)

    # Fix lib/types - export HostHandler and TabMessage
    types_content = (OUT / "lib" / "types.ts").read_text()
    types_content = types_content.replace(
        "type HostHandler",
        "export type HostHandler",
    )
    types_content = types_content.replace(
        "type TabMessage",
        "export type TabMessage",
    )
    types_content = types_content.replace(
        "type FetchValue",
        "export type FetchValue",
    )
    types_content = types_content.replace(
        "type DomSnapshotValue",
        "export type DomSnapshotValue",
    )
    (OUT / "lib" / "types.ts").write_text(types_content)

    # Fix constants - export private constants
    const_content = (OUT / "lib" / "constants.ts").read_text()
    const_content = const_content.replace(
        "const RETRY_DELAY_MS",
        "export const RETRY_DELAY_MS",
    )
    const_content = const_content.replace(
        "const INJECTION_DELAY_MS",
        "export const INJECTION_DELAY_MS",
    )
    (OUT / "lib" / "constants.ts").write_text(const_content)

  # Fix command.ts imports
    cmd = (OUT / "command.ts").read_text()
    cmd = cmd.replace(
        "import { dispatchTool, getRunnerSignal, logger } from",
        "import { dispatchTool, getRunnerSignal } from",
    )
    (OUT / "command.ts").write_text(cmd)

    # Fix host.ts - hostHandlers export
    host_ts = (OUT / "host.ts").read_text()
    host_ts = host_ts.replace(
        "import { hostHandlers } from",
        "import { hostHandlers } from",
    )

    # dom/snapshot export buildSnapshotInTab - add export if missing
    snap_text = (OUT / "dom" / "snapshot.ts").read_text()
    if "export function buildSnapshotInTab" not in snap_text:
        snap_text = snap_text.replace(
            "export function buildSnapshotInTab",
            "export function buildSnapshotInTab",
            1,
        )
    (OUT / "dom" / "snapshot.ts").write_text(snap_text)

    RUNTIME.write_text(RUNTIME_BARREL)
    print("wrote runtime.ts barrel")


if __name__ == "__main__":
    main()
