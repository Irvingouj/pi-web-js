import { logger } from "./logger.js";
import {
	asRecord,
	findElementByLabel,
	findSemanticCandidates,
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

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

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
			el.value += text;
			const ev = new InputEvent("input", { bubbles: true });
			el.dispatchEvent(ev);
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
		window.scrollBy({
			top: direction === "down" ? amount : -amount,
			behavior: "smooth",
		});
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
		const ev = new MouseEvent("dblclick", { bubbles: true });
		el.dispatchEvent(ev);
		return makeActionResult("dblclick", el);
	},

	forward: () => {
		window.history.forward();
		return makeActionResult("forward", null);
	},

	reload: () => {
		window.location.reload();
		return makeActionResult("reload", null);
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
		const code = getStringParam(params, "code");
		if (typeof code !== "string") {
			throw new Error("evaluate requires a string argument");
		}
		// Use new Function to avoid capturing local scope (marginally safer than eval)
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
		const obj = asRecord(params);
		const maxNodes = typeof obj.max_nodes === "number" ? obj.max_nodes : 500;
		logger.debug("snapshot", { maxNodes, hasBody: !!document.body });
		const r = inlineSnapshot(maxNodes);
		logger.debug("snapshot_result", { nodeCount: r.nodes.length });
		return r;
	},

	fetch: async (params, signal) => {
		const obj = asRecord(params);
		const url = obj.url;
		const method = (obj.method || "GET").toString().toUpperCase();
		const headers = obj.headers || {};
		const body = obj.body ?? null;
		const timeout = typeof obj.timeout === "number" ? obj.timeout : DEFAULT_FETCH_TIMEOUT_MS;

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
				headers:
					typeof headers === "object" && headers !== null
						? (headers as Record<string, string>)
						: {},
				signal: controller.signal,
			};
			if (body !== null && body !== undefined) {
				fetchOpts.body = typeof body === "string" ? body : String(body);
			}
			const resp = await fetch(url as string, fetchOpts);
			const text = await resp.text();
			return {
				status: resp.status,
				ok: resp.ok,
				headers: Object.fromEntries(resp.headers.entries()),
				body: text,
			};
		} catch (e) {
			throw e;
		} finally {
			clearTimeout(timeoutId);
			signal?.removeEventListener("abort", onRelayAbort);
		}
	},
};
