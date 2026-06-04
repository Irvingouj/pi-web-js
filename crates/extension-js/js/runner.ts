/// <reference types="chrome" />
// Main-thread command executor for extension-js runner
// Handles all commands relayed from the extension Worker.

import {
	collectDocument,
	formatSnapshot,
	init as initDomSnapshot,
	type TreeSnapshot,
} from "@pi-oxide/dom-semantic-tree";
import { z } from "zod";
import { logger } from "./logger.js";
import * as schemas from "./schemas.js";
import {
	type AsyncError,
	type AsyncResponse,
	type Command,
	dispatchTool,
	registerTool,
	type ToolDocParam,
	throwIfAborted,
} from "./tool-registry.js";

export { type Command, setRunnerAbortController } from "./tool-registry.js";

// ─── In-memory VFS for extension context ──────────────────────────

const extFs = (() => {
	const files = new Map<string, Uint8Array>();
	const dirs = new Set<string>();
	dirs.add("/");

	function ensureParentDir(path: string) {
		const parts = path.split("/").filter(Boolean);
		for (let i = 1; i < parts.length; i++) {
			const d = `/${parts.slice(0, i).join("/")}`;
			dirs.add(d);
		}
	}

	function toBytes(data: string): Uint8Array {
		return new TextEncoder().encode(data);
	}

	function fromBytes(bytes: Uint8Array): string {
		return new TextDecoder().decode(bytes);
	}

	async function sha256Bytes(data: Uint8Array): Promise<string> {
		const hash = await crypto.subtle.digest("SHA-256", data as BufferSource);
		return Array.from(new Uint8Array(hash))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	async function sha1Bytes(data: Uint8Array): Promise<string> {
		const hash = await crypto.subtle.digest("SHA-1", data as BufferSource);
		return Array.from(new Uint8Array(hash))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	return {
		exists(path: string): boolean {
			return files.has(path) || dirs.has(path);
		},
		stat(
			path: string,
		): { path: string; name: string; kind: string; size: number } | null {
			const f = files.get(path);
			if (f) {
				const parts = path.split("/");
				return {
					path,
					name: parts[parts.length - 1] || "",
					kind: "File",
					size: f.length,
				};
			}
			if (dirs.has(path)) {
				const parts = path.split("/");
				return {
					path,
					name: parts[parts.length - 1] || "",
					kind: "Directory",
					size: 0,
				};
			}
			return null;
		},
		list(path: string): { name: string; kind: string }[] | null {
			if (!dirs.has(path)) return null;
			const prefix = path === "/" ? "/" : `${path}/`;
			const entries: { name: string; kind: string }[] = [];
			const seen = new Set<string>();
			for (const p of files.keys()) {
				if (p.startsWith(prefix)) {
					const rest = p.slice(prefix.length);
					const name = rest.split("/")[0];
					if (name && !seen.has(name)) {
						seen.add(name);
						entries.push({ name, kind: "File" });
					}
				}
			}
			for (const d of dirs) {
				if (d.startsWith(prefix) && d !== path) {
					const rest = d.slice(prefix.length);
					const name = rest.split("/")[0];
					if (name && !seen.has(name)) {
						seen.add(name);
						entries.push({ name, kind: "Directory" });
					}
				}
			}
			return entries;
		},
		mkdir(path: string): void {
			dirs.add(path);
			ensureParentDir(path);
		},
		delete(path: string): void {
			// Delete file or directory (recursive)
			files.delete(path);
			const prefix = path === "/" ? "/" : `${path}/`;
			for (const p of [...files.keys()]) {
				if (p.startsWith(prefix)) files.delete(p);
			}
			for (const d of [...dirs]) {
				if (d === path || d.startsWith(prefix)) dirs.delete(d);
			}
		},
		copy(from: string, to: string): void {
			const data = files.get(from);
			if (!data) return;
			files.set(to, new Uint8Array(data));
			ensureParentDir(to);
		},
		move(from: string, to: string): void {
			const data = files.get(from);
			if (!data) return;
			files.set(to, new Uint8Array(data));
			files.delete(from);
			ensureParentDir(to);
		},
		read(path: string): string | null {
			const data = files.get(path);
			if (!data) return null;
			return btoa(fromBytes(data));
		},
		readText(path: string): string | null {
			const data = files.get(path);
			if (!data) return null;
			return fromBytes(data);
		},
		write(path: string, data: string): void {
			files.set(path, toBytes(data));
			ensureParentDir(path);
		},
		writeText(path: string, text: string): void {
			files.set(path, toBytes(text));
			ensureParentDir(path);
		},
		append(path: string, data: string): void {
			const existing = files.get(path) || new Uint8Array(0);
			const incoming = toBytes(data);
			const merged = new Uint8Array(existing.length + incoming.length);
			merged.set(existing);
			merged.set(incoming, existing.length);
			files.set(path, merged);
			ensureParentDir(path);
		},
		appendText(path: string, text: string): void {
			const existing = files.get(path);
			const prev = existing ? fromBytes(existing) : "";
			files.set(path, toBytes(prev + text));
			ensureParentDir(path);
		},
		update(path: string, offset: number, data: string): void {
			const existing = files.get(path);
			if (!existing) return;
			const incoming = toBytes(data);
			const updated = new Uint8Array(
				Math.max(existing.length, offset + incoming.length),
			);
			updated.set(existing);
			updated.set(incoming, offset);
			files.set(path, updated);
		},
		readRange(path: string, offset: number, len: number): string | null {
			const data = files.get(path);
			if (!data) return null;
			const slice = data.slice(offset, offset + len);
			return btoa(fromBytes(slice));
		},
		async hash(path: string, algo: string): Promise<string | null> {
			const data = files.get(path);
			if (!data) return null;
			if (algo === "sha1") return sha1Bytes(data);
			return sha256Bytes(data);
		},
	};
})();

let domSnapshotReady: Promise<void> | null = null;

function ensureDomSnapshot(): Promise<void> {
	if (!domSnapshotReady) {
		domSnapshotReady = initDomSnapshot();
	}
	return domSnapshotReady ?? Promise.resolve();
}

// ─── Constants ─────────────────────────────────────────────────

const DEFAULT_MAX_NODES = 500;
const DEFAULT_TIMEOUT_MS = 30_000;
const _DEFAULT_WAIT_MS = 1000;
const DEFAULT_SCROLL_AMOUNT = 300;
const DEFAULT_POLL_INTERVAL_MS = 100;
const _MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 500;
const INJECTION_DELAY_MS = 300;
const _NAME_SLICE_LIMIT = 60;

// ─── Generated types from Rust ts-rs ─────────────────────────__

import type { DomSnapshotParams, FetchParams } from "./generated.js";

declare global {
	interface Window {
		__hostHandlers?: Record<string, HostHandler>;
	}
}

// ─── Types ─────────────────────────────────────────────────────

type HostHandler<T = unknown, R = unknown> = (params: T) => Promise<R>;

type FetchValue = {
	status: number;
	ok: boolean;
	headers: Record<string, string>;
	body: string;
};

type DomSnapshotValue = {
	data: TreeSnapshot;
	text: string;
};

type TabMessage =
	| { action: "click"; params: { refId?: string; label?: string } }
	| {
			action: "fill";
			params: { refId?: string; value: string; label?: string };
	  }
	| { action: "type"; params: { refId?: string; text: string; label?: string } }
	| {
			action: "append";
			params: { refId?: string; text: string; label?: string };
	  }
	| { action: "press"; params: { key: string } }
	| { action: "select"; params: { refId: string; value: string } }
	| { action: "check"; params: { refId: string; checked: boolean } }
	| { action: "hover"; params: { refId: string } }
	| { action: "unhover"; params: Record<string, never> }
	| { action: "scroll"; params: { direction: string; amount: number } }
	| { action: "scrollTo"; params: { x: number; y: number; refId?: string } }
	| { action: "dblclick"; params: { refId: string } }
	| { action: "back"; params: Record<string, never> };

type SnapshotFormat = "compact-text" | "json" | "json-pretty";

type DomFormatParams = {
	snapshot: TreeSnapshot;
	format?: SnapshotFormat;
};

// Branded error type for attaching codes/categories without unsafe casts
type CodedError = Error & { code: string; category?: string };

function makeError(
	message: string,
	code: string,
	category?: string,
): CodedError {
	const err = new Error(message) as CodedError;
	err.code = code;
	if (category) err.category = category;
	return err;
}

// ─── Host handler registry ─────────────────────────────────────

const hostHandlers: Record<string, HostHandler> = {};

export function registerHostHandler<T, R>(
	action: string,
	handler: (params: T) => Promise<R>,
) {
	hostHandlers[action] = handler as HostHandler;
}

export function registerHostHandlers(handlers: Record<string, HostHandler>) {
	Object.assign(hostHandlers, handlers);
}

// ─── Helpers for extracting values from unknown params ─────────

function asRecord(params: unknown): Record<string, unknown> {
	return typeof params === "object" && params !== null && !Array.isArray(params)
		? (params as Record<string, unknown>)
		: {};
}

function extractTabId(params: unknown): number | null {
	if (Array.isArray(params)) {
		const first = params[0];
		if (typeof first === "number") return first;
		const firstObj = asRecord(first);
		if (typeof firstObj.id === "number") return firstObj.id;
		if (typeof firstObj.tabId === "number") return firstObj.tabId;
		if (typeof firstObj.tab_id === "number") return firstObj.tab_id;
		return null;
	}
	if (typeof params === "number") return params;
	const obj = asRecord(params);
	if (typeof obj.id === "number") return obj.id;
	const tabId = obj.tabId ?? obj.tab_id;
	return typeof tabId === "number" ? tabId : null;
}

// ─── Main command dispatcher ─────────────────────────────────────

const scalarNormalizers = new Map<string, (v: number | bigint) => unknown>([
	["tab_back", (v) => ({ tabId: v })],
	["tab_unhover", (v) => ({ tabId: v })],
	["tab_wait_for_load", (v) => ({ tabId: v })],
	["tab_scroll", (v) => ({ tabId: v })],
]);

const arrayNormalizers = new Map<string, (arr: unknown[]) => unknown>([
	["tab_click", (p) => ({ tabId: p[0], refId: p[1] })],
	["tab_fill", (p) => ({ tabId: p[0], refId: p[1], value: p[2] })],
	["tab_type", (p) => ({ tabId: p[0], refId: p[1], text: p[2] })],
	["tab_press", (p) => ({ tabId: p[0], key: p[1] })],
	["tab_select", (p) => ({ tabId: p[0], refId: p[1], value: p[2] })],
	["tab_check", (p) => ({ tabId: p[0], refId: p[1], checked: p[2] ?? true })],
	["tab_hover", (p) => ({ tabId: p[0], refId: p[1] })],
	["tab_unhover", (p) => ({ tabId: p[0] })],
	[
		"tab_scroll",
		(p) => ({
			tabId: p[0],
			direction: p[1] ?? "down",
			amount: p[2] ?? DEFAULT_SCROLL_AMOUNT,
		}),
	],
	["tab_dblclick", (p) => ({ tabId: p[0], refId: p[1] })],
	["tab_back", (p) => ({ tabId: p[0] })],
	[
		"tab_wait_for_load",
		(p) => ({ tabId: p[0], timeout: p[1] ?? BigInt(DEFAULT_TIMEOUT_MS) }),
	],
	[
		"tab_scroll_to",
		(p) => ({ tabId: p[0], x: p[1] ?? 0, y: p[2] ?? 0, refId: p[3] ?? null }),
	],
	["tab_evaluate", (p) => ({ tabId: p[0], script: p[1] })],
	["tab_fetch", (p) => ({ tabId: p[0], url: p[1], options: p[2] ?? {} })],
	["tab_snapshot", (p) => ({ tabId: p[0], options: p[1] ?? {} })],
	["tab_snapshot_text", (p) => ({ tabId: p[0], options: p[1] ?? {} })],
	["tab_snapshot_data", (p) => ({ tabId: p[0], options: p[1] ?? {} })],
]);

export function normalizeParams(action: string, params: unknown): unknown {
	if (typeof params === "number" || typeof params === "bigint") {
		const normalizer = scalarNormalizers.get(action);
		if (normalizer) return normalizer(params);
	}
	if (Array.isArray(params)) {
		const normalizer = arrayNormalizers.get(action);
		if (normalizer) return normalizer(params);
	}
	return params;
}

function unwrapResult<T>(result: AsyncResponse<T>): T {
	if (!result.ok) {
		throw makeError(
			result.error.message,
			result.error.code,
			result.error.category,
		);
	}
	return result.value;
}

// Self-contained snapshot builder injected into tabs via executeInTab
function buildSnapshotInTab(maxNodesArg: unknown) {
	const maxNodesNum = typeof maxNodesArg === "number" ? maxNodesArg : 500;
	function getAccessibleRole(el: Element): string {
		const tag = el.tagName.toLowerCase();
		const ariaRole = el.getAttribute("role");
		if (ariaRole) return ariaRole;
		if (
			tag === "button" ||
			(tag === "input" && (el as HTMLInputElement).type === "submit")
		)
			return "button";
		if (tag === "a") return "link";
		if (tag === "input") {
			const type = (el as HTMLInputElement).type;
			if (
				type === "text" ||
				type === "email" ||
				type === "password" ||
				type === "search"
			)
				return "textbox";
			if (type === "checkbox") return "checkbox";
			if (type === "radio") return "radio";
			if (type === "submit" || type === "button") return "button";
		}
		if (tag === "textarea") return "textbox";
		if (tag === "select") return "combobox";
		if (tag === "img") return "img";
		if (
			tag === "h1" ||
			tag === "h2" ||
			tag === "h3" ||
			tag === "h4" ||
			tag === "h5" ||
			tag === "h6"
		)
			return "heading";
		if (tag === "li") return "listitem";
		if (tag === "ul" || tag === "ol") return "list";
		if (tag === "table") return "table";
		if (tag === "tr") return "row";
		if (tag === "td" || tag === "th") return "cell";
		if (tag === "nav") return "navigation";
		if (tag === "main") return "main";
		if (tag === "article") return "article";
		if (tag === "section") return "region";
		if (tag === "aside") return "complementary";
		if (tag === "form") return "form";
		if (tag === "dialog" || tag === "modal") return "dialog";
		if (tag === "figure") return "figure";
		if (tag === "figcaption") return "caption";
		if (el.getAttribute("onclick") || (el as HTMLElement).onclick)
			return "button";
		return "generic";
	}
	function getAccessibleName(el: Element): string {
		const ariaLabel = el.getAttribute("aria-label");
		if (ariaLabel) return ariaLabel;
		const labelledBy = el.getAttribute("aria-labelledby");
		if (labelledBy) {
			const labelEl = document.getElementById(labelledBy);
			if (labelEl) return labelEl.textContent?.slice(0, 60) || "";
		}
		const tag = el.tagName.toLowerCase();
		if (tag === "img") {
			const alt = el.getAttribute("alt");
			if (alt) return alt;
		}
		const title = (el as HTMLElement).title;
		if (title) return title;
		const role = getAccessibleRole(el);
		if (
			role !== "generic" &&
			role !== "list" &&
			role !== "table" &&
			role !== "row" &&
			role !== "region" &&
			role !== "navigation" &&
			role !== "main"
		) {
			const text = el.textContent?.trim().slice(0, 60) || "";
			return text;
		}
		return "";
	}
	function shouldInclude(el: Element): boolean {
		const role = getAccessibleRole(el);
		if (role === "generic") return false;
		if (role === "presentation" || role === "none") return false;
		if ((el as HTMLElement).hidden) return false;
		const style = window.getComputedStyle(el);
		if (style.display === "none" || style.visibility === "hidden") return false;
		return true;
	}
	type DomNode = { refId: number; role: string; tag: string; name?: string };
	const nodes: DomNode[] = [];
	const lines: string[] = [];
	let nextRefId = 1;
	function traverse(el: Element, depth: number) {
		if (nodes.length >= maxNodesNum) return;
		const tag = el.tagName.toLowerCase();
		if (
			tag === "script" ||
			tag === "style" ||
			tag === "noscript" ||
			tag === "template"
		)
			return;
		const included = shouldInclude(el);
		let currentDepth = depth;
		if (included) {
			const refId = nextRefId++;
			el.setAttribute("data-ref-id", String(refId));
			const role = getAccessibleRole(el);
			const name = getAccessibleName(el);
			const node: DomNode = { refId, role, tag };
			if (name) node.name = name;
			nodes.push(node);
			const indent = "  ".repeat(depth);
			const parts: string[] = [`${indent}- ${role}`];
			if (name) parts.push(`"${name.replace(/"/g, '\\"')}"`);
			parts.push(`[ref=${refId}]`);
			lines.push(parts.join(" "));
			currentDepth = depth + 1;
		}
		for (const child of el.children) {
			traverse(child, currentDepth);
		}
	}
	if (document.body) traverse(document.body, 0);
	const header = [
		`URL: ${window.location.href}`,
		`Title: ${document.title}`,
		"",
	];
	const text = header.concat(lines).join("\n");
	return {
		text,
		nodes,
		url: window.location.href,
		title: document.title,
		viewport: { width: window.innerWidth, height: window.innerHeight },
	};
}

export async function executeMainThreadCommand(
	command: Command,
): Promise<AsyncResponse> {
	throwIfAborted();
	const log = logger.child("runner"),
		finish = log.timer("command_dispatch", {
			action: command.action,
			commandId: command.call_id,
			runId: command.runId,
		});
	if (command.action.startsWith("host_")) {
		const r = await handleHostCallAction(
			command.action.slice(5),
			command.params,
		);
		finish({ ok: r.ok, handler: "host" });
		return r;
	}
	const n = normalizeParams(command.action, command.params),
		r = await dispatchTool(command.action, n);
	finish({ ok: r.ok });
	return r;
}

// ─── Fetch handler ───────────────────────────────────────────────

async function handleFetch(
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
		const responseBody = await response.text();
		const responseHeaders: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			responseHeaders[key] = value;
		});
		return {
			ok: true,
			value: {
				status: response.status,
				ok: response.ok,
				headers: responseHeaders,
				body: responseBody,
			},
		};
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

// ─── Tab script execution ──────────────────────────────────────

async function executeInTab(
	tabId: number | null,
	func: (...args: unknown[]) => unknown,
	args: unknown[],
): Promise<AsyncResponse> {
	throwIfAborted();
	const log = logger.child("runner");
	log.debug("executeInTab_start", {
		tabId,
		scriptType: func.name || "anonymous",
	});
	const chrome = window.chrome;
	if (!chrome?.runtime?.id) {
		log.debug("executeInTab_result", {
			tabId,
			result: "error",
			reason: "no_extension",
		});
		return {
			ok: false,
			error: {
				message: "Not in extension context",
				code: "E_NO_EXTENSION",
				category: "permission",
			},
		};
	}
	const targetTab = typeof tabId === "number" ? tabId : activeTabId;
	if (targetTab === null) {
		log.debug("executeInTab_result", {
			tabId,
			result: "error",
			reason: "no_tab",
		});
		return {
			ok: false,
			error: {
				message: "No active tab available",
				code: "E_NO_TAB",
				category: "resource",
			},
		};
	}
	try {
		const results = await chrome.scripting.executeScript({
			target: { tabId: targetTab },
			func,
			args,
			world: "MAIN",
		});
		if (chrome.runtime.lastError) {
			log.error("executeInTab_lastError", {
				tabId: targetTab,
				error: chrome.runtime.lastError.message,
			});
		}
		if (results?.[0]) {
			log.debug("executeInTab_result", { tabId: targetTab, result: "ok" });
			return { ok: true, value: results[0].result };
		}
		log.debug("executeInTab_result", {
			tabId: targetTab,
			result: "ok",
			value: null,
		});
		return { ok: true, value: null };
	} catch (err: unknown) {
		log.debug("executeInTab_result", {
			tabId: targetTab,
			result: "error",
			error: err instanceof Error ? err.message : String(err),
		});
		return normalizeChromeError(err);
	}
}

async function waitForTabLoad(
	tabId: number | null,
	timeoutMs: number = 30_000,
): Promise<AsyncResponse<boolean>> {
	throwIfAborted();
	const log = logger.child("runner");
	const targetTab = typeof tabId === "number" ? tabId : null;
	log.debug("waitForTabLoad_start", { tabId: targetTab, timeout: timeoutMs });
	const chrome = window.chrome;
	if (!chrome?.runtime?.id) {
		return {
			ok: false,
			error: {
				message: "Not in extension context",
				code: "E_NO_EXTENSION",
				category: "permission",
			},
		};
	}
	if (targetTab === null) {
		return {
			ok: false,
			error: {
				message: "tab_wait_for_load requires a valid tabId",
				code: "E_MISSING_PARAM",
			},
		};
	}
	try {
		const tab = await chrome.tabs.get(targetTab);
		if (tab.status === "complete") {
			log.debug("waitForTabLoad_loaded", {
				tabId: targetTab,
				status: "already_complete",
			});
			return { ok: true, value: true };
		}
		await new Promise<void>((resolve, reject) => {
			const listener = (
				updatedTabId: number,
				changeInfo: { status?: string },
			) => {
				if (updatedTabId === targetTab && changeInfo.status === "complete") {
					chrome.tabs.onUpdated.removeListener(listener);
					resolve();
				}
			};
			chrome.tabs.onUpdated.addListener(listener);
			setTimeout(() => {
				chrome.tabs.onUpdated.removeListener(listener);
				reject(new Error("Timeout waiting for tab load"));
			}, timeoutMs);
		});
		log.debug("waitForTabLoad_loaded", {
			tabId: targetTab,
			status: "complete",
		});
		return { ok: true, value: true };
	} catch (err: unknown) {
		if (
			err instanceof Error &&
			err.message === "Timeout waiting for tab load"
		) {
			log.warn("waitForTabLoad_timeout", {
				tabId: targetTab,
				timeout: timeoutMs,
			});
		}
		return normalizeChromeError(err);
	}
}

// ─── Active tab cache & persistent content-script communication ──

let activeTabId: number | null = null;

const onActivatedListener = ({ tabId }: { tabId: number }) => {
	activeTabId = tabId;
};

const onUpdatedListener = (tabId: number, changeInfo: { status?: string }) => {
	const chrome = window.chrome;
	if (!chrome?.runtime?.id) return;
	if (changeInfo.status === "complete") {
		chrome.tabs.sendMessage(tabId, { action: "ping" }).catch(() => {
			// Content script not present; injection happens automatically
			// via manifest content_scripts matches for new navigations.
			// For SPA navigations within same document, no injection needed
			// because content script persists.
		});
	}
};

export function getActiveTabId(): number | null {
	return activeTabId;
}

async function resolveActiveTabId(): Promise<number | null> {
	const log = logger.child("runner");
	log.debug("resolveActiveTabId_start", { activeTabId });
	if (activeTabId !== null) {
		log.debug("resolveActiveTabId_result", { tabId: activeTabId });
		return activeTabId;
	}
	// Try to find an active tab dynamically
	const chrome = window.chrome;
	if (!chrome?.runtime?.id) {
		log.warn("resolveActiveTabId_result", {
			tabId: null,
			reason: "no_extension",
		});
		return null;
	}
	try {
		const tabs = await chrome.tabs.query({ active: true });
		const t = Array.isArray(tabs) ? tabs : [];
		const first = t[0] as chrome.tabs.Tab | undefined;
		if (first && typeof first.id === "number") {
			activeTabId = first.id;
			log.debug("resolveActiveTabId_result", { tabId: first.id });
			return first.id;
		}
	} catch {
		// ignore
	}
	log.warn("resolveActiveTabId_result", { tabId: null, reason: "not_found" });
	return null;
}

export function initExtensionListeners(): void {
	const chrome = window.chrome;
	if (!chrome?.runtime?.id) return;

	chrome.tabs.onActivated.addListener(onActivatedListener);
	chrome.tabs.onUpdated.addListener(onUpdatedListener);

	// Initialize activeTabId from current state
	// Use lastFocusedWindow: true to find tabs even when popup has its own window context
	chrome.tabs
		.query({ active: true, lastFocusedWindow: true })
		.then((tabs: chrome.tabs.Tab[]) => {
			const t = Array.isArray(tabs) ? tabs : [];
			const first = t[0] as chrome.tabs.Tab | undefined;
			if (first && typeof first.id === "number") {
				activeTabId = first.id;
			}
		})
		.catch(() => {
			// ignore query errors
		});
}

export function removeExtensionListeners(): void {
	const chrome = window.chrome;
	if (!chrome?.runtime?.id) return;
	chrome.tabs.onActivated.removeListener(onActivatedListener);
	chrome.tabs.onUpdated.removeListener(onUpdatedListener);
}

async function sendMessageToTab(
	tabId: number | null,
	message: TabMessage,
): Promise<AsyncResponse> {
	throwIfAborted();
	const log = logger.child("runner");
	log.debug("sendMessageToTab_start", { tabId, action: message.action });
	const chrome = window.chrome;
	if (!chrome?.runtime?.id) {
		return {
			ok: false,
			error: {
				message: "Not in extension context",
				code: "E_NO_EXTENSION",
				category: "permission",
			},
		};
	}
	const targetTab = typeof tabId === "number" ? tabId : activeTabId;
	if (targetTab === null) {
		log.warn("sendMessageToTab_no_tab", { tabId });
		return {
			ok: false,
			error: {
				message: "No active tab available",
				code: "E_NO_TAB",
				category: "resource",
			},
		};
	}
	logger.debug("sendMessageToTab", {
		targetTab,
		messageAction: message.action,
	});
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			const result = await chrome.tabs.sendMessage(targetTab, message);
			logger.debug("sendMessageToTab_raw_result", {
				targetTab,
				resultType: typeof result,
			});
			// Content-script handlers may return { ok: false, error: msg } on failure.
			// Flatten that so Lua consumers always see a single error shape.
			if (
				result &&
				typeof result === "object" &&
				(result as Record<string, unknown>).ok === false
			) {
				const raw = (result as Record<string, unknown>).error;
				const msg = typeof raw === "string" ? raw : String(raw);
				logger.debug("sendMessageToTab_content_script_error", {
					targetTab,
					error: msg,
				});
				return {
					ok: false,
					error: {
						message: msg || "Content script error",
						code: "E_CONTENT_SCRIPT",
					},
				};
			}
			logger.debug("sendMessageToTab_success", {
				targetTab,
				resultType: typeof result,
			});
			return { ok: true, value: result };
		} catch (err: unknown) {
			const msg = (err instanceof Error ? err.message : String(err)) || "";
			if (msg.includes("Receiving end does not exist") && attempt < 4) {
				log.debug("sendMessageToTab_retry", { targetTab, attempt });
				if (attempt === 0) {
					try {
						await chrome.scripting.executeScript({
							target: { tabId: targetTab },
							files: ["content-script.js"],
							world: "ISOLATED",
						});
						await new Promise((resolve) =>
							setTimeout(resolve, INJECTION_DELAY_MS),
						);
					} catch (injectErr: unknown) {
						return normalizeChromeError(injectErr);
					}
				}
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
				continue;
			}
			return normalizeChromeError(err);
		}
	}
	return {
		ok: false,
		error: {
			message: "Failed to send message to tab after retries",
			code: "E_TAB_MESSAGE",
			category: "resource",
		},
	};
}

