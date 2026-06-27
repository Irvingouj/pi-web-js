/**
 * Combobox/listbox activation for `select_option`.
 *
 * Activates a combobox control (mouseover/mousedown/mouseup + click) and
 * resolves the listbox roots that belong to it, gathered from four sources:
 *
 * 1. linkedRoots    — elements referenced by the control's aria-controls / aria-owns.
 * 2. activatedRoots — listboxes that became visible or were created after activation.
 * 3. nearbyRoots    — listboxes nested inside the control element.
 * 4. selfRoot       — the control itself when its role is "listbox".
 *
 * Unrelated listboxes already visible before activation (e.g. a persistent
 * phone-country widget) are excluded.
 */
import { isSelfOrAncestorHidden } from "../shared/cs/snapshot-dom.js";

/** Stable signature of a listbox's options — option text only, ignoring
 *  attribute reordering, timestamps, and other non-content markup. */
function listboxOptionSignature(listbox: HTMLElement): string {
	return Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'))
		.map((o) => (o.textContent || "").trim())
		.join("\n");
}

type ListboxBefore = Map<HTMLElement, { hidden: boolean; sig: string }>;

const listboxes = () =>
	Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]'));

const uniqueElements = <T extends Element>(elements: T[]): T[] => [
	...new Set(elements),
];

const idRefs = (el: HTMLElement, attrs: string[]): string[] =>
	attrs
		.flatMap((attr) => (el.getAttribute(attr) || "").trim().split(/\s+/))
		.filter(Boolean);

const isListbox = (el: Element | null): el is HTMLElement =>
	el instanceof HTMLElement && el.getAttribute("role") === "listbox";

const isPopupTrigger = (button: HTMLElement): boolean => {
	const hasPopup = (button.getAttribute("aria-haspopup") || "")
		.toLowerCase()
		.includes("listbox");
	const controlsListbox = idRefs(button, ["aria-controls"]).some((id) =>
		isListbox(document.getElementById(id)),
	);
	const expands = button.hasAttribute("aria-expanded");
	const label = (
		button.getAttribute("aria-label") ||
		button.textContent ||
		""
	).toLowerCase();
	return (
		hasPopup ||
		controlsListbox ||
		expands ||
		/\b(open|show|toggle|expand|menu|options|flyout|dropdown)\b/.test(label)
	);
};

function findNearbyPopupTrigger(control: HTMLElement): HTMLElement | null {
	const scopes: Element[] = [];
	for (
		let scope = control.parentElement, depth = 0;
		scope && depth < 4;
		scope = scope.parentElement, depth++
	) {
		scopes.push(scope);
	}
	return (
		scopes
			.flatMap((scope) =>
				Array.from(scope.querySelectorAll<HTMLElement>("button")),
			)
			.find(
				(button) =>
					button !== control &&
					!isSelfOrAncestorHidden(button) &&
					isPopupTrigger(button),
			) || null
	);
}

const snapshotListboxes = (): ListboxBefore =>
	new Map(
		listboxes().map(
			(listbox) =>
				[
					listbox,
					{
						hidden: isSelfOrAncestorHidden(listbox),
						sig: listboxOptionSignature(listbox),
					},
				] as const,
		),
	);

const linkedListboxes = (control: HTMLElement): HTMLElement[] =>
	idRefs(control, ["aria-controls", "aria-owns"])
		.map((id) => document.getElementById(id))
		.filter(isListbox);

const activatedListboxes = (beforeMap: ListboxBefore): HTMLElement[] =>
	listboxes().filter((listbox) => {
		const before = beforeMap.get(listbox);
		if (isSelfOrAncestorHidden(listbox)) return false;
		if (!before) return true;
		if (before.hidden) return true;
		return listboxOptionSignature(listbox) !== before.sig;
	});

const nestedListboxes = (control: HTMLElement): HTMLElement[] =>
	Array.from(control.querySelectorAll<HTMLElement>('[role="listbox"]'));

const selfListbox = (control: HTMLElement): HTMLElement[] =>
	isListbox(control) ? [control] : [];

const activateElement = (target: HTMLElement): void => {
	for (const evName of ["mouseover", "mousedown", "mouseup"]) {
		target.dispatchEvent(
			new MouseEvent(evName, { bubbles: true, cancelable: true }),
		);
	}
	target.click();
};

const nextFrame = (): Promise<void> =>
	new Promise((resolve) => requestAnimationFrame(() => resolve()));

const resolveListboxRoots = (
	control: HTMLElement,
	beforeMap: ListboxBefore,
): { roots: HTMLElement[]; allListboxes: HTMLElement[] } => {
	const allListboxes = listboxes();
	return {
		allListboxes,
		roots: uniqueElements([
			...linkedListboxes(control),
			...activatedListboxes(beforeMap),
			...nestedListboxes(control),
			...selfListbox(control),
		]),
	};
};

// ponytail: bounded wait — React flushes within a microtask; one frame is
// enough for the common case, ~10 frames (~160ms@60Hz) covers a two-pass
// concurrent render or a CSS-transition-gated flyout without open-ended polling.
const waitForRoots = async (
	control: HTMLElement,
	beforeMap: ListboxBefore,
): Promise<{ roots: HTMLElement[]; allListboxes: HTMLElement[] }> => {
	let resolved = resolveListboxRoots(control, beforeMap);
	for (let i = 0; i < 10 && resolved.roots.length === 0; i++) {
		await nextFrame();
		resolved = resolveListboxRoots(control, beforeMap);
	}
	return resolved;
};

export async function activateAndResolveListboxRoots(control: HTMLElement): Promise<{
	roots: HTMLElement[];
	searchedIds: string[];
	allListboxes: HTMLElement[];
	ariaControlsBefore: string | null;
	ariaControlsAfter: string | null;
}> {
	const ariaControlsBefore = control.getAttribute("aria-controls");
	const beforeMap = snapshotListboxes();

	activateElement(control);
	let { roots, allListboxes } = await waitForRoots(control, beforeMap);
	if (roots.length === 0) {
		const trigger = findNearbyPopupTrigger(control);
		if (trigger) {
			activateElement(trigger);
			({ roots, allListboxes } = await waitForRoots(control, beforeMap));
		}
	}
	const ariaControlsAfter = control.getAttribute("aria-controls");
	const searchedIds = roots.map((r) => r.id).filter(Boolean);

	return {
		roots,
		searchedIds,
		allListboxes,
		ariaControlsBefore,
		ariaControlsAfter,
	};
}
