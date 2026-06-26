/**
 * Raw DOM tree introspection for the `dom` handler.
 *
 * Walks an element subtree to a bounded depth, emitting a serializable node
 * per element with tag/role/name/text/raw-attributes/form-state/hidden-reason.
 * Distinct from the inline-snapshot pipeline (`shared/collect-inline-snapshot`),
 * which produces a ref-id-annotated markdown rendering for agent consumption.
 */
import { allocateRefId } from "../shared/ref-id.js";
import {
	getAccessibleName,
	getAccessibleRole,
	getOwnVisibleText,
	isSelfOrAncestorHidden,
	readFormFields,
	resolveAbsoluteUrl,
} from "../shared/snapshot-dom.js";

export type DomNode = {
	refId?: string;
	tag: string;
	role?: string;
	name?: string;
	text?: string;
	attributes?: Record<string, string>;
	hidden?: boolean;
	hiddenReason?:
		| "display-none"
		| "visibility-hidden"
		| "aria-hidden"
		| "opacity-zero"
		| "hidden-attr"
		| "inert";
	value?: string;
	checked?: boolean;
	disabled?: boolean;
	readOnly?: boolean;
	href?: string;
	src?: string;
	alt?: string;
	accept?: string;
	filesCount?: number;
	children?: DomNode[];
};

function hiddenReasonFor(
	el: Element,
):
	| "display-none"
	| "visibility-hidden"
	| "aria-hidden"
	| "opacity-zero"
	| "hidden-attr"
	| "inert"
	| undefined {
	if ((el as HTMLElement).hidden) return "hidden-attr";
	if (el.getAttribute("aria-hidden") === "true") return "aria-hidden";
	if ((el as HTMLElement).inert) return "inert";
	const style = window.getComputedStyle(el);
	if (style.display === "none") return "display-none";
	if (style.visibility === "hidden") return "visibility-hidden";
	if (style.opacity === "0") return "opacity-zero";
	return undefined;
}

export function buildDomNode(
	el: Element,
	depth: number,
	includeHidden: boolean,
): DomNode | null {
	if (!includeHidden && isSelfOrAncestorHidden(el)) return null;
	const tag = el.tagName.toLowerCase();
	const node: DomNode = {
		tag,
		refId: allocateRefId(el),
		role: getAccessibleRole(el),
		name: getAccessibleName(el) || undefined,
		text: getOwnVisibleText(el, 100) || undefined,
	};
	// raw attributes
	const attrs: Record<string, string> = {};
	for (const attr of Array.from(el.attributes)) attrs[attr.name] = attr.value;
	if (Object.keys(attrs).length) node.attributes = attrs;
	const hr = hiddenReasonFor(el);
	if (hr) {
		node.hidden = true;
		node.hiddenReason = hr;
	}
	Object.assign(node, readFormFields(el));
	if (el instanceof HTMLInputElement && el.type === "file") {
		const accept = el.getAttribute("accept");
		if (accept) node.accept = accept;
		node.filesCount = el.files?.length ?? 0;
	}
	if (tag === "a") {
		const href = resolveAbsoluteUrl(el.getAttribute("href"));
		if (href) node.href = href;
	}
	if (tag === "img") {
		const src = resolveAbsoluteUrl(el.getAttribute("src"));
		if (src) node.src = src;
		node.alt = el.getAttribute("alt") || undefined;
	}
	if (depth > 0) {
		const kids: DomNode[] = [];
		for (const child of Array.from(el.children)) {
			const k = buildDomNode(child, depth - 1, includeHidden);
			if (k) kids.push(k);
		}
		if (kids.length) node.children = kids;
	}
	return node;
}