// ─── Sidepanel actions (side panel / main document) ─────────────
//
// IMPORTANT: sidepanel.* actions operate on the extension popup/sidepanel
// DOM, NOT the active browser tab. To interact with the active tab, use
// page.* APIs which relay commands to the content script via sendMessageToTab.

function getElementByRefId(refId: string): Element | null {
	return document.querySelector(`[data-ref-id='${CSS.escape(refId)}']`);
}

function extractRefId(params: unknown): string | undefined {
	if (typeof params === "string") return params;
	const obj = asRecord(params);
	return typeof obj.refId === "string"
		? obj.refId
		: typeof obj.ref_id === "string"
			? obj.ref_id
			: undefined;
}

// ─── DOM snapshot ──────────────────────────────────────────────

async function handleDomSnapshot(
	params: DomSnapshotParams,
): Promise<AsyncResponse<DomSnapshotValue>> {
	const log = logger.child("runner");
	log.debug("handleDomSnapshot_start", {
		interactive_only: params?.interactive_only,
		max_nodes: params?.max_nodes,
	});
	try {
		await ensureDomSnapshot();
		const options: Record<string, unknown> = {};
		if (params) {
			if (params.max_nodes != null) options.maxNodes = Number(params.max_nodes);
			if (params.interactive_only != null)
				options.interactiveOnly = params.interactive_only;
		}
		const snap = collectDocument(options);
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

async function handleDomFormat(
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

// ─── Host call handler ───────────────────────────────────────────

async function handleHostCallAction(
	action: string,
	params: unknown,
): Promise<AsyncResponse> {
	const log = logger.child("runner");
	log.debug("handleHostCallAction_start", { action });
	const handler = hostHandlers[action] ?? window.__hostHandlers?.[action];
	if (!handler) {
		log.debug("handleHostCallAction_result", {
			action,
			status: "error",
			reason: "no_handler",
		});
		return {
			ok: false,
			error: {
				message: `No handler registered for "${action}"`,
				code: "ENOHANDLER",
				category: "host",
			},
		};
	}
	try {
		const value = await handler(params);
		log.debug("handleHostCallAction_result", { action, status: "ok" });
		return { ok: true, value };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		log.debug("handleHostCallAction_result", {
			action,
			status: "error",
			error: message || String(err),
		});
		return {
			ok: false,
			error: {
				message: message || String(err),
				code: "EHOSTCALL",
				category: "host",
			},
		};
	}
}

// ─── Chrome error normalizer ───────────────────────────────────

function normalizeChromeError(err: unknown): { ok: false; error: AsyncError } {
	const msg = (err instanceof Error ? err.message : String(err)) || "";
	if (msg.includes("permission") || msg.includes("Permission")) {
		return {
			ok: false,
			error: {
				message: msg,
				code: "E_PERMISSION_DENIED",
				category: "permission",
			},
		};
	}
	if (
		msg.includes("not found") ||
		msg.includes("No tab") ||
		msg.includes("No window")
	) {
		return {
			ok: false,
			error: { message: msg, code: "E_NOT_FOUND", category: "resource" },
		};
	}
	return {
		ok: false,
		error: { message: msg, code: "E_EXTENSION", category: "extension" },
	};
}

// ─── Chrome API dispatcher ─────────────────────────────────────

function toPlainObject(value: unknown): unknown {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(toPlainObject);
	const plain: Record<string, unknown> = {};
	for (const key of Object.keys(value as Record<string, unknown>)) {
		const v = (value as Record<string, unknown>)[key];
		if (typeof v !== "function") {
			plain[key] = toPlainObject(v);
		}
	}
	return plain;
}

// ─── Chrome passthrough dispatch table ─────────────────────────

type ChromeApiCaller = (
	api: unknown,
	firstRec: Record<string, unknown>,
	first: unknown,
	second: unknown,
) => Promise<unknown>;

const chromePassthroughHandlers = new Map<string, ChromeApiCaller>([
	[
		"chrome_tabs_update",
		async (api, firstRec, first, second) => {
			const tabId = firstRec.tabId || first;
			const updateProps = firstRec.update || second || {};
			if (typeof tabId === "number") {
				return (api as typeof chrome.tabs).update(
					tabId,
					updateProps as chrome.tabs.UpdateProperties,
				);
			}
			return (api as typeof chrome.tabs).update(
				updateProps as chrome.tabs.UpdateProperties,
			);
		},
	],
	[
		"chrome_tabs_remove",
		async (api, firstRec, first) => {
			const tabIds = firstRec.tabIds || firstRec.tabId || firstRec.id || first;
			if (typeof tabIds === "number") {
				await (api as typeof chrome.tabs).remove(tabIds);
			} else {
				await (api as typeof chrome.tabs).remove(tabIds as number[]);
			}
			return null;
		},
	],
	[
		"chrome_tabs_get",
		async (api, firstRec, first) => {
			const tabId = firstRec.tabId || firstRec.id || first;
			return (api as typeof chrome.tabs).get(tabId as number);
		},
	],
	[
		"chrome_tabs_reload",
		async (api, firstRec, first, second) => {
			const tabId = firstRec.tabId || first;
			const reloadProps = firstRec.reload || second || {};
			if (typeof tabId === "number") {
				await (api as typeof chrome.tabs).reload(
					tabId,
					reloadProps as chrome.tabs.ReloadProperties,
				);
			} else {
				await (api as typeof chrome.tabs).reload(
					reloadProps as chrome.tabs.ReloadProperties,
				);
			}
			return null;
		},
	],
	[
		"chrome_tabs_sendMessage",
		async (api, firstRec, first, second) => {
			const tabId = firstRec.tabId || first;
			const message = firstRec.message || second || {};
			return (api as typeof chrome.tabs).sendMessage(tabId as number, message);
		},
	],
	[
		"chrome_alarms_create",
		async (api, firstRec, first, second) => {
			const name =
				firstRec.name || (typeof first === "string" ? first : "") || "";
			const alarmInfo = firstRec.alarmInfo || second || firstRec || {};
			await (api as typeof chrome.alarms).create(name as string, alarmInfo);
			return null;
		},
	],
	[
		"chrome_alarms_clear",
		async (api, firstRec, first) => {
			const alarmName =
				firstRec.name || (typeof first === "string" ? first : "") || "";
			return (api as typeof chrome.alarms).clear(alarmName as string);
		},
	],
	[
		"chrome_action_setBadgeText",
		async (api, firstRec) => {
			await (api as typeof chrome.action).setBadgeText(
				(firstRec || {}) as chrome.action.BadgeTextDetails,
			);
			return null;
		},
	],
	[
		"chrome_action_setBadgeBackgroundColor",
		async (api, _firstRec, first) => {
			await (api as typeof chrome.action).setBadgeBackgroundColor(
				first as chrome.action.BadgeColorDetails,
			);
			return null;
		},
	],
	[
		"chrome_action_setTitle",
		async (api, _firstRec, first) => {
			await (api as typeof chrome.action).setTitle(
				first as chrome.action.TitleDetails,
			);
			return null;
		},
	],
	[
		"chrome_action_setIcon",
		async (api, firstRec) => {
			return (api as typeof chrome.action).setIcon(
				(firstRec || {}) as chrome.action.TabIconDetails,
			);
		},
	],
	[
		"chrome_contextMenus_remove",
		async (api, firstRec, first) => {
			const menuId = firstRec.menuItemId || firstRec.id || first;
			await (api as typeof chrome.contextMenus).remove(
				menuId as string | number,
			);
			return null;
		},
	],
	[
		"chrome_windows_update",
		async (api, firstRec, first, second) => {
			const windowId = firstRec.windowId || first;
			const updateInfo = firstRec.update || second || {};
			return (api as typeof chrome.windows).update(
				windowId as number,
				updateInfo as chrome.windows.UpdateInfo,
			);
		},
	],
	[
		"chrome_windows_remove",
		async (api, firstRec, first) => {
			const windowId = firstRec.windowId || first;
			await (api as typeof chrome.windows).remove(windowId as number);
			return null;
		},
	],
	[
		"chrome_cookies_get",
		async (api, _firstRec, first) => {
			return (api as typeof chrome.cookies).get(
				first as chrome.cookies.CookieDetails,
			);
		},
	],
	[
		"chrome_cookies_set",
		async (api, _firstRec, first) => {
			return (api as typeof chrome.cookies).set(
				first as chrome.cookies.SetDetails,
			);
		},
	],
	[
		"chrome_cookies_remove",
		async (api, _firstRec, first) => {
			return (api as typeof chrome.cookies).remove(
				first as chrome.cookies.CookieDetails,
			);
		},
	],
	[
		"chrome_cookies_getAll",
		async (api, firstRec) => {
			return (api as typeof chrome.cookies).getAll(
				(firstRec || {}) as chrome.cookies.GetAllDetails,
			);
		},
	],
	[
		"chrome_bookmarks_search",
		async (api, firstRec, first) => {
			const query =
				firstRec.query || (typeof first === "string" ? first : "") || "";
			return (api as typeof chrome.bookmarks).search(query as string);
		},
	],
	[
		"chrome_bookmarks_remove",
		async (api, firstRec, first) => {
			const bookmarkId = firstRec.id || first;
			await (api as typeof chrome.bookmarks).remove(bookmarkId as string);
			return null;
		},
	],
	[
		"chrome_history_search",
		async (api, _firstRec, first) => {
			return (api as typeof chrome.history).search(
				first as chrome.history.HistoryQuery,
			);
		},
	],
	[
		"chrome_history_deleteUrl",
		async (api, firstRec, first) => {
			await (api as typeof chrome.history).deleteUrl({
				url: (firstRec.url || first) as string,
			} as chrome.history.UrlDetails);
			return null;
		},
	],
	[
		"chrome_notifications_create",
		async (api, firstRec, first, second) => {
			const notifId =
				firstRec.id || (typeof first === "string" ? first : "") || "";
			const options = firstRec.options || second || {};
			return (api as typeof chrome.notifications).create(
				notifId as string,
				options as chrome.notifications.NotificationCreateOptions,
			);
		},
	],
	[
		"chrome_notifications_clear",
		async (api, firstRec, first) => {
			const notifId =
				firstRec.id || (typeof first === "string" ? first : "") || "";
			return (api as typeof chrome.notifications).clear(notifId as string);
		},
	],
	[
		"chrome_tabGroups_get",
		async (api, firstRec, first) => {
			const groupId = firstRec.groupId || first;
			return (api as typeof chrome.tabGroups).get(groupId as number);
		},
	],
	[
		"chrome_tabGroups_update",
		async (api, firstRec, first, second) => {
			const groupId = firstRec.groupId || first;
			const updateProps = firstRec.update || second || {};
			return (api as typeof chrome.tabGroups).update(
				groupId as number,
				updateProps as chrome.tabGroups.UpdateProperties,
			);
		},
	],
	[
		"chrome_tabs_ungroup",
		async (api, firstRec, first) => {
			const tabIds = firstRec.tabIds || firstRec.tabId || first;
			if (typeof tabIds === "number") {
				(api as typeof chrome.tabs).ungroup(tabIds);
			} else {
				(api as typeof chrome.tabs).ungroup(
					tabIds as number | [number, ...number[]],
				);
			}
			return null;
		},
	],
	[
		"chrome_sessions_restore",
		async (api, firstRec, first) => {
			return (api as typeof chrome.sessions).restore(
				(firstRec.sessionId || first || undefined) as string | undefined,
			);
		},
	],
	[
		"chrome_downloads_pause",
		async (api, firstRec, first) => {
			(api as typeof chrome.downloads).pause(
				(firstRec.downloadId || first) as number,
			);
			return null;
		},
	],
	[
		"chrome_downloads_resume",
		async (api, firstRec, first) => {
			(api as typeof chrome.downloads).resume(
				(firstRec.downloadId || first) as number,
			);
			return null;
		},
	],
	[
		"chrome_downloads_cancel",
		async (api, firstRec, first) => {
			(api as typeof chrome.downloads).cancel(
				(firstRec.downloadId || first) as number,
			);
			return null;
		},
	],
	[
		"chrome_downloads_open",
		async (api, firstRec, first) => {
			(api as typeof chrome.downloads).open(
				(firstRec.downloadId || first) as number,
			);
			return null;
		},
	],
	[
		"chrome_downloads_show",
		async (api, firstRec, first) => {
			(api as typeof chrome.downloads).show(
				(firstRec.downloadId || first) as number,
			);
			return null;
		},
	],
	[
		"chrome_system_cpu_getInfo",
		async (api) => {
			return (api as typeof chrome.system.cpu).getInfo();
		},
	],
	[
		"chrome_system_memory_getInfo",
		async (api) => {
			return (api as typeof chrome.system.memory).getInfo();
		},
	],
	[
		"chrome_system_storage_getInfo",
		async (api) => {
			return (api as typeof chrome.system.storage).getInfo();
		},
	],
]);

// ─── Tool registrations ────────────────────────────────────────

function registerChromePassthrough(
	action: string,
	namespace: string,
	description: string,
	apiPath: string[],
	paramsSchema: z.ZodSchema<unknown>,
	returnsSchema: z.ZodSchema<unknown>,
	errorCode: string,
	errorCategory: string | undefined,
	paramTypes: ToolDocParam[],
): void {
	registerTool({
		action,
		namespace,
		description,
		params: paramsSchema,
		returns: returnsSchema,
		handler: async (params: unknown) => {
			const log = logger.child("chrome");
			const chrome = window.chrome;
			if (!chrome?.runtime?.id) {
				throw makeError(
					`${action} is only available in a browser extension context`,
					"E_NO_EXTENSION",
					"permission",
				);
			}
			let api: unknown = chrome;
			for (const part of apiPath) {
				api = (api as Record<string, unknown>)[part];
			}
			const first = Array.isArray(params) ? params[0] : params;
			const firstRec = asRecord(first);
			const second = Array.isArray(params) ? params[1] : undefined;
			log.debug("chrome_passthrough", {
				action,
				params: Object.keys(firstRec),
			});

			try {
				const handler = chromePassthroughHandlers.get(action);
				let result: unknown;
				if (handler) {
					result = await handler(api, firstRec, first, second);
				} else {
					const method = (api as Record<string, unknown>)[
						action.split("_").pop()!
					] as (...args: unknown[]) => Promise<unknown>;
					result = await (method as (...args: unknown[]) => Promise<unknown>)(
						firstRec || {},
					);
				}
				log.debug("chrome_passthrough_ok", { action });
				return toPlainObject(result);
			} catch (err: unknown) {
				const normalized = normalizeChromeError(err);
				log.debug("chrome_passthrough_err", {
					action,
					error: normalized.error.message,
				});
				throw makeError(
					normalized.error.message,
					normalized.error.code,
					normalized.error.category,
				);
			}
		},
		paramTypes,
		returnDoc: "Chrome API result",
		errorCode,
		errorCategory,
	});
}

// ─── Storage ─────────────────────────────────────────────────────

registerTool({
	action: "storage_get",
	namespace: "storage",
	description: "Get a value from localStorage",
	params: schemas.StorageGetParamsSchema,
	returns: z.string().nullable(),
	handler: async (params) => {
		return localStorage.getItem(params.key);
	},
	paramTypes: [
		{ name: "key", type: "string", required: true, description: "Storage key" },
	],
	returnDoc: "Stored value or null",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerTool({
	action: "storage_set",
	namespace: "storage",
	description: "Set a value in localStorage",
	params: schemas.StorageSetParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		localStorage.setItem(params.key, params.value);
		return null;
	},
	paramTypes: [
		{ name: "key", type: "string", required: true, description: "Storage key" },
		{
			name: "value",
			type: "string",
			required: true,
			description: "Value to store",
		},
	],
	returnDoc: "null",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerTool({
	action: "storage_delete",
	namespace: "storage",
	description: "Delete a key from localStorage",
	params: schemas.StorageDeleteParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		localStorage.removeItem(params.key);
		return null;
	},
	paramTypes: [
		{ name: "key", type: "string", required: true, description: "Storage key" },
	],
	returnDoc: "null",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerTool({
	action: "storage_list",
	namespace: "storage",
	description: "List all localStorage keys",
	params: schemas.StorageListParamsSchema,
	returns: z.array(z.string()),
	handler: async () => {
		const keys: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key) keys.push(key);
		}
		return keys;
	},
	paramTypes: [],
	returnDoc: "Array of keys",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerTool({
	action: "storage_set_many",
	namespace: "storage",
	description: "Set multiple values in localStorage",
	params: schemas.StorageSetManyParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const itemRec = asRecord(params.items);
		for (const key of Object.keys(itemRec)) {
			const value = itemRec[key];
			localStorage.setItem(
				`__csl__:${key}`,
				value === null || value === undefined ? "null" : String(value),
			);
		}
		return null;
	},
	paramTypes: [
		{
			name: "items",
			type: "object",
			required: true,
			description: "Record of key-value pairs to set",
		},
	],
	returnDoc: "null",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerTool({
	action: "storage_get_many",
	namespace: "storage",
	description: "Get multiple values from localStorage",
	params: schemas.StorageGetManyParamsSchema,
	returns: z.record(z.string().nullable()),
	handler: async (params) => {
		const keys = params.keys;
		const defaults = asRecord(params.defaults ?? {});
		const results: Record<string, string | null> = {};
		for (const key of keys) {
			const val = localStorage.getItem(`__csl__:${String(key)}`);
			results[String(key)] =
				val !== null ? val : ((defaults[String(key)] as string | null) ?? null);
		}
		return results;
	},
	paramTypes: [
		{
			name: "keys",
			type: "array",
			required: true,
			description: "Array of keys to retrieve",
		},
		{
			name: "defaults",
			type: "object",
			required: false,
			description: "Default values for missing keys",
		},
	],
	returnDoc: "Record of values",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerTool({
	action: "storage_get_all",
	namespace: "storage",
	description: "Get all __csl__ values from localStorage",
	params: schemas.StorageGetAllParamsSchema,
	returns: z.record(z.string().nullable()),
	handler: async () => {
		const results: Record<string, string | null> = {};
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith("__csl__:")) {
				const shortKey = key.slice("__csl__:".length);
				results[shortKey] = localStorage.getItem(key);
			}
		}
		return results;
	},
	paramTypes: [],
	returnDoc: "Record of values",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerTool({
	action: "storage_delete_many",
	namespace: "storage",
	description: "Delete multiple keys from localStorage",
	params: schemas.StorageDeleteManyParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const keys = params.keys;
		for (const key of keys) {
			localStorage.removeItem(`__csl__:${String(key)}`);
		}
		return null;
	},
	paramTypes: [
		{
			name: "keys",
			type: "array",
			required: true,
			description: "Array of keys to delete",
		},
	],
	returnDoc: "null",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerTool({
	action: "storage_clear",
	namespace: "storage",
	description: "Clear all __csl__ keys from localStorage",
	params: schemas.StorageClearParamsSchema,
	returns: z.null(),
	handler: async () => {
		const keysToRemove: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith("__csl__:")) {
				keysToRemove.push(key);
			}
		}
		for (const key of keysToRemove) {
			localStorage.removeItem(key);
		}
		return null;
	},
	paramTypes: [],
	returnDoc: "null",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

// ─── Clipboard ───────────────────────────────────────────────────

registerTool({
	action: "clipboard_read",
	namespace: "clipboard",
	description: "Read text from clipboard",
	params: schemas.ClipboardReadParamsSchema,
	returns: z.string(),
	handler: async () => {
		return navigator.clipboard.readText();
	},
	paramTypes: [],
	returnDoc: "Clipboard text",
	errorCode: "ECLIPBOARD",
	errorCategory: "permission",
});

registerTool({
	action: "clipboard_write",
	namespace: "clipboard",
	description: "Write text to clipboard",
	params: schemas.ClipboardWriteParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		let text = "";
		if (Array.isArray(params)) {
			const first = params[0];
			if (typeof first === "object" && first !== null) {
				text = String((first as Record<string, unknown>).text ?? first);
			} else {
				text = String(first);
			}
		} else {
			const obj = asRecord(params);
			text = (obj.text as string) || (obj.value as string) || "";
		}
		await navigator.clipboard.writeText(text);
		return null;
	},
	paramTypes: [
		{
			name: "text",
			type: "string",
			required: false,
			description: "Text to write to clipboard",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Alternative text value to write",
		},
	],
	returnDoc: "null",
	errorCode: "ECLIPBOARD",
	errorCategory: "permission",
});

// ─── Network / Sleep ─────────────────────────────────────────────

registerTool({
	action: "fetch",
	namespace: "network",
	description: "Make an HTTP request",
	params: schemas.FetchParamsSchema,
	returns: schemas.FetchValueSchema,
	handler: async (params) => {
		const result = await handleFetch(params as FetchParams);
		return unwrapResult(result);
	},
	paramTypes: [
		{
			name: "url",
			type: "string",
			required: true,
			description: "URL to fetch",
		},
		{
			name: "method",
			type: "string",
			required: false,
			description: "HTTP method (GET, POST, etc.)",
		},
		{
			name: "headers",
			type: "object",
			required: false,
			description: "Request headers",
		},
		{
			name: "body",
			type: "string",
			required: false,
			description: "Request body",
		},
		{
			name: "timeout",
			type: "number",
			required: false,
			description: "Timeout in milliseconds",
		},
	],
	returnDoc: "Response object",
	errorCode: "E_UNKNOWN",
	errorCategory: "network",
});

registerTool({
	action: "sleep",
	namespace: "util",
	description: "Sleep for a duration",
	params: schemas.SleepParamsSchema,
	returns: z.null(),
	handler: async (params) => {
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
			description: "Duration to sleep in milliseconds",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "mock_async",
	namespace: "util",
	description: "Mock async call for testing",
	params: z.union([
		z.string(),
		z.object({ label: z.string().optional() }).passthrough(),
	]),
	returns: z.string(),
	handler: async (params) => {
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
			description: "Test label",
		},
	],
	returnDoc: "Label string",
	errorCode: "E_UNKNOWN",
});

// ─── Page actions ────────────────────────────────────────────────

registerTool({
	action: "page_url",
	namespace: "page",
	description: "Get the URL of the active tab",
	params: schemas.PageUrlParamsSchema,
	returns: z.string(),
	handler: async () => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		return unwrapResult(
			await executeInTab(activeTab, () => window.location.href, []),
		);
	},
	paramTypes: [],
	returnDoc: "URL string",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "page_title",
	namespace: "page",
	description: "Get the title of the active tab",
	params: schemas.PageTitleParamsSchema,
	returns: z.string(),
	handler: async () => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		return unwrapResult(
			await executeInTab(activeTab, () => document.title, []),
		);
	},
	paramTypes: [],
	returnDoc: "Title string",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "page_goto",
	namespace: "page",
	description: "Navigate the active tab to a URL",
	params: schemas.PageGotoParamsSchema,
	returns: schemas.ChromeTabSchema,
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		const result = await dispatchTool("chrome_tabs_update", {
			tabId: activeTab,
			update: { url: params.url },
		});
		return unwrapResult(result);
	},
	paramTypes: [
		{
			name: "url",
			type: "string",
			required: true,
			description: "URL to navigate to",
		},
	],
	returnDoc: "Tab update result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "page_back",
	namespace: "page",
	description: "Go back in the active tab",
	params: schemas.PageBackParamsSchema,
	returns: z.boolean(),
	handler: async () => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		return unwrapResult(
			await sendMessageToTab(activeTab, { action: "back", params: {} }),
		);
	},
	paramTypes: [],
	returnDoc: "Navigation result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "page_forward",
	namespace: "page",
	description: "Go forward in the active tab",
	params: schemas.PageForwardParamsSchema,
	returns: z.boolean(),
	handler: async () => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		return unwrapResult(
			await executeInTab(activeTab, () => {
				window.history.forward();
				return true;
			}, []),
		);
	},
	paramTypes: [],
	returnDoc: "true",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "page_reload",
	namespace: "page",
	description: "Reload the active tab",
	params: schemas.PageReloadParamsSchema,
	returns: z.null(),
	handler: async () => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		return unwrapResult(
			await dispatchTool("chrome_tabs_reload", { tabId: activeTab }),
		);
	},
	paramTypes: [],
	returnDoc: "null",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "page_wait",
	namespace: "page",
	description: "Wait for a duration",
	params: schemas.PageWaitParamsSchema,
	returns: z.boolean(),
	handler: async (params) => {
		await new Promise((resolve) =>
			setTimeout(resolve, Number(params.duration)),
		);
		return true;
	},
	paramTypes: [
		{
			name: "duration",
			type: "number",
			required: false,
			description: "Duration to wait in milliseconds",
		},
	],
	returnDoc: "true",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "page_click",
	namespace: "page",
	description: "Click an element in the active tab",
	params: schemas.PageClickParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		const obj = asRecord(params);
		const refId = extractRefId(params);
		const label = obj.label ?? "";
		if (!refId && !label) {
			throw makeError("page_click requires refId or label", "E_MISSING_PARAM");
		}
		return unwrapResult(
			await sendMessageToTab(activeTab, {
				action: "click",
				params: { refId, label: String(label) },
			}),
		);
	},
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label to click",
		},
	],
	returnDoc: "Click result",
	errorCode: "E_MISSING_PARAM",
});

registerTool({
	action: "page_fill",
	namespace: "page",
	description: "Fill an element in the active tab",
	params: schemas.PageFillParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		const obj = asRecord(params);
		const refId = extractRefId(params);
		const value = obj.value ?? "";
		const label = obj.label ?? "";
		if (!refId && !label) {
			throw makeError("page_fill requires refId or label", "E_MISSING_PARAM");
		}
		return unwrapResult(
			await sendMessageToTab(activeTab, {
				action: "fill",
				params: { refId, label: String(label), value: String(value) },
			}),
		);
	},
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Value to fill",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label",
		},
	],
	returnDoc: "Fill result",
	errorCode: "E_MISSING_PARAM",
});

