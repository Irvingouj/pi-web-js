/// <reference types="chrome" />
import { collectDocument, formatSnapshot, init as initDomSnapshot } from "@pi-oxide/dom-semantic-tree";
import type { TreeSnapshot } from "../../../shared/generated.js";
import type {
	DomFormatParams,
	DomSnapshotParams,
	DomSnapshotValue,
} from "../lib/types.js";
import type { AsyncResponse } from "../../../shared/tool-registry.js";
import { logger } from "../../../shared/logger.js";

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

// Self-contained snapshot builder injected into tabs via executeInTab
export function buildSnapshotInTab(maxNodesArg: unknown) {
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
	type DomNode = { refId: string; role: string; tag: string; name?: string };
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
			// Opaque element reference ID. Format 'e{N}' aligns with dom-semantic-tree and schema regex ^e\d+$.
			const refId = "e" + nextRefId++;
			el.setAttribute("data-ref-id", refId);
			const role = getAccessibleRole(el);
			const name = getAccessibleName(el);
			const node: DomNode = { refId, role, tag };
			if (name) node.name = name;
			nodes.push(node);
			const indent = "  ".repeat(depth);
			const parts: string[] = [`${indent}- ${role}`];
			if (name) parts.push(`"${name.replace(/"/g, '\\"')}"`);
			parts.push(`[${refId}]`);
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
