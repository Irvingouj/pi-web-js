import { logger } from "./logger.js";
import {
	asRecord,
	findCandidateLabels,
	findElementByLabel,
	getElementByRefId,
	getNumberParam,
	getStringParam,
} from "./dom-utils.js";
import { inlineSnapshot } from "./snapshot.js";

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
			const query = label || refId;
			const candidates = query ? findCandidateLabels(query) : [];
			throw new Error(
				`Element not found${query ? ` by label: "${query}"` : ""}. Candidates: ${candidates.join(", ") || "none"}`,
			);
		}
		(el as HTMLElement).click();
		return null;
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
			const query = label || refId;
			const candidates = query ? findCandidateLabels(query) : [];
			throw new Error(
				`Element not found${query ? ` by label: "${query}"` : ""}. Candidates: ${candidates.join(", ") || "none"}`,
			);
		}
		if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
			el.value = value;
			const ev = new InputEvent("input", { bubbles: true });
			el.dispatchEvent(ev);
			return null;
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
			const query = label || refId;
			const candidates = query ? findCandidateLabels(query) : [];
			throw new Error(
				`Element not found${query ? ` by label: "${query}"` : ""}. Candidates: ${candidates.join(", ") || "none"}`,
			);
		}
		if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
			el.value = text;
			const ev = new InputEvent("input", { bubbles: true });
			el.dispatchEvent(ev);
			return null;
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
			const query = label || refId;
			const candidates = query ? findCandidateLabels(query) : [];
			throw new Error(
				`Element not found${query ? ` by label: "${query}"` : ""}. Candidates: ${candidates.join(", ") || "none"}`,
			);
		}
		if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
			el.value += text;
			const ev = new InputEvent("input", { bubbles: true });
			el.dispatchEvent(ev);
			return null;
		}
		throw new Error("Element is not an input");
	},

	press: (params) => {
		const key = getStringParam(params, "key");
		const evDown = new KeyboardEvent("keydown", { key, bubbles: true });
		document.dispatchEvent(evDown);
		const evUp = new KeyboardEvent("keyup", { key, bubbles: true });
		document.dispatchEvent(evUp);
		return null;
	},

	select: (params) => {
		const refId = getStringParam(params, "refId");
		const value = getStringParam(params, "value");
		const el = refId ? getElementByRefId(refId) : null;
		if (!el) throw new Error(`Element ${refId} not found`);
		if (el instanceof HTMLSelectElement) {
			el.value = value;
			return null;
		}
		throw new Error("Element is not a select");
	},

	check: (params) => {
		const refId = getStringParam(params, "refId");
		const checked = (() => {
			const obj = asRecord(params);
			return typeof obj.checked === "boolean" ? obj.checked : true;
		})();
		const el = refId ? getElementByRefId(refId) : null;
		if (!el) throw new Error(`Element ${refId} not found`);
		if (el instanceof HTMLInputElement && el.type === "checkbox") {
			el.checked = checked;
			return null;
		}
		throw new Error("Element is not a checkbox");
	},

	hover: (params) => {
		const refId = getStringParam(params, "refId");
		const el = refId ? getElementByRefId(refId) : null;
		if (!el) throw new Error(`Element ${refId} not found`);
		const ev = new MouseEvent("mouseenter", { bubbles: true });
		el.dispatchEvent(ev);
		return null;
	},

	unhover: () => {
		const ev = new MouseEvent("mouseleave", { bubbles: true });
		document.body.dispatchEvent(ev);
		return null;
	},

	scroll: (params) => {
		const obj = asRecord(params);
		const direction = (obj.direction as string) ?? "down";
		const amount = typeof obj.amount === "number" ? obj.amount : 300;
		window.scrollBy({
			top: direction === "down" ? amount : -amount,
			behavior: "smooth",
		});
		return true;
	},

	dblclick: (params) => {
		const refId = getStringParam(params, "refId");
		const el = refId ? getElementByRefId(refId) : null;
		if (!el) throw new Error(`Element ${refId} not found`);
		const ev = new MouseEvent("dblclick", { bubbles: true });
		el.dispatchEvent(ev);
		return null;
	},

	forward: () => {
		window.history.forward();
		return true;
	},

	reload: () => {
		window.location.reload();
		return true;
	},

	scrollTo: (params) => {
		const refId = getStringParam(params, "refId");
		const x = getNumberParam(params, "x", 0);
		const y = getNumberParam(params, "y", 0);
		if (refId) {
			const el = getElementByRefId(refId);
			if (el) {
				el.scrollIntoView({ behavior: "smooth" });
				return true;
			}
			throw new Error(`Element ${refId} not found`);
		}
		window.scrollTo({ top: y, left: x, behavior: "smooth" });
		return true;
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
		return true;
	},

	url: () => window.location.href,

	title: () => document.title,

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