registerTool({
	action: "page_type",
	namespace: "page",
	description: "Type into an element in the active tab",
	params: schemas.PageTypeParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		const obj = asRecord(params);
		const refId = extractRefId(params);
		const text = obj.text ?? "";
		const label = obj.label ?? "";
		if (!refId && !label) {
			throw makeError("page_type requires refId or label", "E_MISSING_PARAM");
		}
		return unwrapResult(
			await sendMessageToTab(activeTab, {
				action: "type",
				params: { refId, label: String(label), text: String(text) },
			}),
		);
	},
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID",
		},
		{
			name: "text",
			type: "string",
			required: false,
			description: "Text to type",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label",
		},
	],
	returnDoc: "Type result",
	errorCode: "E_MISSING_PARAM",
});

registerTool({
	action: "page_append",
	namespace: "page",
	description: "Append text to an element in the active tab",
	params: schemas.PageAppendParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		const obj = asRecord(params);
		const refId = extractRefId(params);
		const text = obj.text ?? "";
		const label = obj.label ?? "";
		if (!refId && !label) {
			throw makeError("page_append requires refId or label", "E_MISSING_PARAM");
		}
		return unwrapResult(
			await sendMessageToTab(activeTab, {
				action: "append",
				params: { refId, label: String(label), text: String(text) },
			}),
		);
	},
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID",
		},
		{
			name: "text",
			type: "string",
			required: false,
			description: "Text to append",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label",
		},
	],
	returnDoc: "Append result",
	errorCode: "E_MISSING_PARAM",
});

