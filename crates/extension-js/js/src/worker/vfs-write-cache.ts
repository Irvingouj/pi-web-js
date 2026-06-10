/** In-memory base64 cache for recent vfs writes (avoids OPFS re-read during active runCell). */
const cache = new Map<string, string>();

export function cacheVfsWriteBase64(path: string, data: string): void {
	cache.set(path, data);
}

export function takeCachedVfsWriteBase64(path: string): string | undefined {
	const data = cache.get(path);
	if (data !== undefined) {
		cache.delete(path);
	}
	return data;
}

export function clearVfsWriteCache(): void {
	cache.clear();
}
