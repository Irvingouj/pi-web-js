import type { InlineSnapshotNode } from "./collect-inline-snapshot.js";

export type SnapshotRole =
	| "button"
	| "link"
	| "textbox"
	| "checkbox"
	| "radio"
	| "combobox"
	| "img"
	| "heading"
	| "listitem"
	| "list"
	| "table"
	| "row"
	| "cell"
	| "navigation"
	| "main"
	| "article"
	| "region"
	| "complementary"
	| "form"
	| "dialog"
	| "figure"
	| "caption"
	| "generic";

export type SnapshotTag =
	| "a"
	| "button"
	| "input"
	| "textarea"
	| "select"
	| "img"
	| "h1"
	| "h2"
	| "h3"
	| "h4"
	| "h5"
	| "h6"
	| "ul"
	| "ol"
	| "li"
	| "table"
	| "tr"
	| "td"
	| "th"
	| "nav"
	| "main"
	| "article"
	| "section"
	| "aside"
	| "form"
	| "dialog"
	| "figure"
	| "figcaption"
	| "div"
	| "span"
	| "p"
	| "label"
	| "details"
	| "summary"
	| "svg"
	| "iframe";

export type SnapshotFilter = {
	role?: SnapshotRole | SnapshotRole[];
	tag?: SnapshotTag | SnapshotTag[];
	text?: string | RegExp;
	name?: string | RegExp;
	interactiveOnly?: boolean;
	href?: string | RegExp;
	src?: string | RegExp;
	limit?: number;
};

const INTERACTIVE_ROLES = new Set([
	"button",
	"link",
	"textbox",
	"checkbox",
	"radio",
	"combobox",
	"searchbox",
	"switch",
	"menuitem",
	"tab",
	"treeitem",
]);

const INTERACTIVE_TAGS = new Set([
	"a",
	"button",
	"input",
	"textarea",
	"select",
	"details",
	"summary",
]);

type StringMatcher = (value: string) => boolean;

function toMatcher(pattern: string | RegExp): StringMatcher {
	if (pattern instanceof RegExp) return (v) => pattern.test(v);
	if (typeof pattern !== "string") return () => false;
	const lower = pattern.toLowerCase();
	return (v) => v.toLowerCase().includes(lower);
}

function toSet<T extends string>(value: T | T[]): Set<string> {
	if (Array.isArray(value))
		return new Set(
			value
				.filter((s) => typeof s === "string")
				.map((s) => (s as string).toLowerCase()),
		);
	if (typeof value !== "string") return new Set();
	return new Set([value.toLowerCase()]);
}

export function filterNodes(
	nodes: InlineSnapshotNode[],
	filter: SnapshotFilter,
): InlineSnapshotNode[] {
	let result = nodes;

	if (filter.role) {
		const roles = toSet(filter.role);
		result = result.filter((n) => roles.has(n.role.toLowerCase()));
	}

	if (filter.tag) {
		const tags = toSet(filter.tag);
		result = result.filter((n) => tags.has(n.tag.toLowerCase()));
	}

	if (filter.text) {
		const m = toMatcher(filter.text);
		result = result.filter((n) => n.text !== undefined && m(n.text));
	}

	if (filter.name) {
		const m = toMatcher(filter.name);
		result = result.filter((n) => n.name !== undefined && m(n.name));
	}

	if (filter.href) {
		const m = toMatcher(filter.href);
		result = result.filter((n) => n.href !== undefined && m(n.href));
	}

	if (filter.src) {
		const m = toMatcher(filter.src);
		result = result.filter((n) => n.src !== undefined && m(n.src));
	}

	if (filter.interactiveOnly) {
		result = result.filter(
			(n) =>
				INTERACTIVE_ROLES.has(n.role.toLowerCase()) ||
				INTERACTIVE_TAGS.has(n.tag.toLowerCase()),
		);
	}

	if (filter.limit !== undefined && filter.limit > 0) {
		result = result.slice(0, filter.limit);
	}

	return result;
}