registerTool({
	action: "page_press",
	namespace: "page",
	description: "Press a key in the active tab",
	params: schemas.PagePressParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		return unwrapResult(
			await sendMessageToTab(activeTab, {
				action: "press",
				params: { key: params.key },
			}),
		);
	},
	paramTypes: [
		{
			name: "key",
			type: "string",
			required: true,
			description: "Key to press",
		},
	],
	returnDoc: "Press result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "page_select",
	namespace: "page",
	description: "Select an option in the active tab",
	params: schemas.PageSelectParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		const obj = asRecord(params);
		const refId = extractRefId(params);
		const value = obj.value ?? "";
		if (!refId) {
			throw makeError("page_select requires refId", "E_MISSING_PARAM");
		}
		return unwrapResult(
			await sendMessageToTab(activeTab, {
				action: "select",
				params: { refId, value: String(value) },
			}),
		);
	},
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Option value to select",
		},
	],
	returnDoc: "Select result",
	errorCode: "E_MISSING_PARAM",
});

registerTool({
	action: "page_check",
	namespace: "page",
	description: "Check/uncheck an element in the active tab",
	params: schemas.PageCheckParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		const obj = asRecord(params);
		const refId = extractRefId(params);
		const checked = typeof obj.checked === "boolean" ? obj.checked : true;
		if (!refId) {
			throw makeError("page_check requires refId", "E_MISSING_PARAM");
		}
		return unwrapResult(
			await sendMessageToTab(activeTab, {
				action: "check",
				params: { refId, checked },
			}),
		);
	},
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "checked",
			type: "boolean",
			required: false,
			description: "Whether to check or uncheck",
		},
	],
	returnDoc: "Check result",
	errorCode: "E_MISSING_PARAM",
});

registerTool({
	action: "page_hover",
	namespace: "page",
	description: "Hover over an element in the active tab",
	params: schemas.PageHoverParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		const refId = extractRefId(params);
		if (!refId) {
			throw makeError("page_hover requires refId", "E_MISSING_PARAM");
		}
		return unwrapResult(
			await sendMessageToTab(activeTab, { action: "hover", params: { refId } }),
		);
	},
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "Hover result",
	errorCode: "E_MISSING_PARAM",
});

registerTool({
	action: "page_unhover",
	namespace: "page",
	description: "Unhover in the active tab",
	params: schemas.PageUnhoverParamsSchema,
	returns: z.null(),
	handler: async () => {
		const activeTab = await resolveActiveTabId();
		return unwrapResult(
			await sendMessageToTab(activeTab, { action: "unhover", params: {} }),
		);
	},
	paramTypes: [],
	returnDoc: "Unhover result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "page_scroll",
	namespace: "page",
	description: "Scroll the active tab",
	params: schemas.PageScrollParamsSchema,
	returns: z.boolean(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		return unwrapResult(
			await sendMessageToTab(activeTab, {
				action: "scroll",
				params: {
					direction: params.direction as string,
					amount: params.amount as number,
				},
			}),
		);
	},
	paramTypes: [
		{
			name: "direction",
			type: "string",
			required: false,
			description: "Scroll direction (up or down)",
		},
		{
			name: "amount",
			type: "number",
			required: false,
			description: "Scroll amount in pixels",
		},
	],
	returnDoc: "Scroll result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "page_scroll_to",
	namespace: "page",
	description: "Scroll to an element in the active tab",
	params: schemas.PageScrollToParamsSchema,
	returns: z.boolean(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		const refId = extractRefId(params);
		if (!refId) {
			throw makeError("page_scroll_to requires refId", "E_MISSING_PARAM");
		}
		return unwrapResult(
			await sendMessageToTab(activeTab, {
				action: "scrollTo",
				params: { x: 0, y: 0, refId },
			}),
		);
	},
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID to scroll to",
		},
	],
	returnDoc: "Scroll to result",
	errorCode: "E_MISSING_PARAM",
});

registerTool({
	action: "page_dblclick",
	namespace: "page",
	description: "Double-click an element in the active tab",
	params: schemas.PageDblClickParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		const refId = extractRefId(params);
		if (!refId) {
			throw makeError("page_dblclick requires refId", "E_MISSING_PARAM");
		}
		return unwrapResult(
			await sendMessageToTab(activeTab, {
				action: "dblclick",
				params: { refId },
			}),
		);
	},
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "Double-click result",
	errorCode: "E_MISSING_PARAM",
});

registerTool({
	action: "page_find",
	namespace: "page",
	description: "Find elements in the active tab",
	params: schemas.PageFindParamsSchema,
	returns: z.array(
		z.object({
			tag: z.string(),
			refId: z.string().nullable(),
			text: z.string(),
		}),
	),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		return unwrapResult(
			await executeInTab(
				activeTab,
				(sel: unknown) => {
					const elements = Array.from(document.querySelectorAll(String(sel)));
					return elements.map((el) => ({
						tag: el.tagName,
						refId: el.getAttribute("data-ref-id"),
						text: el.textContent?.slice(0, 100) || "",
					}));
				},
				[params.selector],
			),
		);
	},
	paramTypes: [
		{
			name: "selector",
			type: "string",
			required: true,
			description: "CSS selector to find elements",
		},
	],
	returnDoc: "Array of elements",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "page_wait_for",
	namespace: "page",
	description: "Wait for a selector in the active tab",
	params: schemas.PageWaitForParamsSchema,
	returns: z.boolean(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		const start = Date.now();
		const timeoutMs = Number(params.timeout) || DEFAULT_TIMEOUT_MS;
		while (true) {
			throwIfAborted();
			const result = await executeInTab(
				activeTab,
				(sel: unknown) => !!document.querySelector(String(sel)),
				[params.selector],
			);
			if (result.ok && result.value === true) {
				return true;
			}
			if (Date.now() - start >= timeoutMs) {
				const err = new Error(
					`Timeout waiting for selector: ${params.selector}`,
				);

				throw err;
			}
			await new Promise((resolve) =>
				setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS),
			);
		}
	},
	paramTypes: [
		{
			name: "selector",
			type: "string",
			required: true,
			description: "CSS selector to wait for",
		},
		{
			name: "timeout",
			type: "number",
			required: false,
			description: "Timeout in milliseconds",
		},
	],
	returnDoc: "true",
	errorCode: "E_TIMEOUT",
	errorCategory: "timeout",
});

