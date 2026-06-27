import type { StaleRefCandidate } from "../shared/cross/agent-errors.js";
import { collectInlineSnapshot as inlineSnapshot } from "../shared/cross/collect-inline-snapshot.js";
import { encodeFetchResponse } from "../shared/cross/fetch-response.js";
import type {
	FetchParams,
	PageAppendParams,
	PageCheckParams,
	PageCheckRadioParams,
	PageClickParams,
	PageDblClickParams,
	PageDomParams,
	PageExtractParams,
	PageFillParams,
	PageFindParams,
	PageHoverParams,
	PagePressParams,
	PageScrollParams,
	PageScrollToParams,
	PageSelectOptionParams,
	PageSelectParams,
	PageSetFilesParams,
	PageSnapshotQueryParams,
	PageSubmitParams,
	PageTypeParams,
	PageWaitForParams,
} from "../shared/cross/generated.js";
import {
	labelNotFoundError,
	notInteractableError,
	observationRequiredError,
	throwStructuredAgentError,
} from "../shared/cross/normalize-agent-error.js";
import type { SnapshotFilter } from "../shared/cross/snapshot-filter.js";
import { filterNodes } from "../shared/cross/snapshot-filter.js";
import { allocateRefId, syncRefIdCounterFromDom } from "../shared/cs/ref-id.js";
import {
	getAccessibleName,
	getAccessibleRole,
	isSelfOrAncestorHidden,
	readFormFields,
	resolveAbsoluteUrl,
	resolveContainerRefId,
} from "../shared/cs/snapshot-dom.js";
import { assertFillEffect, makeActionResult } from "./action-result.js";
import type { DomNode } from "./dom-tree.js";
import { buildDomNode } from "./dom-tree.js";
import {
	asRecord,
	assertInteractable,
	findElementByLabel,
	getElementByRefId,
	resolveTargetRaw,
	throwElementNotFound,
} from "./dom-utils.js";
import {
	assertSetFilesEffect,
	fileFromBytes,
	fileFromUrl,
	parseResolvedFiles,
} from "./file-resolution.js";
import { invalidFormControls } from "./form-validation.js";
import { activateAndResolveListboxRoots } from "./listbox.js";
import { logger } from "./logger.js";
import {
	currentObservationId,
	grantFromInlineSnapshot,
	grantObservation,
	hasActiveObservation,
	invalidateLease,
	requireTarget,
	requireTargetByLabel,
} from "./observation-lease.js";

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

