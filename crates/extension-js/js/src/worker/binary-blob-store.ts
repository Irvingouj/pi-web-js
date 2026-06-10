export type StoredBlob = {
	bytes: Uint8Array;
	mimeType?: string;
	contentType?: string;
};

const runStores = new Map<string, Map<string, StoredBlob>>();
const runCounters = new Map<string, number>();

function runKey(runId: string | undefined): string {
	return runId && runId.length > 0 ? runId : "__default__";
}

function getStore(runId: string | undefined): Map<string, StoredBlob> {
	const key = runKey(runId);
	let store = runStores.get(key);
	if (!store) {
		store = new Map();
		runStores.set(key, store);
	}
	return store;
}

export function storeBlob(
	runId: string | undefined,
	bytes: Uint8Array,
	meta?: { mimeType?: string; contentType?: string },
): string {
	const key = runKey(runId);
	const next = (runCounters.get(key) ?? 0) + 1;
	runCounters.set(key, next);
	const handle = `blob_${next}`;
	getStore(runId).set(handle, {
		bytes,
		mimeType: meta?.mimeType,
		contentType: meta?.contentType,
	});
	return handle;
}

export function takeBlob(
	runId: string | undefined,
	handle: string,
): StoredBlob | null {
	const store = getStore(runId);
	const blob = store.get(handle) ?? null;
	if (blob) {
		store.delete(handle);
	}
	return blob;
}

export function clearRun(runId: string | undefined): void {
	const key = runKey(runId);
	runStores.delete(key);
	runCounters.delete(key);
}

export function clearAllBlobStores(): void {
	runStores.clear();
	runCounters.clear();
}
