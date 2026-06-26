import { arrayBufferToBase64 } from "./array-buffer.js";

export type FetchValue = {
	status: number;
	ok: boolean;
	headers: Record<string, string>;
	body: string;
	bodyEncoding: "text" | "base64";
	byteLength: number;
	contentType: string;
	finalUrl: string;
};

function normalizeContentType(contentType: string): string {
	return contentType.toLowerCase().split(";")[0].trim();
}

function isBinaryContentType(normalized: string): boolean {
	if (
		normalized.startsWith("image/") ||
		normalized.startsWith("audio/") ||
		normalized.startsWith("video/")
	) {
		return true;
	}
	if (
		normalized === "application/octet-stream" ||
		normalized === "application/pdf" ||
		normalized === "application/zip" ||
		normalized === "application/gzip" ||
		normalized === "application/x-gzip" ||
		normalized === "application/x-zip-compressed"
	) {
		return true;
	}
	return normalized.startsWith("application/vnd.");
}

function bufferContainsNullByte(bytes: Uint8Array): boolean {
	for (let i = 0; i < bytes.length; i++) {
		if (bytes[i] === 0) return true;
	}
	return false;
}

function responseHeaders(resp: Response): Record<string, string> {
	return Object.fromEntries(resp.headers.entries());
}

function encodeBinaryBody(
	resp: Response,
	bytes: Uint8Array,
	contentType: string,
): FetchValue {
	return {
		status: resp.status,
		ok: resp.ok,
		headers: responseHeaders(resp),
		body: arrayBufferToBase64(bytes),
		bodyEncoding: "base64",
		byteLength: bytes.length,
		contentType,
		finalUrl: resp.url,
	};
}

function encodeTextBody(
	resp: Response,
	text: string,
	contentType: string,
): FetchValue {
	return {
		status: resp.status,
		ok: resp.ok,
		headers: responseHeaders(resp),
		body: text,
		bodyEncoding: "text",
		byteLength: new TextEncoder().encode(text).length,
		contentType,
		finalUrl: resp.url,
	};
}

/** Encode a fetch Response for page.fetch / web.fetch with binary-safe handling. */
export async function encodeFetchResponse(resp: Response): Promise<FetchValue> {
	const contentType = resp.headers.get("content-type") || "";
	const normalized = normalizeContentType(contentType);

	if (isBinaryContentType(normalized)) {
		const bytes = new Uint8Array(await resp.arrayBuffer());
		return encodeBinaryBody(resp, bytes, contentType);
	}

	if (!normalized || normalized.startsWith("text/")) {
		const bytes = new Uint8Array(await resp.arrayBuffer());
		if (bufferContainsNullByte(bytes)) {
			return encodeBinaryBody(resp, bytes, contentType);
		}
		const text = new TextDecoder().decode(bytes);
		return encodeTextBody(resp, text, contentType);
	}

	const text = await resp.text();
	return encodeTextBody(resp, text, contentType);
}
