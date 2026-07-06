/**
 * Shared node enrichers — the single source of truth for form/url/dropdown/
 * clickability/post/permalink/image metadata across snapshot, dom, and find.
 *
 * All three surfaces call `enrichNode()` so the fields they emit stay aligned
 * by construction (no per-surface drift). This module owns ONLY metadata
 * enrichment; DOM traversal, capacity/mutation guards, and response shape
 * stay in `dom-pipeline.ts`.
 *
 * Adding a new enriched field: add a private `enrichX` function below, call it
 * from `enrichNode`, and declare the field on `PipelineNode` (in
 * `dom-pipeline.ts`) plus the relevant zod schema (`returns.ts`).
 */

import { assessClickability } from "../cross/clickability.js";
import type { PipelineNode } from "./dom-pipeline.js";
import {
	enrichFormNode,
	isProbablyClickable,
	isReachableClickTarget,
	isValidationProxyInput,
	resolveAbsoluteUrl,
	resolveContainerRefId,
	resolvePermalinkLink,
} from "./snapshot-dom.js";

// ---------------------------------------------------------------------------
// Public entry — applied to a base node for all three surfaces.
// ---------------------------------------------------------------------------

export function enrichNode(el: Element, node: PipelineNode): void {
	enrichFormFields(el, node);
	enrichValidationProxy(el, node);
	enrichDropdown(el, node);
	enrichClickAction(el, node);
	enrichLink(el, node);
	enrichImage(el, node);
	enrichInput(el, node);
	enrichContainerLink(el, node);
	enrichPostId(el, node);
	enrichPermalink(el, node);
	enrichChildImages(el, node);
}

// ---------------------------------------------------------------------------
// Field-group enrichers (private). Order matters only when a later enricher
// reads a field set by an earlier one (e.g. enrichClickAction checks
// node.controlType set by enrichDropdown/enrichValidationProxy).
// ---------------------------------------------------------------------------

function enrichFormFields(el: Element, node: PipelineNode): void {
	enrichFormNode(el, node);
}

function enrichValidationProxy(el: Element, node: PipelineNode): void {
	if (!isValidationProxyInput(el)) return;
	node.controlType = "validation-proxy";
	node.actionable = false;
	const forControl = el
		.closest('[role="combobox"]')
		?.getAttribute("data-ref-id");
	if (forControl) node.forControl = forControl;
}

function enrichDropdown(el: Element, node: PipelineNode): void {
	if (node.controlType === "validation-proxy") return;
	if (node.role !== "combobox" && node.tag !== "select") return;
	node.controlType = "dropdown";
	node.recommendedAction = "select_option";
	node.controls =
		el.getAttribute("aria-controls") ||
		el.getAttribute("aria-owns") ||
		undefined;
	const expanded = el.getAttribute("aria-expanded");
	node.expanded =
		expanded === "true" ? true : expanded === "false" ? false : undefined;
}

function enrichClickAction(el: Element, node: PipelineNode): void {
	if (node.controlType) return;
	if (!isProbablyClickable(el)) return;
	if (
		el instanceof HTMLInputElement ||
		el instanceof HTMLTextAreaElement ||
		el instanceof HTMLSelectElement
	) {
		return;
	}
	if (!isReachableClickTarget(el)) return;
	node.actionable = true;
	node.recommendedAction = "click";
	node.confidence = assessClickability(el).confidence;
}

function enrichLink(el: Element, node: PipelineNode): void {
	if (node.tag !== "a") return;
	node.href = resolveAbsoluteUrl(el.getAttribute("href"));
}

function enrichImage(el: Element, node: PipelineNode): void {
	if (node.tag !== "img") return;
	node.src = resolveAbsoluteUrl(el.getAttribute("src"));
	node.alt = el.getAttribute("alt") || "";
}

function enrichInput(el: Element, node: PipelineNode): void {
	if (node.tag !== "input") return;
	const inputEl = el as HTMLInputElement;
	node.title = el.getAttribute("title") || undefined;
	if (inputEl.type === "file") {
		node.accept = inputEl.getAttribute("accept") || undefined;
		node.filesCount = inputEl.files?.length ?? 0;
	}
}

function enrichContainerLink(el: Element, node: PipelineNode): void {
	if (node.tag !== "img" && node.tag !== "a") return;
	node.parentRefId = resolveContainerRefId(el) || node.parentRefId;
}

function enrichPostId(el: Element, node: PipelineNode): void {
	node.postId = el.getAttribute("data-post-id") || undefined;
}

function enrichPermalink(el: Element, node: PipelineNode): void {
	if (node.tag === "a") return;
	const permalinkLink = resolvePermalinkLink(el);
	if (permalinkLink)
		node.permalink = resolveAbsoluteUrl(permalinkLink.getAttribute("href"));
}

function enrichChildImages(el: Element, node: PipelineNode): void {
	if (node.tag === "img") return;
	const urls = Array.from(el.querySelectorAll("img"))
		.map((img) => resolveAbsoluteUrl(img.getAttribute("src")))
		.filter((u): u is string => !!u);
	if (urls.length > 0) node.imageUrls = urls;
}
