// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
	arrayBufferToBase64,
	base64ToUint8Array,
} from "../src/shared/array-buffer.js";

describe("base64ToUint8Array", () => {
	it("round-trips with arrayBufferToBase64", () => {
		const bytes = new Uint8Array([0, 127, 255, 42]);
		const encoded = arrayBufferToBase64(bytes);
		const decoded = base64ToUint8Array(encoded);
		expect(Array.from(decoded)).toEqual(Array.from(bytes));
	});

	it("throws on invalid base64", () => {
		expect(() => base64ToUint8Array("not!!!valid")).toThrow();
	});
});

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