registerTool({
	action: "page_extract",
	namespace: "page",
	description: "Extract data from the active tab",
	params: schemas.PageExtractParamsSchema,
	returns: z.record(z.unknown()),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		return unwrapResult(
			await executeInTab(
				activeTab,
				(fieldsArg: unknown) => {
					const fieldList = Array.isArray(fieldsArg) ? fieldsArg : [];
					const result: Record<string, unknown> = {};
					for (const field of fieldList) {
						if (field === "title") {
							result.title = document.title;
						} else if (field === "url") {
							result.url = window.location.href;
						} else if (field === "headings") {
							const headings = Array.from(
								document.querySelectorAll("h1, h2, h3, h4, h5, h6"),
							);
							result.headings = headings.map((el) => ({
								tag: el.tagName,
								text: el.textContent?.trim().slice(0, 200) || "",
							}));
						} else if (field === "links") {
							const links = Array.from(document.querySelectorAll("a[href]"));
							result.links = links.map((el) => ({
								href: el.getAttribute("href"),
								text: el.textContent?.trim().slice(0, 100) || "",
							}));
						} else if (field === "text") {
							result.text =
								document.body?.textContent?.trim().slice(0, 500) || "";
						}
					}
					return result;
				},
				[params.fields],
			),
		);
	},
	paramTypes: [
		{
			name: "fields",
			type: "array",
			required: true,
			description:
				"Array of fields to extract (title, url, headings, links, text)",
		},
	],
	returnDoc: "Extracted data",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "page_close",
	namespace: "page",
	description: "Close a tab",
	params: schemas.PageCloseParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const tabId = typeof params === "number" ? params : extractTabId(params);
		if (tabId === null) {
			throw makeError("page_close requires a tabId", "E_MISSING_PARAM");
		}
		return unwrapResult(await dispatchTool("chrome_tabs_remove", { tabId }));
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to close",
		},
	],
	returnDoc: "null",
	errorCode: "E_MISSING_PARAM",
});

registerTool({
	action: "page_active_tab",
	namespace: "page",
	description: "Get the active tab",
	params: schemas.PageActiveTabParamsSchema,
	returns: schemas.ChromeTabArraySchema,
	handler: async () => {
		return unwrapResult(
			await dispatchTool("chrome_tabs_query", {
				active: true,
				currentWindow: true,
			}),
		);
	},
	paramTypes: [],
	returnDoc: "Tab query result",
	errorCode: "E_NO_TAB",
});

// ─── Sidepanel ───────────────────────────────────────────────────

const sidepanelHandlers = new Map<
	string,
	(refId: string | undefined, obj: Record<string, unknown>) => unknown
>([
	[
		"sidepanel_click",
		(refId) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			(el as HTMLElement).click();
			return null;
		},
	],
	[
		"sidepanel_dblclick",
		(refId) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			const ev = new MouseEvent("dblclick", { bubbles: true });
			el.dispatchEvent(ev);
			return null;
		},
	],
	[
		"sidepanel_fill",
		(refId, obj) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			const value = obj.value ?? "";
			if ("value" in el) (el as HTMLInputElement).value = String(value);
			return null;
		},
	],
	[
		"sidepanel_type",
		(refId, obj) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			const text = obj.text ?? "";
			if ("value" in el) {
				const input = el as HTMLInputElement;
				input.value += String(text);
				input.dispatchEvent(new Event("input", { bubbles: true }));
			}
			return null;
		},
	],
	[
		"sidepanel_append",
		(refId, obj) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			const text = obj.text ?? "";
			if ("value" in el) {
				const input = el as HTMLInputElement;
				input.value += String(text);
				input.dispatchEvent(new Event("input", { bubbles: true }));
			}
			return null;
		},
	],
	[
		"sidepanel_press",
		(_, obj) => {
			const key = obj.key ?? "";
			const el = document.activeElement;
			if (!el) throw makeError("No active element to press", "ENOTFOUND");
			const ev = new KeyboardEvent("keydown", {
				key: String(key),
				bubbles: true,
			});
			el.dispatchEvent(ev);
			const ev2 = new KeyboardEvent("keyup", {
				key: String(key),
				bubbles: true,
			});
			el.dispatchEvent(ev2);
			return null;
		},
	],
	[
		"sidepanel_select",
		(refId, obj) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			const value = obj.value ?? "";
			if ("value" in el) {
				const select = el as HTMLSelectElement;
				select.value = String(value);
				select.dispatchEvent(new Event("change", { bubbles: true }));
			}
			return null;
		},
	],
	[
		"sidepanel_check",
		(refId, obj) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			const checked = typeof obj.checked === "boolean" ? obj.checked : true;
			if ("checked" in el) {
				const cb = el as HTMLInputElement;
				cb.checked = checked;
				cb.dispatchEvent(new Event("change", { bubbles: true }));
			}
			return null;
		},
	],
	[
		"sidepanel_hover",
		(refId) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			const ev = new MouseEvent("mouseenter", { bubbles: true });
			el.dispatchEvent(ev);
			return null;
		},
	],
	[
		"sidepanel_unhover",
		() => {
			const el = document.activeElement;
			if (!el) throw makeError("No active element to unhover", "ENOTFOUND");
			const ev = new MouseEvent("mouseleave", { bubbles: true });
			el.dispatchEvent(ev);
			return null;
		},
	],
	[
		"sidepanel_scroll",
		(_, obj) => {
			const direction = obj.direction ?? "down";
			const amount =
				typeof obj.amount === "number" ? obj.amount : DEFAULT_SCROLL_AMOUNT;
			window.scrollBy({
				top: direction === "up" ? -amount : amount,
				behavior: "smooth",
			});
			return null;
		},
	],
	[
		"sidepanel_scroll_to",
		(refId) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
			else window.scrollTo({ top: 0, behavior: "smooth" });
			return null;
		},
	],
]);

function dispatchSidepanelEvent(action: string, params: unknown): unknown {
	const log = logger.child("runner");
	const refId = extractRefId(params);
	log.debug("dispatchSidepanelEvent_start", { action, refId });
	const obj = asRecord(params);
	const handler = sidepanelHandlers.get(action);
	if (!handler) {
		log.error("dispatchSidepanelEvent_no_handler", { action });
		throw makeError(`Unknown sidepanel action: ${action}`, "E_UNKNOWN");
	}
	return handler(refId, obj);
}

