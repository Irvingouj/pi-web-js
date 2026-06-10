const SUB_CHUNK_SIZE = 8 * 1024;

/** Decode a base64 string into bytes. Throws on invalid input. */
export function base64ToUint8Array(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

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
