/// <reference types="chrome" />
export function asRecord(params: unknown): Record<string, unknown> {
	return typeof params === "object" && params !== null && !Array.isArray(params)
		? (params as Record<string, unknown>)
		: {};
}

function toTabId(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "bigint") {
		const asNumber = Number(value);
		return Number.isSafeInteger(asNumber) ? asNumber : null;
	}
	return null;
}

export function extractTabId(params: unknown): number | null {
	if (Array.isArray(params)) {
		const first = params[0];
		const fromScalar = toTabId(first);
		if (fromScalar !== null) return fromScalar;
		const firstObj = asRecord(first);
		return (
			toTabId(firstObj.id) ??
			toTabId(firstObj.tabId) ??
			toTabId(firstObj.tab_id)
		);
	}
	const fromScalar = toTabId(params);
	if (fromScalar !== null) return fromScalar;
	const obj = asRecord(params);
	return toTabId(obj.id) ?? toTabId(obj.tabId) ?? toTabId(obj.tab_id);
}