registerTool({
	action: "sidepanel_click",
	namespace: "sidepanel",
	description: "Click an element in the sidepanel",
	params: schemas.SidepanelClickParamsSchema,
	returns: z.null(),
	handler: async (params) => dispatchSidepanelEvent("sidepanel_click", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "sidepanel_dblclick",
	namespace: "sidepanel",
	description: "Double-click an element in the sidepanel",
	params: schemas.SidepanelDblClickParamsSchema,
	returns: z.null(),
	handler: async (params) =>
		dispatchSidepanelEvent("sidepanel_dblclick", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "sidepanel_fill",
	namespace: "sidepanel",
	description: "Fill an element in the sidepanel",
	params: schemas.SidepanelFillParamsSchema,
	returns: z.null(),
	handler: async (params) => dispatchSidepanelEvent("sidepanel_fill", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Value to fill",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "sidepanel_type",
	namespace: "sidepanel",
	description: "Type into an element in the sidepanel",
	params: schemas.SidepanelTypeParamsSchema,
	returns: z.null(),
	handler: async (params) => dispatchSidepanelEvent("sidepanel_type", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "text",
			type: "string",
			required: false,
			description: "Text to type",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "sidepanel_press",
	namespace: "sidepanel",
	description: "Press a key in the sidepanel",
	params: schemas.SidepanelPressParamsSchema,
	returns: z.null(),
	handler: async (params) => dispatchSidepanelEvent("sidepanel_press", params),
	paramTypes: [
		{
			name: "key",
			type: "string",
			required: false,
			description: "Key to press",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "sidepanel_select",
	namespace: "sidepanel",
	description: "Select an option in the sidepanel",
	params: schemas.SidepanelSelectParamsSchema,
	returns: z.null(),
	handler: async (params) => dispatchSidepanelEvent("sidepanel_select", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Option value to select",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "sidepanel_check",
	namespace: "sidepanel",
	description: "Check/uncheck an element in the sidepanel",
	params: schemas.SidepanelCheckParamsSchema,
	returns: z.null(),
	handler: async (params) => dispatchSidepanelEvent("sidepanel_check", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "checked",
			type: "boolean",
			required: false,
			description: "Whether to check or uncheck",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "sidepanel_hover",
	namespace: "sidepanel",
	description: "Hover over an element in the sidepanel",
	params: schemas.SidepanelHoverParamsSchema,
	returns: z.null(),
	handler: async (params) => dispatchSidepanelEvent("sidepanel_hover", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "sidepanel_unhover",
	namespace: "sidepanel",
	description: "Unhover in the sidepanel",
	params: schemas.SidepanelUnhoverParamsSchema,
	returns: z.null(),
	handler: async (params) =>
		dispatchSidepanelEvent("sidepanel_unhover", params),
	paramTypes: [],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "sidepanel_scroll",
	namespace: "sidepanel",
	description: "Scroll the sidepanel",
	params: schemas.SidepanelScrollParamsSchema,
	returns: z.null(),
	handler: async (params) => dispatchSidepanelEvent("sidepanel_scroll", params),
	paramTypes: [
		{
			name: "direction",
			type: "string",
			required: false,
			description: "Scroll direction (up or down)",
		},
		{
			name: "amount",
			type: "number",
			required: false,
			description: "Scroll amount in pixels",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "sidepanel_scroll_to",
	namespace: "sidepanel",
	description: "Scroll to an element in the sidepanel",
	params: schemas.SidepanelScrollToParamsSchema,
	returns: z.null(),
	handler: async (params) =>
		dispatchSidepanelEvent("sidepanel_scroll_to", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID to scroll to",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "sidepanel_append",
	namespace: "sidepanel",
	description: "Append text to an element in the sidepanel",
	params: schemas.SidepanelAppendParamsSchema,
	returns: z.null(),
	handler: async (params) => dispatchSidepanelEvent("sidepanel_append", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "text",
			type: "string",
			required: false,
			description: "Text to append",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "sidepanel_url",
	namespace: "sidepanel",
	description: "Get the sidepanel URL",
	params: schemas.SidepanelUrlParamsSchema,
	returns: z.string(),
	handler: async () => window.location.href,
	paramTypes: [],
	returnDoc: "URL string",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "sidepanel_title",
	namespace: "sidepanel",
	description: "Get the sidepanel title",
	params: schemas.SidepanelTitleParamsSchema,
	returns: z.string(),
	handler: async () => document.title,
	paramTypes: [],
	returnDoc: "Title string",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "sidepanel_wait",
	namespace: "sidepanel",
	description: "Wait in the sidepanel",
	params: schemas.SidepanelWaitParamsSchema,
	returns: z.boolean(),
	handler: async (params) => {
		await new Promise((resolve) =>
			setTimeout(resolve, Number(params.duration)),
		);
		return true;
	},
	paramTypes: [
		{
			name: "duration",
			type: "number",
			required: false,
			description: "Duration to wait in milliseconds",
		},
	],
	returnDoc: "true",
	errorCode: "E_UNKNOWN",
});

registerTool({
	action: "sidepanel_snapshot",
	namespace: "sidepanel",
	description: "Capture sidepanel DOM snapshot",
	params: schemas.SidepanelSnapshotParamsSchema,
	returns: z.string(),
	handler: async (params) => {
		const result = await handleDomSnapshot(params as DomSnapshotParams);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		if (result.value && typeof result.value === "object") {
			return (result.value as Record<string, unknown>).text as string;
		}
		throw makeError("Failed to get sidepanel snapshot", "E_SNAPSHOT");
	},
	paramTypes: [
		{
			name: "interactive_only",
			type: "boolean",
			required: false,
			description: "Only include interactive elements",
		},
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",
});

registerTool({
	action: "sidepanel_snapshot_text",
	namespace: "sidepanel",
	description: "Capture sidepanel DOM snapshot and return text representation",
	params: schemas.SidepanelSnapshotTextParamsSchema,
	returns: z.string(),
	handler: async (params) => {
		const result = await handleDomSnapshot(params as DomSnapshotParams);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		if (result.value && typeof result.value === "object") {
			return (result.value as Record<string, unknown>).text as string;
		}
		throw makeError("Failed to get sidepanel snapshot", "E_SNAPSHOT");
	},
	paramTypes: [
		{
			name: "interactive_only",
			type: "boolean",
			required: false,
			description: "Only include interactive elements",
		},
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",
});

registerTool({
	action: "sidepanel_snapshot_data",
	namespace: "sidepanel",
	description: "Get sidepanel snapshot data",
	params: schemas.SidepanelSnapshotDataParamsSchema,
	returns: schemas.DomSnapshotValueSchema,
	handler: async (params) => {
		const result = await handleDomSnapshot(params as DomSnapshotParams);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		return unwrapResult(result);
	},
	paramTypes: [
		{
			name: "interactive_only",
			type: "boolean",
			required: false,
			description: "Only include interactive elements",
		},
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
	],
	returnDoc: "Snapshot data",
	errorCode: "E_SNAPSHOT",
});

// ─── Page snapshot ───────────────────────────────────────────────

registerTool({
	action: "page_snapshot",
	namespace: "page",
	description: "Capture full DOM snapshot",
	params: schemas.PageSnapshotParamsSchema,
	returns: z.string(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		const obj = asRecord(params);
		const opts = asRecord(obj.options ?? obj);
		const maxNodes =
			typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
		const result = await executeInTab(activeTab, buildSnapshotInTab, [
			maxNodes,
		]);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		if (result.value && typeof result.value === "object") {
			const val = result.value as Record<string, unknown>;
			return val.text as string;
		}
		throw makeError("Failed to get page snapshot", "E_SNAPSHOT");
	},
	paramTypes: [
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",
});

registerTool({
	action: "page_snapshot_text",
	namespace: "page",
	description: "Capture DOM snapshot and return text representation",
	params: schemas.PageSnapshotTextParamsSchema,
	returns: z.string(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		const obj = asRecord(params);
		const opts = asRecord(obj.options ?? obj);
		const maxNodes =
			typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
		const result = await executeInTab(activeTab, buildSnapshotInTab, [
			maxNodes,
		]);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		if (result.value && typeof result.value === "object") {
			const val = result.value as Record<string, unknown>;
			return val.text as string;
		}
		throw makeError("Failed to get page snapshot", "E_SNAPSHOT");
	},
	paramTypes: [
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",
});

registerTool({
	action: "page_snapshot_data",
	namespace: "page",
	description: "Get page snapshot data",
	params: schemas.PageSnapshotDataParamsSchema,
	returns: schemas.SnapshotResultSchema,
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		const obj = asRecord(params);
		const opts = asRecord(obj.options ?? obj);
		const maxNodes =
			typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
		const result = await executeInTab(activeTab, buildSnapshotInTab, [
			maxNodes,
		]);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		if (result.value && typeof result.value === "object") {
			return result.value;
		}
		throw makeError("Failed to get page snapshot", "E_SNAPSHOT");
	},
	paramTypes: [
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options",
		},
	],
	returnDoc: "Snapshot data",
	errorCode: "E_SNAPSHOT",
});

// ─── DOM ─────────────────────────────────────────────────────────

registerTool({
	action: "dom_snapshot",
	namespace: "dom",
	description: "Take a DOM snapshot",
	params: schemas.DomSnapshotParamsSchema,
	returns: schemas.DomSnapshotValueSchema,
	handler: async (params) => {
		const result = await handleDomSnapshot(params as DomSnapshotParams);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		return unwrapResult(result);
	},
	paramTypes: [
		{
			name: "interactive_only",
			type: "boolean",
			required: false,
			description: "Only include interactive elements",
		},
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
	],
	returnDoc: "Snapshot data",
	errorCode: "E_SNAPSHOT",
});

registerTool({
	action: "dom_format",
	namespace: "dom",
	description: "Format a DOM snapshot",
	params: schemas.DomFormatParamsSchema,
	returns: z.string(),
	handler: async (params) => {
		return unwrapResult(await handleDomFormat(params as DomFormatParams));
	},
	paramTypes: [
		{
			name: "snapshot",
			type: "object",
			required: true,
			description: "DOM snapshot data",
		},
		{
			name: "format",
			type: "string",
			required: false,
			description: "Output format (compact-text, json, json-pretty)",
		},
	],
	returnDoc: "Formatted snapshot",
	errorCode: "E_FORMAT",
});

// ─── Tab actions ─────────────────────────────────────────────────

registerTool({
	action: "tab_query",
	namespace: "tab",
	description: "Query tabs",
	params: schemas.TabQueryParamsSchema,
	returns: schemas.ChromeTabArraySchema,
	handler: async (params) => {
		return unwrapResult(await dispatchTool("chrome_tabs_query", params));
	},
	paramTypes: [
		{
			name: "query",
			type: "object",
			required: false,
			description: "Tab query object",
		},
	],
	returnDoc: "Tab array",
	errorCode: "ECHROME",
	errorCategory: "extension",
});

registerTool({
	action: "tab_create",
	namespace: "tab",
	description: "Create a tab",
	params: schemas.TabCreateParamsSchema,
	returns: schemas.ChromeTabSchema,
	handler: async (params) => {
		return unwrapResult(await dispatchTool("chrome_tabs_create", params));
	},
	paramTypes: [
		{
			name: "url",
			type: "string",
			required: false,
			description: "URL to open in new tab",
		},
		{
			name: "active",
			type: "boolean",
			required: false,
			description: "Whether to focus the new tab",
		},
	],
	returnDoc: "Created tab",
	errorCode: "ECHROME",
	errorCategory: "extension",
});

registerTool({
	action: "tab_activate",
	namespace: "tab",
	description: "Activate a tab",
	params: schemas.TabActivateParamsSchema,
	returns: schemas.ChromeTabSchema,
	handler: async (params) => {
		const tabId = typeof params === "number" ? params : extractTabId(params);
		if (tabId === null) {
			throw makeError("tab_activate requires a tabId", "E_MISSING_PARAM");
		}
		return unwrapResult(
			await dispatchTool("chrome_tabs_update", {
				tabId,
				update: { active: true },
			}),
		);
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to activate",
		},
	],
	returnDoc: "Updated tab",
	errorCode: "E_MISSING_PARAM",
});

registerTool({
	action: "tab_close",
	namespace: "tab",
	description: "Close a tab",
	params: schemas.TabCloseParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const tabId = typeof params === "number" ? params : extractTabId(params);
		if (tabId === null) {
			throw makeError("tab_close requires a tabId", "E_MISSING_PARAM");
		}
		return unwrapResult(await dispatchTool("chrome_tabs_remove", { tabId }));
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to close",
		},
	],
	returnDoc: "null",
	errorCode: "E_MISSING_PARAM",
});

registerTool({
	action: "tab_execute_script",
	namespace: "tab",
	description: "Execute script in a tab",
	params: schemas.TabExecuteScriptParamsSchema,
	returns: schemas.ChromeScriptResultSchema,
	handler: async (params) => {
		return unwrapResult(
			await dispatchTool("chrome_scripting_executeScript", params),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: false, description: "Tab ID" },
		{
			name: "script",
			type: "string",
			required: false,
			description: "Script to execute",
		},
	],
	returnDoc: "Script result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_click",
	namespace: "tab",
	description: "Click in a tab",
	params: schemas.TabClickParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const obj = asRecord(params);
		const tabId = extractTabId(params);
		const refId = extractRefId(params);
		const label = obj.label ?? "";
		if (!refId) throw makeError("tab_click requires refId", "E_MISSING_PARAM");
		return unwrapResult(
			await sendMessageToTab(tabId, {
				action: "click",
				params: { refId, label: String(label) },
			}),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label",
		},
	],
	returnDoc: "Click result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_fill",
	namespace: "tab",
	description: "Fill in a tab",
	params: schemas.TabFillParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const obj = asRecord(params);
		const tabId = extractTabId(params);
		const refId = extractRefId(params);
		const value = obj.value ?? "";
		const label = obj.label ?? "";
		if (!refId) throw makeError("tab_fill requires refId", "E_MISSING_PARAM");
		return unwrapResult(
			await sendMessageToTab(tabId, {
				action: "fill",
				params: { refId, label: String(label), value: String(value) },
			}),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Value to fill",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label",
		},
	],
	returnDoc: "Fill result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_scroll_to",
	namespace: "tab",
	description: "Scroll to position in a tab",
	params: schemas.TabScrollToParamsSchema,
	returns: z.boolean(),
	handler: async (params) => {
		const obj = asRecord(params);
		const tabId = extractTabId(params);
		const x = typeof obj.x === "number" ? obj.x : 0;
		const y = typeof obj.y === "number" ? obj.y : 0;
		const refId = extractRefId(params);
		if (!refId)
			throw makeError("tab_scroll_to requires refId", "E_MISSING_PARAM");
		return unwrapResult(
			await sendMessageToTab(tabId, {
				action: "scrollTo",
				params: { x, y, refId },
			}),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{ name: "x", type: "number", required: false, description: "X coordinate" },
		{ name: "y", type: "number", required: false, description: "Y coordinate" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "Scroll to result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_type",
	namespace: "tab",
	description: "Type in a tab",
	params: schemas.TabTypeParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const obj = asRecord(params);
		const tabId = extractTabId(params);
		const refId = extractRefId(params);
		const text = obj.text ?? "";
		const label = obj.label ?? "";
		if (!refId) throw makeError("tab_type requires refId", "E_MISSING_PARAM");
		return unwrapResult(
			await sendMessageToTab(tabId, {
				action: "type",
				params: { refId, label: String(label), text: String(text) },
			}),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "text",
			type: "string",
			required: false,
			description: "Text to type",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label",
		},
	],
	returnDoc: "Type result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_press",
	namespace: "tab",
	description: "Press a key in a tab",
	params: schemas.TabPressParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const obj = asRecord(params);
		const tabId = extractTabId(params);
		const key = obj.key ?? "";
		return unwrapResult(
			await sendMessageToTab(tabId, {
				action: "press",
				params: { key: String(key) },
			}),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "key",
			type: "string",
			required: false,
			description: "Key to press",
		},
	],
	returnDoc: "Press result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_select",
	namespace: "tab",
	description: "Select an option in a tab",
	params: schemas.TabSelectParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const obj = asRecord(params);
		const tabId = extractTabId(params);
		const refId = extractRefId(params);
		const value = obj.value ?? "";
		if (!refId) throw makeError("tab_select requires refId", "E_MISSING_PARAM");
		return unwrapResult(
			await sendMessageToTab(tabId, {
				action: "select",
				params: { refId, value: String(value) },
			}),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Option value to select",
		},
	],
	returnDoc: "Select result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_check",
	namespace: "tab",
	description: "Check/uncheck in a tab",
	params: schemas.TabCheckParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const obj = asRecord(params);
		const tabId = extractTabId(params);
		const refId = extractRefId(params);
		const checked = typeof obj.checked === "boolean" ? obj.checked : true;
		if (!refId) throw makeError("tab_check requires refId", "E_MISSING_PARAM");
		return unwrapResult(
			await sendMessageToTab(tabId, {
				action: "check",
				params: { refId, checked },
			}),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "checked",
			type: "boolean",
			required: false,
			description: "Whether to check or uncheck",
		},
	],
	returnDoc: "Check result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_hover",
	namespace: "tab",
	description: "Hover in a tab",
	params: schemas.TabHoverParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const tabId = extractTabId(params);
		const refId = extractRefId(params);
		if (!refId) throw makeError("tab_hover requires refId", "E_MISSING_PARAM");
		return unwrapResult(
			await sendMessageToTab(tabId, { action: "hover", params: { refId } }),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "Hover result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_unhover",
	namespace: "tab",
	description: "Unhover in a tab",
	params: schemas.TabUnhoverParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const tabId = extractTabId(params);
		return unwrapResult(
			await sendMessageToTab(tabId, { action: "unhover", params: {} }),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
	],
	returnDoc: "Unhover result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_scroll",
	namespace: "tab",
	description: "Scroll in a tab",
	params: schemas.TabScrollParamsSchema,
	returns: z.boolean(),
	handler: async (params) => {
		const obj = asRecord(params);
		const tabId = extractTabId(params);
		const direction = obj.direction ?? "down";
		const amount =
			typeof obj.amount === "number" ? obj.amount : DEFAULT_SCROLL_AMOUNT;
		return unwrapResult(
			await sendMessageToTab(tabId, {
				action: "scroll",
				params: { direction: String(direction), amount },
			}),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "direction",
			type: "string",
			required: false,
			description: "Scroll direction (up or down)",
		},
		{
			name: "amount",
			type: "number",
			required: false,
			description: "Scroll amount in pixels",
		},
	],
	returnDoc: "Scroll result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_dblclick",
	namespace: "tab",
	description: "Double-click in a tab",
	params: schemas.TabDblClickParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		const tabId = extractTabId(params);
		const refId = extractRefId(params);
		if (!refId)
			throw makeError("tab_dblclick requires refId", "E_MISSING_PARAM");
		return unwrapResult(
			await sendMessageToTab(tabId, { action: "dblclick", params: { refId } }),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "Double-click result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_evaluate",
	namespace: "tab",
	description: "Evaluate script in a tab",
	params: schemas.TabEvaluateParamsSchema,
	returns: z.unknown(), // eval result can be any JS value
	handler: async (params) => {
		const obj = asRecord(params);
		const tabId = extractTabId(params);
		const script = obj.script ?? obj.code ?? obj.js ?? "";
		return unwrapResult(
			await executeInTab(
				tabId,
				(code: unknown) => {
					try {
						return eval(String(code));
					} catch (e) {
						return { error: String(e) };
					}
				},
				[script],
			),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "script",
			type: "string",
			required: false,
			description: "Script to evaluate",
		},
		{
			name: "code",
			type: "string",
			required: false,
			description: "Alternative script code",
		},
		{
			name: "js",
			type: "string",
			required: false,
			description: "Alternative JS code",
		},
	],
	returnDoc: "Evaluation result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_back",
	namespace: "tab",
	description: "Go back in a tab",
	params: schemas.TabBackParamsSchema,
	returns: z.boolean(),
	handler: async (params) => {
		const tabId = extractTabId(params);
		return unwrapResult(
			await sendMessageToTab(tabId, { action: "back", params: {} }),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
	],
	returnDoc: "Back result",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_wait_for_load",
	namespace: "tab",
	description: "Wait for tab to load",
	params: schemas.TabWaitForLoadParamsSchema,
	returns: z.boolean(),
	handler: async (params) => {
		const obj = asRecord(params);
		const tabId = extractTabId(params);
		const timeout = typeof obj.timeout === "number" ? obj.timeout : 30000;
		return unwrapResult(await waitForTabLoad(tabId, timeout));
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "timeout",
			type: "number",
			required: false,
			description: "Timeout in milliseconds",
		},
	],
	returnDoc: "true",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_fetch",
	namespace: "tab",
	description: "Fetch from a tab",
	params: schemas.TabFetchParamsSchema,
	returns: schemas.FetchValueSchema,
	handler: async (params) => {
		const obj = asRecord(params);
		const tabId = extractTabId(params);
		const url = obj.url ?? "";
		const options = obj.options ?? {};
		return unwrapResult(
			await executeInTab(
				tabId,
				(u: unknown, opts: unknown) => {
					return fetch(String(u), opts as RequestInit).then(async (resp) => {
						const text = await resp.text();
						return {
							status: resp.status,
							ok: resp.ok,
							headers: Object.fromEntries(resp.headers.entries()),
							body: text,
						};
					});
				},
				[url, options],
			),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "url",
			type: "string",
			required: false,
			description: "URL to fetch",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Fetch options",
		},
	],
	returnDoc: "Response object",
	errorCode: "E_NO_TAB",
});

registerTool({
	action: "tab_snapshot",
	namespace: "tab",
	description: "Get tab snapshot",
	params: schemas.TabSnapshotParamsSchema,
	returns: z.string(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		const obj = asRecord(params);
		const opts = asRecord(obj.options ?? obj);
		const maxNodes =
			typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
		const result = await executeInTab(activeTab, buildSnapshotInTab, [
			maxNodes,
		]);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		if (result.value && typeof result.value === "object") {
			const val = result.value as Record<string, unknown>;
			return val.text as string;
		}
		throw makeError("Failed to get tab snapshot", "E_SNAPSHOT");
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",
});

registerTool({
	action: "tab_snapshot_text",
	namespace: "tab",
	description: "Get tab snapshot text",
	params: schemas.TabSnapshotTextParamsSchema,
	returns: z.string(),
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		const obj = asRecord(params);
		const opts = asRecord(obj.options ?? obj);
		const maxNodes =
			typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
		const result = await executeInTab(activeTab, buildSnapshotInTab, [
			maxNodes,
		]);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		if (result.value && typeof result.value === "object") {
			const val = result.value as Record<string, unknown>;
			return val.text as string;
		}
		throw makeError("Failed to get tab snapshot", "E_SNAPSHOT");
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",
});

registerTool({
	action: "tab_snapshot_data",
	namespace: "tab",
	description: "Get tab snapshot data",
	params: schemas.TabSnapshotDataParamsSchema,
	returns: schemas.SnapshotResultSchema,
	handler: async (params) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		const obj = asRecord(params);
		const opts = asRecord(obj.options ?? obj);
		const maxNodes =
			typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
		const result = await executeInTab(activeTab, buildSnapshotInTab, [
			maxNodes,
		]);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		if (result.value && typeof result.value === "object") {
			return result.value;
		}
		throw makeError("Failed to get tab snapshot", "E_SNAPSHOT");
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options",
		},
	],
	returnDoc: "Snapshot data",
	errorCode: "E_SNAPSHOT",
});

// ─── Filesystem ──────────────────────────────────────────────────

registerTool({
	action: "fs_exists",
	namespace: "fs",
	description: "Check if a file exists",
	params: schemas.FsPathParamsSchema,
	returns: z.boolean(),
	handler: async (params) => extFs.exists(params.path),
	paramTypes: [
		{
			name: "path",
			type: "string",
			required: true,
			description: "File or directory path",
		},
	],
	returnDoc: "true if exists",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_stat",
	namespace: "fs",
	description: "Get file stats",
	params: schemas.FsPathParamsSchema,
	returns: z
		.object({
			path: z.string(),
			name: z.string(),
			kind: z.string(),
			size: z.number(),
		})
		.nullable(),
	handler: async (params) => {
		const result = extFs.stat(params.path);
		if (!result) {
			throw makeError(`File not found: ${params.path}`, "E_NOT_FOUND");
		}
		return result;
	},
	paramTypes: [
		{
			name: "path",
			type: "string",
			required: true,
			description: "File or directory path",
		},
	],
	returnDoc: "File stats or null",
	errorCode: "E_NOT_FOUND",
});

registerTool({
	action: "fs_list",
	namespace: "fs",
	description: "List directory contents",
	params: schemas.FsPathParamsSchema,
	returns: z.array(z.object({ name: z.string(), kind: z.string() })).nullable(),
	handler: async (params) => extFs.list(params.path),
	paramTypes: [
		{
			name: "path",
			type: "string",
			required: true,
			description: "Directory path",
		},
	],
	returnDoc: "Array of entries or null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_mkdir",
	namespace: "fs",
	description: "Create a directory",
	params: schemas.FsPathParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		extFs.mkdir(params.path);
		return null;
	},
	paramTypes: [
		{
			name: "path",
			type: "string",
			required: true,
			description: "Directory path to create",
		},
	],
	returnDoc: "null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_delete",
	namespace: "fs",
	description: "Delete a file or directory",
	params: schemas.FsPathParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		extFs.delete(params.path);
		return null;
	},
	paramTypes: [
		{
			name: "path",
			type: "string",
			required: true,
			description: "File or directory path to delete",
		},
	],
	returnDoc: "null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_copy",
	namespace: "fs",
	description: "Copy a file",
	params: schemas.FsCopyParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		extFs.copy(params.from, params.to);
		return null;
	},
	paramTypes: [
		{
			name: "from",
			type: "string",
			required: true,
			description: "Source path",
		},
		{
			name: "to",
			type: "string",
			required: true,
			description: "Destination path",
		},
	],
	returnDoc: "null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_move",
	namespace: "fs",
	description: "Move a file",
	params: schemas.FsCopyParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		extFs.move(params.from, params.to);
		return null;
	},
	paramTypes: [
		{
			name: "from",
			type: "string",
			required: true,
			description: "Source path",
		},
		{
			name: "to",
			type: "string",
			required: true,
			description: "Destination path",
		},
	],
	returnDoc: "null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_read",
	namespace: "fs",
	description: "Read file contents as base64",
	params: schemas.FsPathParamsSchema,
	returns: z.string().nullable(),
	handler: async (params) => extFs.read(params.path),
	paramTypes: [
		{ name: "path", type: "string", required: true, description: "File path" },
	],
	returnDoc: "Base64 content or null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_read_text",
	namespace: "fs",
	description: "Read a file as text",
	params: schemas.FsPathParamsSchema,
	returns: z.string().nullable(),
	handler: async (params) => extFs.readText(params.path),
	paramTypes: [
		{ name: "path", type: "string", required: true, description: "File path" },
	],
	returnDoc: "Text content or null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_read_base64",
	namespace: "fs",
	description: "Read file contents as base64 (legacy alias)",
	params: schemas.FsPathParamsSchema,
	returns: z.string().nullable(),
	handler: async (params) => extFs.read(params.path),
	paramTypes: [
		{ name: "path", type: "string", required: true, description: "File path" },
	],
	returnDoc: "Base64 content or null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_read_range",
	namespace: "fs",
	description: "Read a file range",
	params: schemas.FsReadRangeParamsSchema,
	returns: z.string().nullable(),
	handler: async (params) =>
		extFs.readRange(params.path, Number(params.offset), params.len),
	paramTypes: [
		{ name: "path", type: "string", required: true, description: "File path" },
		{
			name: "offset",
			type: "number",
			required: true,
			description: "Byte offset",
		},
		{
			name: "len",
			type: "number",
			required: true,
			description: "Number of bytes to read",
		},
	],
	returnDoc: "Base64 content or null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_write",
	namespace: "fs",
	description: "Write a file",
	params: schemas.FsWriteParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		extFs.write(params.path, params.data);
		return null;
	},
	paramTypes: [
		{ name: "path", type: "string", required: true, description: "File path" },
		{
			name: "data",
			type: "string",
			required: true,
			description: "Base64 data to write",
		},
	],
	returnDoc: "null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_write_text",
	namespace: "fs",
	description: "Write text to a file",
	params: schemas.FsWriteParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		extFs.writeText(params.path, params.data);
		return null;
	},
	paramTypes: [
		{ name: "path", type: "string", required: true, description: "File path" },
		{
			name: "data",
			type: "string",
			required: true,
			description: "Text to write",
		},
	],
	returnDoc: "null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_write_base64",
	namespace: "fs",
	description: "Write base64 to a file",
	params: schemas.FsWriteParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		extFs.write(params.path, params.data);
		return null;
	},
	paramTypes: [
		{ name: "path", type: "string", required: true, description: "File path" },
		{
			name: "data",
			type: "string",
			required: true,
			description: "Base64 data to write",
		},
	],
	returnDoc: "null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_append",
	namespace: "fs",
	description: "Append to a file",
	params: schemas.FsWriteParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		extFs.append(params.path, params.data);
		return null;
	},
	paramTypes: [
		{ name: "path", type: "string", required: true, description: "File path" },
		{
			name: "data",
			type: "string",
			required: true,
			description: "Base64 data to append",
		},
	],
	returnDoc: "null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_append_text",
	namespace: "fs",
	description: "Append text to a file",
	params: schemas.FsWriteParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		extFs.appendText(params.path, params.data);
		return null;
	},
	paramTypes: [
		{ name: "path", type: "string", required: true, description: "File path" },
		{
			name: "data",
			type: "string",
			required: true,
			description: "Text to append",
		},
	],
	returnDoc: "null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_append_base64",
	namespace: "fs",
	description: "Append base64 to a file",
	params: schemas.FsWriteParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		extFs.append(params.path, params.data);
		return null;
	},
	paramTypes: [
		{ name: "path", type: "string", required: true, description: "File path" },
		{
			name: "data",
			type: "string",
			required: true,
			description: "Base64 data to append",
		},
	],
	returnDoc: "null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_update",
	namespace: "fs",
	description: "Update a file at offset",
	params: schemas.FsUpdateParamsSchema,
	returns: z.null(),
	handler: async (params) => {
		extFs.update(params.path, Number(params.offset), params.data);
		return null;
	},
	paramTypes: [
		{ name: "path", type: "string", required: true, description: "File path" },
		{
			name: "offset",
			type: "number",
			required: true,
			description: "Byte offset",
		},
		{
			name: "data",
			type: "string",
			required: true,
			description: "Base64 data to write",
		},
	],
	returnDoc: "null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

registerTool({
	action: "fs_hash",
	namespace: "fs",
	description: "Hash a file",
	params: schemas.FsHashParamsSchema,
	returns: z.string().nullable(),
	handler: async (params) => extFs.hash(params.path, params.algo as string),
	paramTypes: [
		{ name: "path", type: "string", required: true, description: "File path" },
		{
			name: "algo",
			type: "string",
			required: false,
			description: "Hash algorithm (sha1 or sha256)",
		},
	],
	returnDoc: "Hash string or null",
	errorCode: "EFS",
	errorCategory: "filesystem",
});

// ─── Chrome passthroughs ─────────────────────────────────────────

registerChromePassthrough(
	"chrome_runtime_sendMessage",
	"chrome",
	"Send a runtime message",
	["runtime"],
	schemas.ChromeRuntimeSendMessageParamsSchema,
	z.unknown(),
	"ECHROME",
	"extension",
	[
		{
			name: "message",
			type: "object",
			required: false,
			description: "Message to send",
		},
	],
);
registerChromePassthrough(
	"chrome_tabs_query",
	"chrome",
	"Query tabs",
	["tabs"],
	schemas.ChromeTabsQueryParamsSchema,
	schemas.ChromeTabArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "query",
			type: "object",
			required: false,
			description: "Tab query object",
		},
	],
);
registerChromePassthrough(
	"chrome_tabs_create",
	"chrome",
	"Create a tab",
	["tabs"],
	schemas.ChromeTabsCreateParamsSchema,
	schemas.ChromeTabSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "url",
			type: "string",
			required: false,
			description: "URL to open",
		},
		{
			name: "active",
			type: "boolean",
			required: false,
			description: "Whether to focus the new tab",
		},
	],
);
registerChromePassthrough(
	"chrome_tabs_update",
	"chrome",
	"Update a tab",
	["tabs"],
	schemas.ChromeTabsUpdateParamsSchema,
	schemas.ChromeTabSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to update",
		},
		{
			name: "update",
			type: "object",
			required: false,
			description: "Update properties",
		},
	],
);
registerChromePassthrough(
	"chrome_tabs_remove",
	"chrome",
	"Remove a tab",
	["tabs"],
	schemas.ChromeTabsRemoveParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to remove",
		},
	],
);
registerChromePassthrough(
	"chrome_tabs_get",
	"chrome",
	"Get a tab",
	["tabs"],
	schemas.ChromeTabsGetParamsSchema,
	schemas.ChromeTabSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to get",
		},
	],
);
registerChromePassthrough(
	"chrome_tabs_reload",
	"chrome",
	"Reload a tab",
	["tabs"],
	schemas.ChromeTabsReloadParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to reload",
		},
	],
);
registerChromePassthrough(
	"chrome_tabs_sendMessage",
	"chrome",
	"Send a message to a tab",
	["tabs"],
	schemas.ChromeTabsSendMessageParamsSchema,
	z.unknown(),
	"ECHROME",
	"extension",
	[
		{ name: "tabId", type: "number", required: false, description: "Tab ID" },
		{
			name: "message",
			type: "object",
			required: false,
			description: "Message to send",
		},
	],
);

