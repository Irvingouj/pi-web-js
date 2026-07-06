/// <reference types="chrome" />

const MAX_PER_TAB = 300;
const MAX_GLOBAL = 1500;
const MAX_BODY_CHARS = 64_000;

const BACKEND_TYPES = new Set(["xmlhttprequest", "ping", "websocket"]);

export type NetworkRequestBody =
	| {
			kind: "formData";
			formData: Record<string, string[]>;
	  }
	| {
			kind: "raw";
			text: string;
			truncated: boolean;
			originalBytesKnown?: number;
	  }
	| {
			kind: "multipart";
			files: Array<{ name?: string; fileName?: string }>;
			omittedBytes: true;
			note: string;
	  };

export interface NetworkEntry {
	id: string;
	requestId: string;
	tabId: number;
	frameId?: number;
	parentFrameId?: number;
	url: string;
	method: string;
	type?: string;
	initiator?: string;
	documentUrl?: string;
	requestHeaders?: chrome.webRequest.HttpHeader[];
	responseHeaders?: chrome.webRequest.HttpHeader[];
	requestBody?: NetworkRequestBody;
	statusCode?: number;
	statusLine?: string;
	redirectUrl?: string;
	error?: string;
	startedAt: number;
	endedAt?: number;
	durationMs?: number;
}

type WebRequestBody = {
	formData?: Record<string, string[]>;
	raw?: Array<{ bytes?: ArrayBuffer; file?: string }>;
};

export type NetworkSummary = Omit<
	NetworkEntry,
	"requestHeaders" | "responseHeaders" | "requestBody"
> & {
	hasRequestHeaders: boolean;
	hasResponseHeaders: boolean;
	hasRequestBody: boolean;
	requestBodyKind?: NetworkRequestBody["kind"];
	requestBodyTruncated?: boolean;
	requestBodyOmittedBytes?: boolean;
};

const byTab = new Map<number, NetworkEntry[]>();
const byId = new Map<string, NetworkEntry>();
const activeByRequest = new Map<string, string>();
const globalOrder: string[] = [];
let nextId = 1;
let installed = false;

function isPageTab(details: { tabId?: number }): details is { tabId: number } {
	return typeof details.tabId === "number" && details.tabId >= 0;
}

function pushEntry(entry: NetworkEntry): void {
	const tabEntries = byTab.get(entry.tabId) ?? [];
	tabEntries.push(entry);
	byTab.set(entry.tabId, tabEntries);
	byId.set(entry.id, entry);
	activeByRequest.set(requestKey(entry.tabId, entry.requestId), entry.id);
	globalOrder.push(entry.id);
	trimTab(entry.tabId);
	trimGlobal();
}

function trimTab(tabId: number): void {
	const entries = byTab.get(tabId);
	if (!entries) return;
	while (entries.length > MAX_PER_TAB) {
		const removed = entries.shift();
		if (removed) removeEntryId(removed.id);
	}
	if (entries.length === 0) byTab.delete(tabId);
}

function removeEntryId(id: string): void {
	const entry = byId.get(id);
	byId.delete(id);
	if (
		entry &&
		activeByRequest.get(requestKey(entry.tabId, entry.requestId)) === id
	) {
		activeByRequest.delete(requestKey(entry.tabId, entry.requestId));
	}
	const idx = globalOrder.indexOf(id);
	if (idx >= 0) globalOrder.splice(idx, 1);
}

function requestKey(tabId: number, requestId: string): string {
	return `${tabId}:${requestId}`;
}

function trimGlobal(): void {
	while (globalOrder.length > MAX_GLOBAL) {
		const id = globalOrder.shift();
		if (!id) continue;
		const entry = byId.get(id);
		if (!entry) continue;
		byId.delete(id);
		const tabEntries = byTab.get(entry.tabId);
		if (tabEntries) {
			const idx = tabEntries.findIndex((e) => e.id === id);
			if (idx >= 0) tabEntries.splice(idx, 1);
			if (tabEntries.length === 0) byTab.delete(entry.tabId);
		}
	}
}

