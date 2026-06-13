/** Monotonic refId allocator synced from existing DOM data-ref-id attributes. */

const REF_ID_PATTERN = /^e\d+$/;

let counter = 0;

export function syncRefIdCounterFromDom(): void {
	let max = 0;
	for (const el of document.querySelectorAll("[data-ref-id]")) {
		const id = el.getAttribute("data-ref-id");
		if (!id) continue;
		const num = parseInt(id.replace(/^e/, ""), 10);
		if (!Number.isNaN(num) && num > max) {
			max = num;
		}
	}
	counter = max;
}

export function allocateRefId(el: Element): string {
	const existing = el.getAttribute("data-ref-id");
	if (existing && REF_ID_PATTERN.test(existing)) return existing;
	const refId = `e${++counter}`;
	el.setAttribute("data-ref-id", refId);
	return refId;
}

/** @deprecated Use allocateRefId after syncRefIdCounterFromDom */
export function getNextRefId(): string {
	syncRefIdCounterFromDom();
	return `e${++counter}`;
}
