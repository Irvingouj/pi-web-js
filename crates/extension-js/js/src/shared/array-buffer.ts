const SUB_CHUNK_SIZE = 8 * 1024;

/** Convert Uint8Array to base64 without spread-arg limits on large buffers. */
export function arrayBufferToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += SUB_CHUNK_SIZE) {
		const sub = bytes.subarray(i, i + SUB_CHUNK_SIZE);
		for (let j = 0; j < sub.length; j++) {
			binary += String.fromCharCode(sub[j]!);
		}
	}
	return btoa(binary);
}