function findByRequest(details: {
	tabId: number;
	requestId: string;
}): NetworkEntry | undefined {
	const id = activeByRequest.get(requestKey(details.tabId, details.requestId));
	return id ? byId.get(id) : undefined;
}

function finishEntry(
	details: { tabId: number; requestId: string; timeStamp?: number },
	patch: Pick<NetworkEntry, "statusCode" | "statusLine" | "error">,
): void {
	const entry = findByRequest(details);
	if (!entry) return;
	entry.endedAt = Math.round(details.timeStamp ?? Date.now());
	entry.durationMs = Math.max(0, entry.endedAt - entry.startedAt);
	Object.assign(entry, patch);
}

function decodeRaw(bytes: ArrayBuffer): NetworkRequestBody {
	const originalBytesKnown = bytes.byteLength;
	const slice = bytes.slice(0, MAX_BODY_CHARS);
	const text = new TextDecoder().decode(slice);
	return {
		kind: "raw",
		text,
		truncated: originalBytesKnown > MAX_BODY_CHARS,
		originalBytesKnown,
	};
}

function decodeRawParts(
	parts: Array<{ bytes?: ArrayBuffer }>,
): NetworkRequestBody | undefined {
	const byteParts = parts
		.map((part) => part.bytes)
		.filter((bytes): bytes is ArrayBuffer => Boolean(bytes));
	if (byteParts.length === 0) return undefined;
	const originalBytesKnown = byteParts.reduce(
		(sum, bytes) => sum + bytes.byteLength,
		0,
	);
	const out = new Uint8Array(Math.min(originalBytesKnown, MAX_BODY_CHARS));
	let offset = 0;
	for (const bytes of byteParts) {
		if (offset >= out.length) break;
		const chunk = new Uint8Array(
			bytes,
			0,
			Math.min(bytes.byteLength, out.length - offset),
		);
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return {
		kind: "raw",
		text: new TextDecoder().decode(out),
		truncated: originalBytesKnown > MAX_BODY_CHARS,
		originalBytesKnown,
	};
}

function parseRequestBody(
	body?: WebRequestBody,
): NetworkRequestBody | undefined {
	if (!body) return undefined;
	if (body.formData) {
		return { kind: "formData", formData: body.formData };
	}
	const raw = body.raw ?? [];
	const fileParts = raw.filter((part) => "file" in part && part.file);
	if (fileParts.length > 0) {
		return {
			kind: "multipart",
			files: fileParts.map((part) => ({ fileName: part.file })),
			omittedBytes: true,
			note: "Multipart file bytes are not captured yet.",
		};
	}
	return decodeRawParts(raw);
}

function summarize(entry: NetworkEntry): NetworkSummary {
	const { requestHeaders, responseHeaders, requestBody, ...rest } = entry;
	return {
		...rest,
		hasRequestHeaders: Boolean(requestHeaders?.length),
		hasResponseHeaders: Boolean(responseHeaders?.length),
		hasRequestBody: Boolean(requestBody),
		requestBodyKind: requestBody?.kind,
		requestBodyTruncated:
			requestBody?.kind === "raw" ? requestBody.truncated : undefined,
		requestBodyOmittedBytes:
			requestBody?.kind === "multipart" ? requestBody.omittedBytes : undefined,
	};
}

export function listNetworkEntries(
	tabId: number,
	options?: { all?: boolean },
): NetworkSummary[] {
	const entries = byTab.get(tabId) ?? [];
	const filtered = options?.all
		? entries
		: entries.filter((entry) => BACKEND_TYPES.has(entry.type ?? ""));
	return filtered.map(summarize);
}

export function getNetworkEntry(
	tabId: number,
	id: string,
): NetworkEntry | undefined {
	const entry = byId.get(id);
	return entry?.tabId === tabId ? entry : undefined;
}

export function clearNetworkEntries(tabId: number): void {
	const entries = byTab.get(tabId) ?? [];
	for (const entry of entries) removeEntryId(entry.id);
	byTab.delete(tabId);
}

export function clearAllNetworkEntriesForTest(): void {
	byTab.clear();
	byId.clear();
	activeByRequest.clear();
	globalOrder.length = 0;
	nextId = 1;
	installed = false;
}

type WebRequestCallback = (...args: any[]) => unknown;

function addListener(
	event: {
		addListener: (
			callback: WebRequestCallback,
			filter: chrome.webRequest.RequestFilter,
			extraInfoSpec?: string[],
		) => void;
	},
	callback: WebRequestCallback,
	filter: chrome.webRequest.RequestFilter,
	extraInfoSpec?: string[],
): void {
	try {
		event.addListener(callback, filter, extraInfoSpec);
	} catch {
		event.addListener(callback, filter);
	}
}

export function initNetworkLogSession(): void {
	if (installed) return;
	const api = globalThis.chrome?.webRequest;
	if (!api) return;
	installed = true;

	const filter: chrome.webRequest.RequestFilter = { urls: ["<all_urls>"] };

	addListener(
		api.onBeforeRequest as unknown as Parameters<typeof addListener>[0],
		(details: chrome.webRequest.OnBeforeRequestDetails) => {
			if (!isPageTab(details)) return;
			const rawDetails = details as chrome.webRequest.OnBeforeRequestDetails & {
				documentUrl?: string;
				requestBody?: WebRequestBody;
			};
			pushEntry({
				id: `n${nextId++}`,
				requestId: details.requestId,
				tabId: details.tabId,
				frameId: details.frameId,
				parentFrameId: details.parentFrameId,
				url: details.url,
				method: details.method,
				type: details.type,
				initiator: details.initiator,
				documentUrl: rawDetails.documentUrl,
				requestBody: parseRequestBody(rawDetails.requestBody),
				startedAt: Math.round(details.timeStamp ?? Date.now()),
			});
		},
		filter,
		["requestBody"],
	);

	addListener(
		api.onBeforeSendHeaders as unknown as Parameters<typeof addListener>[0],
		(details: chrome.webRequest.OnBeforeSendHeadersDetails) => {
			if (!isPageTab(details)) return;
			const entry = findByRequest(details);
			if (entry) entry.requestHeaders = details.requestHeaders;
		},
		filter,
		["requestHeaders", "extraHeaders"],
	);

	addListener(
		api.onHeadersReceived as unknown as Parameters<typeof addListener>[0],
		(details: chrome.webRequest.OnHeadersReceivedDetails) => {
			if (!isPageTab(details)) return;
			const entry = findByRequest(details);
			if (!entry) return;
			entry.responseHeaders = details.responseHeaders;
			entry.statusCode = details.statusCode;
			entry.statusLine = details.statusLine;
		},
		filter,
		["responseHeaders", "extraHeaders"],
	);

	addListener(
		api.onBeforeRedirect as unknown as Parameters<typeof addListener>[0],
		(details: chrome.webRequest.OnBeforeRedirectDetails) => {
			if (!isPageTab(details)) return;
			finishEntry(details, {
				statusCode: details.statusCode,
				statusLine: details.statusLine,
			});
			const entry = findByRequest(details);
			if (entry) entry.redirectUrl = details.redirectUrl;
		},
		filter,
		["responseHeaders", "extraHeaders"],
	);

	addListener(
		api.onCompleted as unknown as Parameters<typeof addListener>[0],
		(details: chrome.webRequest.OnCompletedDetails) => {
			if (!isPageTab(details)) return;
			finishEntry(details, {
				statusCode: details.statusCode,
				statusLine: details.statusLine,
			});
		},
		filter,
	);

	addListener(
		api.onErrorOccurred as unknown as Parameters<typeof addListener>[0],
		(details: chrome.webRequest.OnErrorOccurredDetails) => {
			if (!isPageTab(details)) return;
			finishEntry(details, { error: details.error });
		},
		filter,
	);

	globalThis.chrome?.tabs?.onRemoved?.addListener?.((tabId) => {
		clearNetworkEntries(tabId);
	});
}
