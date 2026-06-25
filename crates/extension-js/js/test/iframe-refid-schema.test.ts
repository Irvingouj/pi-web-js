// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { refIdString } from "../src/shared/schemas.js";

describe("refId schema (iframe composite refIds)", () => {
	it("accepts plain refId (top frame, backward compatible)", () => {
		const schema = refIdString();
		expect(() => schema.parse("e0")).not.toThrow();
		expect(() => schema.parse("e5")).not.toThrow();
		expect(() => schema.parse("e999")).not.toThrow();
	});

	it("accepts frame-prefixed refId (iframe elements)", () => {
		const schema = refIdString();
		expect(() => schema.parse("f1_e0")).not.toThrow();
		expect(() => schema.parse("f3_e5")).not.toThrow();
		expect(() => schema.parse("f99_e42")).not.toThrow();
	});

	it("rejects invalid refId formats", () => {
		const schema = refIdString();
		expect(() => schema.parse("x5")).toThrow();
		expect(() => schema.parse("e")).toThrow();
		expect(() => schema.parse("")).toThrow();
		expect(() => schema.parse("f_e5")).toThrow(); // no frame number
		expect(() => schema.parse("f1_")).toThrow(); // no refId after prefix
		expect(() => schema.parse("f1_e")).toThrow(); // incomplete refId
		expect(() => schema.parse("e-1")).toThrow(); // negative
	});

	it("extracts usable refId from both formats", () => {
		const schema = refIdString();
		const plain = schema.parse("e5");
		const framed = schema.parse("f3_e5");
		expect(plain).toBe("e5");
		expect(framed).toBe("f3_e5");
	});
});