registerChromePassthrough(
	"chrome_alarms_create",
	"chrome",
	"Create an alarm",
	["alarms"],
	schemas.ChromeAlarmsCreateParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "name",
			type: "string",
			required: false,
			description: "Alarm name",
		},
		{
			name: "alarmInfo",
			type: "object",
			required: false,
			description: "Alarm info",
		},
	],
);
registerChromePassthrough(
	"chrome_alarms_clear",
	"chrome",
	"Clear an alarm",
	["alarms"],
	schemas.ChromeAlarmsClearParamsSchema,
	schemas.ChromeAlarmsClearSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "name",
			type: "string",
			required: false,
			description: "Alarm name to clear",
		},
	],
);

registerChromePassthrough(
	"chrome_action_setBadgeText",
	"chrome",
	"Set badge text",
	["action"],
	schemas.ChromeActionSetBadgeTextParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "text",
			type: "string",
			required: false,
			description: "Badge text",
		},
		{ name: "tabId", type: "number", required: false, description: "Tab ID" },
	],
);
registerChromePassthrough(
	"chrome_action_setBadgeBackgroundColor",
	"chrome",
	"Set badge background color",
	["action"],
	schemas.ChromeActionSetBadgeBackgroundColorParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "color",
			type: "string",
			required: false,
			description: "Badge color",
		},
		{ name: "tabId", type: "number", required: false, description: "Tab ID" },
	],
);
registerChromePassthrough(
	"chrome_action_setTitle",
	"chrome",
	"Set action title",
	["action"],
	schemas.ChromeActionSetTitleParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "title",
			type: "string",
			required: false,
			description: "Action title",
		},
		{ name: "tabId", type: "number", required: false, description: "Tab ID" },
	],
);
registerChromePassthrough(
	"chrome_action_setIcon",
	"chrome",
	"Set action icon",
	["action"],
	schemas.ChromeActionSetIconParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{ name: "path", type: "string", required: false, description: "Icon path" },
		{ name: "tabId", type: "number", required: false, description: "Tab ID" },
	],
);

registerChromePassthrough(
	"chrome_contextMenus_create",
	"chrome",
	"Create a context menu",
	["contextMenus"],
	schemas.ChromeContextMenusCreateParamsSchema,
	schemas.ChromeMenuItemIdSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "createProperties",
			type: "object",
			required: false,
			description: "Menu properties",
		},
	],
);
registerChromePassthrough(
	"chrome_contextMenus_remove",
	"chrome",
	"Remove a context menu",
	["contextMenus"],
	schemas.ChromeContextMenusRemoveParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "menuItemId",
			type: "string",
			required: false,
			description: "Menu item ID to remove",
		},
	],
);

registerChromePassthrough(
	"chrome_windows_getAll",
	"chrome",
	"Get all windows",
	["windows"],
	schemas.ChromeWindowsGetAllParamsSchema,
	schemas.ChromeWindowArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "populate",
			type: "boolean",
			required: false,
			description: "Whether to populate tab info",
		},
	],
);
registerChromePassthrough(
	"chrome_windows_create",
	"chrome",
	"Create a window",
	["windows"],
	schemas.ChromeWindowsCreateParamsSchema,
	schemas.ChromeWindowSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "url",
			type: "string",
			required: false,
			description: "URL to open",
		},
		{
			name: "type",
			type: "string",
			required: false,
			description: "Window type",
		},
	],
);
registerChromePassthrough(
	"chrome_windows_update",
	"chrome",
	"Update a window",
	["windows"],
	schemas.ChromeWindowsUpdateParamsSchema,
	schemas.ChromeWindowSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "windowId",
			type: "number",
			required: false,
			description: "Window ID",
		},
		{
			name: "updateInfo",
			type: "object",
			required: false,
			description: "Update info",
		},
	],
);
registerChromePassthrough(
	"chrome_windows_remove",
	"chrome",
	"Remove a window",
	["windows"],
	schemas.ChromeWindowsRemoveParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "windowId",
			type: "number",
			required: false,
			description: "Window ID to remove",
		},
	],
);

registerChromePassthrough(
	"chrome_sidePanel_setOptions",
	"chrome",
	"Set sidepanel options",
	["sidePanel"],
	schemas.ChromeSidePanelSetOptionsParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "path",
			type: "string",
			required: false,
			description: "Panel path",
		},
		{
			name: "enabled",
			type: "boolean",
			required: false,
			description: "Whether enabled",
		},
	],
);