function resolveMaxNodes(params: unknown): number {
	const obj = asRecord(params);
	const opts = asRecord(obj.options ?? obj);
	const raw = opts.max_nodes ?? obj.max_nodes;
	let maxNodes = 10_000;
	if (typeof raw === "number" && Number.isFinite(raw)) {
		maxNodes = raw;
	} else if (typeof raw === "bigint") {
		maxNodes = Number(raw);
	}
	return Math.max(1, Math.min(50_000, Math.floor(maxNodes)));
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

function scrollDelta(
	direction: string,
	amount: number,
): { top: number; left: number } {
	return {
		top: direction === "down" ? amount : direction === "up" ? -amount : 0,
		left: direction === "right" ? amount : direction === "left" ? -amount : 0,
	};
}

function isScrollableStyle(
	style: CSSStyleDeclaration,
	axis: "x" | "y",
): boolean {
	const overflow = axis === "y" ? style.overflowY : style.overflowX;
	return overflow === "auto" || overflow === "scroll" || overflow === "overlay";
}

function canScrollElement(el: HTMLElement, direction: string): boolean {
	const style = window.getComputedStyle(el);
	if (direction === "up" || direction === "down") {
		if (!isScrollableStyle(style, "y")) return false;
		if (el.scrollHeight <= el.clientHeight) return false;
		return direction === "down"
			? el.scrollTop < el.scrollHeight - el.clientHeight
			: el.scrollTop > 0;
	}
	if (!isScrollableStyle(style, "x")) return false;
	if (el.scrollWidth <= el.clientWidth) return false;
	return direction === "right"
		? el.scrollLeft < el.scrollWidth - el.clientWidth
		: el.scrollLeft > 0;
}

function visibleArea(el: HTMLElement): number {
	const rect = el.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return 0;
	const width =
		Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
	const height =
		Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
	return Math.max(0, width) * Math.max(0, height);
}

function findScrollTarget(direction: string): HTMLElement | null {
	const active = document.activeElement;
	if (active instanceof HTMLElement && canScrollElement(active, direction)) {
		return active;
	}

	let best: HTMLElement | null = null;
	let bestArea = 0;
	for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
		if (el === document.body || el === document.documentElement) continue;
		if (!canScrollElement(el, direction)) continue;
		const area = visibleArea(el);
		if (area > bestArea) {
			best = el;
			bestArea = area;
		}
	}
	return best;
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

export const handlers = {
	click: (params: PageClickParams) => {
		const refId = params.refId;
		const label = params.label;
		let el: Element | null;
		if (refId) {
			el = requireTarget(refId, "click");
		} else if (label) {
			el = requireTargetByLabel(label, "click");
		} else {
			throwElementNotFound(refId, label, true);
		}
		assertInteractable(el, "click");
		(el as HTMLElement).click();
		return makeActionResult("click", el, {
			observationId: currentObservationId(),
			dispatched: true,
			verification: "required",
		});
	},
	fill: (params: PageFillParams) => {
		const refId = params.refId;
		const label = params.label;
		const value = params.value;
		let el: Element | null;
		if (refId) {
			el = requireTarget(refId, "fill");
		} else if (label) {
			el = findElementByLabel(label);
			if (!el) throwElementNotFound(refId, label, true);
		} else {
			throwElementNotFound(refId, label, true);
		}
		assertInteractable(el, "fill");
		if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
			el.value = value;
			const ev = new InputEvent("input", { bubbles: true });
			el.dispatchEvent(ev);
			const resolvedRefId = refId || el.getAttribute("data-ref-id") || "";
			assertFillEffect("fill", el, resolvedRefId, value);
			return makeActionResult("fill", el, {
				value: el.value,
				observationId: currentObservationId(),
				dispatched: true,
				verification: "required",
			});
		}
		if (el instanceof HTMLElement && el.isContentEditable) {
			el.innerText = value;
			const ev = new InputEvent("input", {
				bubbles: true,
				inputType: "insertText",
				data: value,
			});
			el.dispatchEvent(ev);
			const _resolvedRefId = refId || el.getAttribute("data-ref-id") || "";
			return makeActionResult("fill", el, {
				value: el.innerText,
				observationId: currentObservationId(),
				dispatched: true,
				verification: "required",
			});
		}
		throw new Error("Element is not an input or contenteditable");
	},

	set_files: async (params: PageSetFilesParams) => {
		const files = parseResolvedFiles(params);
		const rawEl = resolveTargetRaw(params.refId, params.label);
		let el: HTMLInputElement;
		// Descend: if the resolved target isn't itself a file input, search its
		// subtree, then the wrapping <label>'s subtree, then a label[for] target.
		if (rawEl instanceof HTMLInputElement && rawEl.type === "file") {
			el = rawEl;
		} else {
			const fromSubtree = rawEl.querySelector('input[type="file"]');
			const fromWrapperLabel = rawEl
				.closest("label")
				?.querySelector('input[type="file"]');
			const forAttr = rawEl.getAttribute("for");
			const fromForLabel = forAttr
				? document.getElementById(forAttr)?.querySelector('input[type="file"]')
				: null;
			const maybeInput = (fromSubtree ??
				fromWrapperLabel ??
				fromForLabel) as HTMLInputElement | null;
			if (!maybeInput) {
				const resolvedRefId = params.refId ?? "";
				throwStructuredAgentError(
					notInteractableError("setFiles", resolvedRefId, {
						reason: "not_file_input",
					}),
				);
			}
			el = maybeInput;
		}
		// file inputs are hidden by convention (React/MUI/Chakra/dropzone) —
		// skip assertInteractable; visibility is not required to set .files.
		const dt = new DataTransfer();
		const fileNames: string[] = [];
		for (const payload of files) {
			const file =
				payload.kind === "bytes"
					? fileFromBytes(payload)
					: await fileFromUrl(payload);
			dt.items.add(file);
			fileNames.push(file.name);
		}
		el.files = dt.files;
		el.dispatchEvent(new Event("change", { bubbles: true }));
		const resolvedRefId = params.refId || el.getAttribute("data-ref-id") || "";
		assertSetFilesEffect(el, resolvedRefId, fileNames);
		return makeActionResult("setFiles", el, {
			fileCount: fileNames.length,
			fileNames,
		});
	},

	type: (params: PageTypeParams) => {
		const refId = params.refId;
		const label = params.label;
		const text = params.text;
		const el = resolveTargetRaw(refId, label);
		assertInteractable(el, "type");
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

	append: (params: PageAppendParams) => {
		const refId = params.refId;
		const label = params.label;
		const text = params.text;
		const el = resolveTargetRaw(refId, label);
		assertInteractable(el, "append");
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

	press: (params: PagePressParams) => {
		if (!hasActiveObservation()) {
			throwStructuredAgentError(observationRequiredError("press"));
		}
		const key = params.key;
		const refId = params.refId;
		const label = params.label;
		let target: EventTarget = document;
		let el: Element | null = null;
		if (refId || label) {
			if (refId) {
				el = requireTarget(refId, "press");
			} else if (label) {
				el = findElementByLabel(label);
				if (!el) throwElementNotFound(refId, label, true);
			}
			assertInteractable(el as Element, "press");
			target = el as Element;
		}
		const evDown = new KeyboardEvent("keydown", { key, bubbles: true });
		target.dispatchEvent(evDown);
		const evUp = new KeyboardEvent("keyup", { key, bubbles: true });
		target.dispatchEvent(evUp);
		return makeActionResult("press", el, {
			key,
			observationId: currentObservationId(),
			dispatched: true,
			verification: "required",
		});
	},

	select: (params: PageSelectParams) => {
		const refId = params.refId;
		const label = params.label;
		const value = params.value;
		const el = resolveTargetRaw(refId, label);
		assertInteractable(el, "select");
		if (el instanceof HTMLSelectElement) {
			if (Array.isArray(value)) {
				const wanted = new Set(value);
				let count = 0;
				for (const opt of Array.from(el.options)) {
					const isOn = wanted.has(opt.value);
					opt.selected = isOn;
					if (isOn) count += 1;
				}
				if (!el.multiple && count > 1) {
					throwStructuredAgentError(
						notInteractableError("select", refId ?? "", {
							reason: "single_select_multiple_values",
						}),
					);
				}
				el.dispatchEvent(new Event("change", { bubbles: true }));
				const selected = Array.from(el.options)
					.filter((o) => o.selected)
					.map((o) => o.value);
				return makeActionResult("select", el, { value: selected });
			}
			el.value = value;
			el.dispatchEvent(new Event("change", { bubbles: true }));
			return makeActionResult("select", el, { value: el.value });
		}
		throw new Error("Element is not a select");
	},

	select_option: async (params: PageSelectOptionParams) => {
		const value = params.value;
		const el = resolveTargetRaw(params.refId, params.label);
		assertInteractable(el, "select_option");
		if (el instanceof HTMLSelectElement) {
			const opt =
				Array.from(el.options).find((o) => (o.text || "").trim() === value) ||
				Array.from(el.options).find(
					(o) => (o.text || "").trim().toLowerCase() === value.toLowerCase(),
				);
			if (!opt) {
				const candidates: StaleRefCandidate[] = Array.from(el.options).map(
					(o, i) => ({
						refId: `opt${i}`,
						name: (o.text || "").trim() || undefined,
					}),
				);
				throwStructuredAgentError(labelNotFoundError(value, candidates));
			}
			el.value = opt.value;
			el.dispatchEvent(new Event("change", { bubbles: true }));
			return makeActionResult("select_option", el, {
				value: opt.value,
				selectedText: (opt.text || "").trim(),
				verification: "required",
			});
		}
		const control = el as HTMLElement;
		const {
			roots,
			searchedIds,
			allListboxes,
			ariaControlsBefore,
			ariaControlsAfter,
		} = await activateAndResolveListboxRoots(control);
		const options = [
			...new Set(
				roots.flatMap((root) =>
					Array.from(root.querySelectorAll<HTMLElement>('[role="option"]')),
				),
			),
		];
		const normalizedValue = value.trim().toLowerCase();
		const match =
			options.find((o) => (o.textContent || "").trim() === value.trim()) ||
			options.find(
				(o) => (o.textContent || "").trim().toLowerCase() === normalizedValue,
			);
		if (!match) {
			const candidates: StaleRefCandidate[] = options.map((o, i) => ({
				refId: o.getAttribute("data-ref-id") || `opt${i}`,
				name: (o.textContent || "").trim() || undefined,
			}));
			const ignoredIds = allListboxes
				.filter((lb) => !roots.includes(lb) && !isSelfOrAncestorHidden(lb))
				.map((r) => r.id)
				.filter(Boolean);
			throwStructuredAgentError(
				labelNotFoundError(value, candidates, {
					searchedIds,
					ignoredIds,
					targetRefId: control.getAttribute("data-ref-id") || undefined,
					targetName:
						control.getAttribute("aria-label") ||
						control.getAttribute("data-ref-id") ||
						"",
					ariaControlsBefore,
					ariaControlsAfter,
					isDropdown: true,
				}),
			);
		}
		for (const evName of ["mouseover", "mousedown", "mouseup"]) {
			match.dispatchEvent(
				new MouseEvent(evName, { bubbles: true, cancelable: true }),
			);
		}
		match.click();
		return makeActionResult("select_option", el, {
			value: el instanceof HTMLInputElement ? el.value : value,
			selectedText: (match.textContent || "").trim(),
			verification: "required",
		});
	},

	check: (params: PageCheckParams) => {
		const refId = params.refId;
		const label = params.label;
		const checked = params.checked ?? true;
		const el = resolveTargetRaw(refId, label);
		assertInteractable(el, "check");
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

	check_radio: (params: PageCheckRadioParams) => {
		const name = params.name;
		const value = params.value;
		const selector = `input[type="radio"][name="${CSS.escape(name)}"]`;
		const radios = Array.from(
			document.querySelectorAll<HTMLInputElement>(selector),
		);
		if (radios.length === 0) {
			throwStructuredAgentError(
				labelNotFoundError(`radio group "${name}"`, []),
			);
		}
		const target = radios.find((r) => r.value === value);
		if (!target) {
			const candidates: StaleRefCandidate[] = radios.map((r, i) => ({
				refId: `radio${i}`,
				name: r.value || undefined,
			}));
			throwStructuredAgentError(
				labelNotFoundError(
					`radio value "${value}" in group "${name}"`,
					candidates,
				),
			);
		}
		assertInteractable(target, "check_radio");
		target.checked = true;
		target.dispatchEvent(new Event("change", { bubbles: true }));
		return makeActionResult("check_radio", target, {
			checked: target.checked,
			value: target.value,
		});
	},
	hover: (params: PageHoverParams) => {
		const refId = params.refId;
		const label = params.label;
		const el = resolveTargetRaw(refId, label);
		assertInteractable(el, "hover");
		const ev = new MouseEvent("mouseenter", { bubbles: true });
		el.dispatchEvent(ev);
		return makeActionResult("hover", el);
	},

	unhover: () => {
		const ev = new MouseEvent("mouseleave", { bubbles: true });
		document.body.dispatchEvent(ev);
		return makeActionResult("unhover", null);
	},

	submit: (params: PageSubmitParams) => {
		const refId = params.refId;
		const label = params.label;
		const el = resolveTargetRaw(refId, label);
		let form: HTMLFormElement | null = null;
		if (el instanceof HTMLFormElement) {
			form = el;
		} else if (el.closest("form")) {
			form = el.closest("form");
		}
		if (!form) {
			throwStructuredAgentError(
				notInteractableError("submit", refId ?? "", {
					reason: "not_form",
				}),
			);
		}
		if (typeof form.requestSubmit === "function") {
			form.requestSubmit();
		} else {
			form.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		}
		const valid = form.checkValidity();
		return makeActionResult("submit", form, {
			dispatched: true,
			valid,
			invalid: !valid,
			invalidControls: invalidFormControls(form),
			observationId: currentObservationId(),
			verification: "required",
		});
	},

	scroll: (params: PageScrollParams) => {
		invalidateLease();
		const direction = params.direction;
		const amount = params.amount;
		const { top, left } = scrollDelta(direction, amount);
		const target = findScrollTarget(direction);
		if (target) {
			target.scrollBy({ top, left, behavior: "smooth" });
			return makeActionResult("scroll", target, { direction, amount });
		}
		window.scrollBy({ top, left, behavior: "smooth" });
		return makeActionResult("scroll", null, { direction, amount });
	},

	dblclick: (params: PageDblClickParams) => {
		const refId = params.refId;
		const label = params.label;
		const el = resolveTargetRaw(refId, label);
		const target = el as HTMLElement;
		target.click();
		target.click();
		target.dispatchEvent(
			new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
		);
		return makeActionResult("dblclick", el);
	},

	forward: () => {
		invalidateLease();
		window.history.forward();
		return makeActionResult("forward", null);
	},

	scroll_to: (params: PageScrollToParams) => {
		const refId = params.refId;
		const label = params.label;
		const x = params.x ?? 0;
		const y = params.y ?? 0;
		if (refId || label) {
			const el = resolveTargetRaw(refId, label);
			el.scrollIntoView({ behavior: "smooth" });
			return makeActionResult("scroll_to", el);
		}
		window.scrollTo({ top: y, left: x, behavior: "smooth" });
		return makeActionResult("scroll_to", null, { amount: y });
	},

	evaluate: (params) => {
		const code = resolveEvaluateCode(params);
		return new Function(code)();
	},
	back: () => {
		invalidateLease();
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
				details: { cause: "document.body is null" },
				recovery: ["Wait for the page to load fully before taking a snapshot."],
			});
		}
		const maxNodes = resolveMaxNodes(params);
		logger.debug("snapshot", { maxNodes, hasBody: !!document.body });
		const granted = grantFromInlineSnapshot(maxNodes);
		return granted;
	},

	snapshot_text: async (params) => {
		if (!document.body) {
			throwStructuredAgentError({
				message: "Document body not available for snapshot",
				code: "E_SNAPSHOT",
				category: "resource",
				details: { cause: "document.body is null" },
				recovery: ["Wait for the page to load fully before taking a snapshot."],
			});
		}
		const maxNodes = resolveMaxNodes(params);
		const r = inlineSnapshot(maxNodes);
		return r.text;
	},

	snapshot_query: async (params: PageSnapshotQueryParams) => {
		if (!document.body) {
			throwStructuredAgentError({
				message: "Document body not available for snapshot",
				code: "E_SNAPSHOT",
				category: "resource",
				details: { cause: "document.body is null" },
				recovery: ["Wait for the page to load fully before taking a snapshot."],
			});
		}
		const maxNodes = resolveMaxNodes(params);
		const r = inlineSnapshot(maxNodes);
		const filter = (params.filter ?? {}) as SnapshotFilter;
		const filtered = filterNodes(r.nodes, filter);
		return {
			text: "",
			nodes: filtered,
			url: r.url,
			title: r.title,
			viewport: r.viewport,
		};
	},

	find: (params: PageFindParams) => {
		syncRefIdCounterFromDom();
		const selector = params.selector;
		const elements = Array.from(document.querySelectorAll(selector));
		const observed: Array<{ refId: string; element: Element }> = [];
		const nodes = elements.map((el) => {
			const refId = allocateRefId(el);
			observed.push({ refId, element: el });
			const role = getAccessibleRole(el);
			const name = getAccessibleName(el);
			const node: Record<string, unknown> = {
				tag: el.tagName.toLowerCase(),
				refId,
				role,
				text: el.textContent?.slice(0, 100) || "",
				...readFormFields(el),
			};
			if (name) node.name = name;

			const tag = el.tagName.toLowerCase();
			if (tag === "a") {
				const href = resolveAbsoluteUrl(el.getAttribute("href"));
				if (href) node.href = href;
			}
			if (tag === "img") {
				const src = resolveAbsoluteUrl(el.getAttribute("src"));
				if (src) node.src = src;
				node.alt = el.getAttribute("alt") || "";
			}
			if (tag === "input") {
				const title = el.getAttribute("title");
				if (title) node.title = title;
			}

			if (tag === "img" || tag === "a") {
				const containerRefId = resolveContainerRefId(el);
				if (containerRefId) {
					node.parentRefId = containerRefId;
				}
			}

			return node;
		});
		grantObservation(observed);
		return nodes;
	},

	dom: (params: PageDomParams) => {
		syncRefIdCounterFromDom();
		const selector = params.selector;
		const depth = params.depth ?? 2;
		const includeHidden = params.includeHidden ?? true;
		const roots = Array.from(document.querySelectorAll(selector));
		const observed: Array<{ refId: string; element: Element }> = [];
		const nodes = roots
			.map((el) => buildDomNode(el, depth, includeHidden, observed))
			.filter((n): n is DomNode => n !== null);
		grantObservation(observed);
		return { nodes, url: window.location.href, title: document.title };
	},

	wait_for: async (params: PageWaitForParams, signal) => {
		const selector = params.selector;
		const timeoutMs = Number(params.timeout);
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

	extract: (params: PageExtractParams) => {
		const fieldList = params.fields;
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

	fetch: async (params: FetchParams, signal) => {
		const url = params.url;
		if (!url) {
			throw new Error("fetch requires a url");
		}
		const method = params.method.toUpperCase();
		const headers = params.headers;
		const body = params.body;
		const timeout = Number(params.timeout);

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
			return encodeFetchResponse(resp);
		} finally {
			clearTimeout(timeoutId);
			signal?.removeEventListener("abort", onRelayAbort);
		}
	},
} as Record<string, (params: any, signal?: AbortSignal) => unknown>;
