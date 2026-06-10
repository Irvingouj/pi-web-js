// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { arrayBufferToBase64 } from "../src/shared/array-buffer.js";

describe("arrayBufferToBase64", () => {
	it("round-trips 64KB+ random bytes", () => {
		const size = 65_536;
		const bytes = new Uint8Array(size);
		for (let i = 0; i < size; i++) {
			bytes[i] = (i * 17 + 31) % 256;
		}

		const encoded = arrayBufferToBase64(bytes);
		const decoded = atob(encoded);
		expect(decoded.length).toBe(size);
		for (let i = 0; i < size; i++) {
			expect(decoded.charCodeAt(i)).toBe(bytes[i]);
		}
	});
});