registerChromePassthrough(
	"chrome_cookies_get",
	"chrome",
	"Get a cookie",
	["cookies"],
	schemas.ChromeCookiesGetParamsSchema,
	schemas.ChromeCookieSchema,
	"ECHROME",
	"extension",
	[
		{ name: "url", type: "string", required: false, description: "Cookie URL" },
		{
			name: "name",
			type: "string",
			required: false,
			description: "Cookie name",
		},
	],
);
registerChromePassthrough(
	"chrome_cookies_set",
	"chrome",
	"Set a cookie",
	["cookies"],
	schemas.ChromeCookiesSetParamsSchema,
	schemas.ChromeCookieSchema,
	"ECHROME",
	"extension",
	[
		{ name: "url", type: "string", required: false, description: "Cookie URL" },
		{
			name: "name",
			type: "string",
			required: false,
			description: "Cookie name",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Cookie value",
		},
	],
);
registerChromePassthrough(
	"chrome_cookies_remove",
	"chrome",
	"Remove a cookie",
	["cookies"],
	schemas.ChromeCookiesRemoveParamsSchema,
	z.record(z.unknown()),
	"ECHROME",
	"extension",
	[
		{ name: "url", type: "string", required: false, description: "Cookie URL" },
		{
			name: "name",
			type: "string",
			required: false,
			description: "Cookie name",
		},
	],
);
registerChromePassthrough(
	"chrome_cookies_getAll",
	"chrome",
	"Get all cookies",
	["cookies"],
	schemas.ChromeCookiesGetAllParamsSchema,
	schemas.ChromeCookieArraySchema,
	"ECHROME",
	"extension",
	[{ name: "url", type: "string", required: false, description: "Cookie URL" }],
);

registerChromePassthrough(
	"chrome_bookmarks_search",
	"chrome",
	"Search bookmarks",
	["bookmarks"],
	schemas.ChromeBookmarksSearchParamsSchema,
	schemas.ChromeBookmarkArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "query",
			type: "string",
			required: false,
			description: "Search query",
		},
	],
);
registerChromePassthrough(
	"chrome_bookmarks_create",
	"chrome",
	"Create a bookmark",
	["bookmarks"],
	schemas.ChromeBookmarksCreateParamsSchema,
	z.record(z.unknown()),
	"ECHROME",
	"extension",
	[
		{
			name: "parentId",
			type: "string",
			required: false,
			description: "Parent folder ID",
		},
		{
			name: "title",
			type: "string",
			required: false,
			description: "Bookmark title",
		},
		{
			name: "url",
			type: "string",
			required: false,
			description: "Bookmark URL",
		},
	],
);
registerChromePassthrough(
	"chrome_bookmarks_remove",
	"chrome",
	"Remove a bookmark",
	["bookmarks"],
	schemas.ChromeBookmarksRemoveParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "id",
			type: "string",
			required: false,
			description: "Bookmark ID to remove",
		},
	],
);

registerChromePassthrough(
	"chrome_history_search",
	"chrome",
	"Search history",
	["history"],
	schemas.ChromeHistorySearchParamsSchema,
	schemas.ChromeHistoryArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "text",
			type: "string",
			required: false,
			description: "Search text",
		},
		{
			name: "maxResults",
			type: "number",
			required: false,
			description: "Maximum results",
		},
	],
);
registerChromePassthrough(
	"chrome_history_deleteUrl",
	"chrome",
	"Delete a URL from history",
	["history"],
	schemas.ChromeHistoryDeleteUrlParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "url",
			type: "string",
			required: false,
			description: "URL to delete from history",
		},
	],
);

registerChromePassthrough(
	"chrome_notifications_create",
	"chrome",
	"Create a notification",
	["notifications"],
	schemas.ChromeNotificationsCreateParamsSchema,
	schemas.ChromeNotificationIdSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "id",
			type: "string",
			required: false,
			description: "Notification ID",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Notification options",
		},
	],
);
registerChromePassthrough(
	"chrome_notifications_clear",
	"chrome",
	"Clear a notification",
	["notifications"],
	schemas.ChromeNotificationsClearParamsSchema,
	schemas.ChromeNotificationClearSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "id",
			type: "string",
			required: false,
			description: "Notification ID to clear",
		},
	],
);

registerChromePassthrough(
	"chrome_scripting_executeScript",
	"chrome",
	"Execute a script",
	["scripting"],
	schemas.ChromeScriptingExecuteScriptParamsSchema,
	schemas.ChromeScriptResultSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "target",
			type: "object",
			required: false,
			description: "Script target",
		},
		{
			name: "func",
			type: "string",
			required: false,
			description: "Function to execute",
		},
		{
			name: "args",
			type: "array",
			required: false,
			description: "Function arguments",
		},
	],
);
registerChromePassthrough(
	"chrome_tabGroups_query",
	"chrome",
	"Query tab groups",
	["tabGroups"],
	schemas.ChromeTabGroupsQueryParamsSchema,
	schemas.ChromeTabGroupArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "query",
			type: "object",
			required: false,
			description: "Tab group query",
		},
	],
);

registerChromePassthrough(
	"chrome_tabGroups_get",
	"chrome",
	"Get a tab group",
	["tabGroups"],
	schemas.ChromeTabGroupsGetParamsSchema,
	schemas.ChromeTabGroupSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "groupId",
			type: "number",
			required: false,
			description: "Tab group ID",
		},
	],
);

registerChromePassthrough(
	"chrome_tabGroups_update",
	"chrome",
	"Update a tab group",
	["tabGroups"],
	schemas.ChromeTabGroupsUpdateParamsSchema,
	schemas.ChromeTabGroupSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "groupId",
			type: "number",
			required: false,
			description: "Tab group ID",
		},
		{
			name: "update",
			type: "object",
			required: false,
			description: "Update properties",
		},
	],
);

registerChromePassthrough(
	"chrome_tabs_group",
	"chrome",
	"Group tabs",
	["tabs"],
	schemas.ChromeTabsGroupParamsSchema,
	z.number(),
	"ECHROME",
	"extension",
	[
		{
			name: "tabIds",
			type: "array",
			required: false,
			description: "Tab IDs to group",
		},
		{
			name: "groupId",
			type: "number",
			required: false,
			description: "Group ID",
		},
	],
);

registerChromePassthrough(
	"chrome_tabs_ungroup",
	"chrome",
	"Ungroup tabs",
	["tabs"],
	schemas.ChromeTabsUngroupParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "tabIds",
			type: "number",
			required: false,
			description: "Tab ID to ungroup",
		},
	],
);

registerChromePassthrough(
	"chrome_sessions_getRecentlyClosed",
	"chrome",
	"Get recently closed sessions",
	["sessions"],
	schemas.ChromeSessionsGetRecentlyClosedParamsSchema,
	schemas.ChromeSessionArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "filter",
			type: "object",
			required: false,
			description: "Session filter",
		},
	],
);

registerChromePassthrough(
	"chrome_sessions_restore",
	"chrome",
	"Restore a session",
	["sessions"],
	schemas.ChromeSessionsRestoreParamsSchema,
	schemas.ChromeSessionArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "sessionId",
			type: "string",
			required: false,
			description: "Session ID",
		},
	],
);

registerChromePassthrough(
	"chrome_sessions_getDevices",
	"chrome",
	"Get synced devices",
	["sessions"],
	schemas.ChromeSessionsGetDevicesParamsSchema,
	schemas.ChromeDeviceArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "filter",
			type: "object",
			required: false,
			description: "Device filter",
		},
	],
);

registerChromePassthrough(
	"chrome_downloads_download",
	"chrome",
	"Download a file",
	["downloads"],
	schemas.ChromeDownloadsDownloadParamsSchema,
	schemas.ChromeDownloadIdSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "url",
			type: "string",
			required: false,
			description: "Download URL",
		},
	],
);

registerChromePassthrough(
	"chrome_downloads_search",
	"chrome",
	"Search downloads",
	["downloads"],
	schemas.ChromeDownloadsSearchParamsSchema,
	schemas.ChromeDownloadArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "query",
			type: "object",
			required: false,
			description: "Download query",
		},
	],
);

registerChromePassthrough(
	"chrome_downloads_erase",
	"chrome",
	"Erase downloads",
	["downloads"],
	schemas.ChromeDownloadsEraseParamsSchema,
	schemas.ChromeDownloadArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "query",
			type: "object",
			required: false,
			description: "Download query",
		},
	],
);

registerChromePassthrough(
	"chrome_downloads_pause",
	"chrome",
	"Pause a download",
	["downloads"],
	schemas.ChromeDownloadsPauseParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "downloadId",
			type: "number",
			required: false,
			description: "Download ID",
		},
	],
);

registerChromePassthrough(
	"chrome_downloads_resume",
	"chrome",
	"Resume a download",
	["downloads"],
	schemas.ChromeDownloadsResumeParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "downloadId",
			type: "number",
			required: false,
			description: "Download ID",
		},
	],
);

registerChromePassthrough(
	"chrome_downloads_cancel",
	"chrome",
	"Cancel a download",
	["downloads"],
	schemas.ChromeDownloadsCancelParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "downloadId",
			type: "number",
			required: false,
			description: "Download ID",
		},
	],
);

registerChromePassthrough(
	"chrome_downloads_open",
	"chrome",
	"Open a downloaded file",
	["downloads"],
	schemas.ChromeDownloadsOpenParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "downloadId",
			type: "number",
			required: false,
			description: "Download ID",
		},
	],
);

registerChromePassthrough(
	"chrome_downloads_show",
	"chrome",
	"Show a downloaded file",
	["downloads"],
	schemas.ChromeDownloadsShowParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "downloadId",
			type: "number",
			required: false,
			description: "Download ID",
		},
	],
);

registerChromePassthrough(
	"chrome_system_cpu_getInfo",
	"chrome",
	"Get CPU info",
	["system", "cpu"],
	schemas.ChromeSystemCpuGetInfoParamsSchema,
	schemas.ChromeSystemCpuInfoSchema,
	"ECHROME",
	"extension",
	[],
);

registerChromePassthrough(
	"chrome_system_memory_getInfo",
	"chrome",
	"Get memory info",
	["system", "memory"],
	schemas.ChromeSystemMemoryGetInfoParamsSchema,
	schemas.ChromeSystemMemoryInfoSchema,
	"ECHROME",
	"extension",
	[],
);

registerChromePassthrough(
	"chrome_system_storage_getInfo",
	"chrome",
	"Get storage info",
	["system", "storage"],
	schemas.ChromeSystemStorageGetInfoParamsSchema,
	schemas.ChromeSystemStorageInfoSchema,
	"ECHROME",
	"extension",
	[],
);

// ─── Alias actions ───────────────────────────────────────────────

function registerAlias(
	action: string,
	target: string,
	description: string,
	returnsSchema: z.ZodSchema<unknown>,
	paramTypes: ToolDocParam[] = [],
): void {
	registerTool({
		action,
		namespace: "chrome",
		description,
		params: z.record(z.unknown()),
		returns: returnsSchema,
		handler: async (params) => {
			const log = logger.child("alias");
			log.debug("alias_dispatch", { action, target });
			return unwrapResult(await dispatchTool(target, params));
		},
		paramTypes,
		returnDoc: "Alias result",
		errorCode: "ECHROME",
		errorCategory: "extension",
	});
}

registerAlias(
	"cookies_get",
	"chrome_cookies_get",
	"Get a cookie",
	schemas.ChromeCookieSchema,
	[
		{ name: "url", type: "string", required: false, description: "Cookie URL" },
		{
			name: "name",
			type: "string",
			required: false,
			description: "Cookie name",
		},
	],
);
registerAlias(
	"cookies_set",
	"chrome_cookies_set",
	"Set a cookie",
	schemas.ChromeCookieSchema,
	[
		{ name: "url", type: "string", required: false, description: "Cookie URL" },
		{
			name: "name",
			type: "string",
			required: false,
			description: "Cookie name",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Cookie value",
		},
	],
);
registerAlias(
	"cookies_delete",
	"chrome_cookies_remove",
	"Remove a cookie",
	z.record(z.unknown()),
	[
		{ name: "url", type: "string", required: false, description: "Cookie URL" },
		{
			name: "name",
			type: "string",
			required: false,
			description: "Cookie name",
		},
	],
);
registerAlias(
	"cookies_list",
	"chrome_cookies_getAll",
	"Get all cookies",
	schemas.ChromeCookieArraySchema,
	[{ name: "url", type: "string", required: false, description: "Cookie URL" }],
);
registerAlias(
	"history_search",
	"chrome_history_search",
	"Search history",
	schemas.ChromeHistoryArraySchema,
	[
		{
			name: "text",
			type: "string",
			required: false,
			description: "Search text",
		},
		{
			name: "maxResults",
			type: "number",
			required: false,
			description: "Maximum results",
		},
	],
);
registerAlias(
	"history_delete",
	"chrome_history_deleteUrl",
	"Delete a URL from history",
	z.null(),
	[
		{
			name: "url",
			type: "string",
			required: false,
			description: "URL to delete from history",
		},
	],
);
registerAlias(
	"bookmarks_search",
	"chrome_bookmarks_search",
	"Search bookmarks",
	schemas.ChromeBookmarkArraySchema,
	[
		{
			name: "query",
			type: "string",
			required: false,
			description: "Search query",
		},
	],
);
registerAlias(
	"bookmarks_create",
	"chrome_bookmarks_create",
	"Create a bookmark",
	z.record(z.unknown()),
	[
		{
			name: "parentId",
			type: "string",
			required: false,
			description: "Parent folder ID",
		},
		{
			name: "title",
			type: "string",
			required: false,
			description: "Bookmark title",
		},
		{
			name: "url",
			type: "string",
			required: false,
			description: "Bookmark URL",
		},
	],
);
registerAlias(
	"bookmarks_delete",
	"chrome_bookmarks_remove",
	"Remove a bookmark",
	z.null(),
	[
		{
			name: "id",
			type: "string",
			required: false,
			description: "Bookmark ID to remove",
		},
	],
);
registerAlias(
	"notifications_create",
	"chrome_notifications_create",
	"Create a notification",
	schemas.ChromeNotificationIdSchema,
	[
		{
			name: "id",
			type: "string",
			required: false,
			description: "Notification ID",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Notification options",
		},
	],
);
registerAlias(
	"notifications_clear",
	"chrome_notifications_clear",
	"Clear a notification",
	schemas.ChromeNotificationClearSchema,
	[
		{
			name: "id",
			type: "string",
			required: false,
			description: "Notification ID to clear",
		},
	],
);

// ─── Host call ───────────────────────────────────────────────────

registerTool({
	action: "host_call",
	namespace: "host",
	description: "Call a host handler",
	params: schemas.HostCallParamsSchema,
	returns: z.unknown(), // host handler result is arbitrary
	handler: async (params) => {
		const obj = asRecord(params);
		const action = obj.action as string;
		const actionParams = obj.params;
		return unwrapResult(await handleHostCallAction(action, actionParams));
	},
	paramTypes: [
		{
			name: "action",
			type: "string",
			required: true,
			description: "Host action name",
		},
		{
			name: "params",
			type: "object",
			required: false,
			description: "Parameters for the host action",
		},
	],
	returnDoc: "Handler result",
	errorCode: "ENOHANDLER",
	errorCategory: "host",
});

initExtensionListeners();
