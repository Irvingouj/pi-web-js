import { logger } from "./logger.js";
import {
	asRecord,
	findElementByLabel,
	getElementByRefId,
	getNumberParam,
	getStringParam,
	throwElementNotFound,
} from "./dom-utils.js";
import { inlineSnapshot } from "./snapshot.js";
import {
	assertFillEffect,
	makeActionResult,
} from "./action-result.js";
import { throwStructuredAgentError } from "../shared/registry/agent-errors.js";

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_FOR_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

function resolveMaxNodes(params: unknown): number {
	const obj = asRecord(params);
	const opts = asRecord(obj.options ?? obj);
	const raw = opts.max_nodes ?? obj.max_nodes;
	let maxNodes = 500;
	if (typeof raw === "number" && Number.isFinite(raw)) {
		maxNodes = raw;
	} else if (typeof raw === "bigint") {
		maxNodes = Number(raw);
	}
	return Math.max(1, Math.min(10_000, Math.floor(maxNodes)));
}

function normalizeFetchParams(params: unknown): {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | null;
	timeout: number;
} {
	const obj = asRecord(params);
	const options = asRecord(obj.options ?? {});
	const url = String(obj.url ?? "");
	const method = String(
		options.method ?? obj.method ?? "GET",
	).toUpperCase();
	const headersRaw = options.headers ?? obj.headers ?? {};
	const headers =
		typeof headersRaw === "object" && headersRaw !== null
			? (headersRaw as Record<string, string>)
			: {};
	const bodyValue = options.body ?? obj.body ?? null;
	const body =
		bodyValue === null || bodyValue === undefined
			? null
			: typeof bodyValue === "string"
				? bodyValue
				: String(bodyValue);
	const timeoutRaw = obj.timeout ?? options.timeout;
	const timeout =
		typeof timeoutRaw === "number"
			? timeoutRaw
			: typeof timeoutRaw === "bigint"
				? Number(timeoutRaw)
				: DEFAULT_FETCH_TIMEOUT_MS;
	return { url, method, headers, body, timeout };
}

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) {
		return Promise.reject(new DOMException("Aborted", "AbortError"));
	}
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(new DOMException("Aborted", "AbortError"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function resolveEvaluateCode(params: unknown): string {
	const obj = asRecord(params);
	const code = obj.script ?? obj.code ?? obj.js ?? "";
	if (typeof code !== "string" || code.length === 0) {
		throw new Error("evaluate requires a string argument");
	}
	return code;
}

export type Handler<T = unknown, R = unknown> = (
	params: T,
	signal?: AbortSignal,
) => R | Promise<R>;

export const handlers: Record<string, Handler> = {
	click: (params) => {
		const refId = getStringParam(params, "refId");
		const label = getStringParam(params, "label");
		let el = refId ? getElementByRefId(refId) : null;
		if (!el && label) {
			el = findElementByLabel(label);
		}
		if (!el) {
			throwElementNotFound(refId, label, true);
		}
		(el as HTMLElement).click();
		return makeActionResult("click", el);
	},

	fill: (params) => {
		const refId = getStringParam(params, "refId");
		const label = getStringParam(params, "label");
		const value = getStringParam(params, "value");
		let el = refId ? getElementByRefId(refId) : null;
		if (!el && label) {
			el = findElementByLabel(label);
		}
		if (!el) {
			throwElementNotFound(refId, label, true);
		}
		if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
			el.value = value;
			const ev = new InputEvent("input", { bubbles: true });
			el.dispatchEvent(ev);
			const resolvedRefId = refId || el.getAttribute("data-ref-id") || "";
			assertFillEffect("fill", el, resolvedRefId, value);
			return makeActionResult("fill", el, { value: el.value });
		}
		throw new Error("Element is not an input");
	},

	type: (params) => {
		const refId = getStringParam(params, "refId");
		const label = getStringParam(params, "label");
		const text = getStringParam(params, "text");
		let el = refId ? getElementByRefId(refId) : null;
		if (!el && label) {
			el = findElementByLabel(label);
		}
		if (!el) {
			throwElementNotFound(refId, label, true);
		}
		if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
			el.value = text;
			const ev = new InputEvent("input", { bubbles: true });
			el.dispatchEvent(ev);
			const resolvedRefId = refId || el.getAttribute("data-ref-id") || "";
			assertFillEffect("type", el, resolvedRefId, text);
			return makeActionResult("type", el, { text: el.value });
		}
		throw new Error("Element is not an input");
	},

	append: (params) => {
		const refId = getStringParam(params, "refId");
		const label = getStringParam(params, "label");
		const text = getStringParam(params, "text");
		let el = refId ? getElementByRefId(refId) : null;
		if (!el && label) {
			el = findElementByLabel(label);
		}
		if (!el) {
			throwElementNotFound(refId, label, true);
		}
		if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
			const before = el.value;
			const expected = before + text;
			el.value += text;
			const ev = new InputEvent("input", { bubbles: true });
			el.dispatchEvent(ev);
			const resolvedRefId = refId || el.getAttribute("data-ref-id") || "";
			assertFillEffect("append", el, resolvedRefId, expected);
			return makeActionResult("append", el, { text: el.value });
		}
		throw new Error("Element is not an input");
	},

	press: (params) => {
		const key = getStringParam(params, "key");
		const evDown = new KeyboardEvent("keydown", { key, bubbles: true });
		document.dispatchEvent(evDown);
		const evUp = new KeyboardEvent("keyup", { key, bubbles: true });
		document.dispatchEvent(evUp);
		return makeActionResult("press", null, { key });
	},

	select: (params) => {
		const refId = getStringParam(params, "refId");
		const label = getStringParam(params, "label");
		const value = getStringParam(params, "value");
		let el = refId ? getElementByRefId(refId) : null;
		if (!el && label) {
			el = findElementByLabel(label);
		}
		if (!el) {
			throwElementNotFound(refId, label, true);
		}
		if (el instanceof HTMLSelectElement) {
			el.value = value;
			el.dispatchEvent(new Event("change", { bubbles: true }));
			return makeActionResult("select", el, { value: el.value });
		}
		throw new Error("Element is not a select");
	},

	check: (params) => {
		const refId = getStringParam(params, "refId");
		const label = getStringParam(params, "label");
		const checked = (() => {
			const obj = asRecord(params);
			return typeof obj.checked === "boolean" ? obj.checked : true;
		})();
		let el = refId ? getElementByRefId(refId) : null;
		if (!el && label) {
			el = findElementByLabel(label);
		}
		if (!el) {
			throwElementNotFound(refId, label, true);
		}
		if (
			el instanceof HTMLInputElement &&
			(el.type === "checkbox" || el.type === "radio")
		) {
			el.checked = checked;
			el.dispatchEvent(new Event("change", { bubbles: true }));
			return makeActionResult("check", el, { checked: el.checked });
		}
		throw new Error("Element is not a checkbox or radio");
	},

	hover: (params) => {
		const refId = getStringParam(params, "refId");
		const label = getStringParam(params, "label");
		let el = refId ? getElementByRefId(refId) : null;
		if (!el && label) {
			el = findElementByLabel(label);
		}
		if (!el) {
			throwElementNotFound(refId, label, true);
		}
		const ev = new MouseEvent("mouseenter", { bubbles: true });
		el.dispatchEvent(ev);
		return makeActionResult("hover", el);
	},

	unhover: () => {
		const ev = new MouseEvent("mouseleave", { bubbles: true });
		document.body.dispatchEvent(ev);
		return makeActionResult("unhover", null);
	},

	scroll: (params) => {
		const obj = asRecord(params);
		const direction = (obj.direction as string) ?? "down";
		const amount = typeof obj.amount === "number" ? obj.amount : 300;
		const top =
			direction === "down"
				? amount
				: direction === "up"
					? -amount
					: 0;
		const left =
			direction === "right"
				? amount
				: direction === "left"
					? -amount
					: 0;
		window.scrollBy({ top, left, behavior: "smooth" });
		return makeActionResult("scroll", null, { direction, amount });
	},

	dblclick: (params) => {
		const refId = getStringParam(params, "refId");
		const label = getStringParam(params, "label");
		let el = refId ? getElementByRefId(refId) : null;
		if (!el && label) {
			el = findElementByLabel(label);
		}
		if (!el) {
			throwElementNotFound(refId, label, true);
		}
		const target = el as HTMLElement;
		target.click();
		target.click();
		target.dispatchEvent(
			new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
		);
		return makeActionResult("dblclick", el);
	},

	forward: () => {
		window.history.forward();
		return makeActionResult("forward", null);
	},

	scroll_to: (params) => {
		const refId = getStringParam(params, "refId");
		const label = getStringParam(params, "label");
		const x = getNumberParam(params, "x", 0);
		const y = getNumberParam(params, "y", 0);
		if (refId || label) {
			let el = refId ? getElementByRefId(refId) : null;
			if (!el && label) {
				el = findElementByLabel(label);
			}
			if (el) {
				el.scrollIntoView({ behavior: "smooth" });
				return makeActionResult("scroll_to", el);
			}
			throwElementNotFound(refId, label, true);
		}
		window.scrollTo({ top: y, left: x, behavior: "smooth" });
		return makeActionResult("scroll_to", null, { amount: y });
	},

	evaluate: (params) => {
		const code = resolveEvaluateCode(params);
		return new Function(code)();
	},

	back: () => {
		window.history.back();
		return makeActionResult("back", null);
	},

	ping: () => {
		return { ok: true };
	},

	snapshot: async (params) => {
		if (!document.body) {
			throwStructuredAgentError({
				message: "Document body not available for snapshot",
				code: "E_SNAPSHOT",
				category: "resource",
			});
		}
		const maxNodes = resolveMaxNodes(params);
		logger.debug("snapshot", { maxNodes, hasBody: !!document.body });
		const r = inlineSnapshot(maxNodes);
		logger.debug("snapshot_result", { nodeCount: r.nodes.length });
		return r;
	},

	snapshot_text: async (params) => {
		if (!document.body) {
			throwStructuredAgentError({
				message: "Document body not available for snapshot",
				code: "E_SNAPSHOT",
				category: "resource",
			});
		}
		const maxNodes = resolveMaxNodes(params);
		const r = inlineSnapshot(maxNodes);
		return r.text;
	},

	find: (params) => {
		const selector = getStringParam(params, "selector");
		const elements = Array.from(document.querySelectorAll(selector));
		return elements.map((el) => ({
			tag: el.tagName,
			refId: el.getAttribute("data-ref-id"),
			text: el.textContent?.slice(0, 100) || "",
		}));
	},

	wait_for: async (params, signal) => {
		const selector = getStringParam(params, "selector");
		const obj = asRecord(params);
		const timeoutMs =
			typeof obj.timeout === "number"
				? obj.timeout
				: typeof obj.timeout === "bigint"
					? Number(obj.timeout)
					: DEFAULT_WAIT_FOR_TIMEOUT_MS;
		const start = Date.now();
		while (true) {
			if (signal?.aborted) {
				throw new DOMException("Aborted", "AbortError");
			}
			if (document.querySelector(selector)) {
				return true;
			}
			if (Date.now() - start >= timeoutMs) {
				throwStructuredAgentError({
					message: `Timeout waiting for selector: ${selector}`,
					code: "E_TIMEOUT",
					category: "timeout",
				});
			}
			await sleepWithSignal(DEFAULT_POLL_INTERVAL_MS, signal);
		}
	},

	extract: (params) => {
		const obj = asRecord(params);
		const fieldList = Array.isArray(obj.fields) ? obj.fields : [];
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
				result.text = document.body?.textContent?.trim().slice(0, 500) || "";
			}
		}
		return result;
	},

	fetch: async (params, signal) => {
		const { url, method, headers, body, timeout } = normalizeFetchParams(params);
		if (!url) {
			throw new Error("fetch requires a url");
		}

		const controller = new AbortController();
		const onRelayAbort = () => controller.abort();
		if (signal) {
			if (signal.aborted) {
				throw new DOMException("Aborted", "AbortError");
			}
			signal.addEventListener("abort", onRelayAbort, { once: true });
		}
		const timeoutId = setTimeout(() => controller.abort(), timeout);
		try {
			const fetchOpts: RequestInit = {
				method,
				headers,
				signal: controller.signal,
			};
			if (body !== null) {
				fetchOpts.body = body;
			}
			const resp = await fetch(url, fetchOpts);
			const text = await resp.text();
			return {
				status: resp.status,
				ok: resp.ok,
				headers: Object.fromEntries(resp.headers.entries()),
				body: text,
			};
		} finally {
			clearTimeout(timeoutId);
			signal?.removeEventListener("abort", onRelayAbort);
		}
	},
};
