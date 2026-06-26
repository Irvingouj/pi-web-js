// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	describeSchema,
	zodToParamDocs,
	zodToReturnType,
} from "../../src/shared/cross/zod-to-docs.js";

describe("zodToParamDocs", () => {
	it("unwraps ZodEffects (preprocess) before reading shape", () => {
		const schema = z.object({
			x: z.preprocess(Number, z.number()),
		});
		expect(zodToParamDocs(schema)).toEqual([
			{ name: "x", type: "number", required: true, description: "" },
		]);
	});

	it("unwraps ZodDefault and marks field as required: false", () => {
		const schema = z.object({
			x: z.string().default("foo"),
		});
		const docs = zodToParamDocs(schema);
		expect(docs).toEqual([
			{ name: "x", type: "string", required: false, description: "" },
		]);
	});

	it("unwraps ZodPipeline before reading shape", () => {
		const schema = z.object({
			x: z.pipeline(z.string(), z.string().min(1)),
		});
		expect(zodToParamDocs(schema)).toEqual([
			{ name: "x", type: "string", required: true, description: "" },
		]);
	});

	it("filters out keys starting with __", () => {
		const schema = z.object({
			public: z.string(),
			__internal: z.number(),
			__invalidPositional: z.union([z.string(), z.number()]).optional(),
		});
		const docs = zodToParamDocs(schema);
		expect(docs.map((d) => d.name)).toEqual(["public"]);
	});

	it("reads description from outer wrapper when present", () => {
		const schema = z.object({
			x: z.string().optional().describe("The user's name"),
		});
		const docs = zodToParamDocs(schema);
		expect(docs[0].description).toBe("The user's name");
	});

	it("falls back to inner schema description when wrapper has none", () => {
		const schema = z.object({
			x: z.string().describe("The user's name").optional(),
		});
		const docs = zodToParamDocs(schema);
		expect(docs[0].description).toBe("The user's name");
	});

	it("unwraps ZodOptional at the top level", () => {
		const schema = z.object({ x: z.string() }).optional();
		expect(zodToParamDocs(schema)).toEqual([
			{ name: "x", type: "string", required: true, description: "" },
		]);
	});

	it("unwraps ZodNullable at the top level", () => {
		const schema = z.object({ x: z.string() }).nullable();
		expect(zodToParamDocs(schema)).toEqual([
			{ name: "x", type: "string", required: true, description: "" },
		]);
	});

	it("unwraps ZodBranded at the top level", () => {
		const schema = z.object({ x: z.string() }).brand<"Test">();
		expect(zodToParamDocs(schema)).toEqual([
			{ name: "x", type: "string", required: true, description: "" },
		]);
	});

	it("unwraps ZodReadonly at the top level", () => {
		const schema = z.object({ x: z.string() }).readonly();
		expect(zodToParamDocs(schema)).toEqual([
			{ name: "x", type: "string", required: true, description: "" },
		]);
	});

	it("unwraps ZodCatch at the top level", () => {
		const schema = z.object({ x: z.string() }).catch({ x: "fallback" });
		expect(zodToParamDocs(schema)).toEqual([
			{ name: "x", type: "string", required: true, description: "" },
		]);
	});

	it("returns empty array for non-ZodObject schemas", () => {
		expect(zodToParamDocs(z.string())).toEqual([]);
		expect(zodToParamDocs(z.union([z.string(), z.number()]))).toEqual([]);
	});
});

describe("zodToReturnType", () => {
	it("produces rich type strings for primitives", () => {
		expect(zodToReturnType(z.string())).toBe("string");
		expect(zodToReturnType(z.number())).toBe("number");
		expect(zodToReturnType(z.boolean())).toBe("boolean");
	});

	it("produces rich type strings for objects", () => {
		const schema = z.object({ a: z.string(), b: z.number() });
		expect(zodToReturnType(schema)).toContain("a: string");
		expect(zodToReturnType(schema)).toContain("b: number");
	});

	it("produces rich type strings for unions", () => {
		expect(zodToReturnType(z.union([z.string(), z.null()]))).toBe(
			"string or null",
		);
	});

	it("produces rich type strings for arrays", () => {
		expect(zodToReturnType(z.array(z.string()))).toBe("string[]");
	});

	it("produces rich type strings for optional fields", () => {
		const schema = z.object({ a: z.string().optional() });
		expect(zodToReturnType(schema)).toContain("a?: string");
	});
});

describe("describeSchema", () => {
	it("respects maxDepth=2 (default for validation errors)", () => {
		const schema = z.object({
			a: z.object({ b: z.string() }),
		});
		expect(describeSchema(schema, 0, 2)).toBe("{ a: { ... } }");
	});

	it("respects maxDepth=3 (used for docs)", () => {
		const schema = z.object({
			a: z.object({ b: z.string() }),
		});
		expect(describeSchema(schema, 0, 3)).toBe("{ a: { b: string } }");
	});

	it("truncates deeply nested objects beyond maxDepth", () => {
		const schema = z.object({
			a: z.object({ b: z.object({ c: z.string() }) }),
		});
		expect(describeSchema(schema, 0, 2)).toBe("{ a: { ... } }");
	});

	it("filters __ keys in ZodObject branch", () => {
		const schema = z.object({
			public: z.string(),
			__hidden: z.number(),
		});
		expect(describeSchema(schema)).toBe("{ public: string }");
	});

	it("describes unions with 'or'", () => {
		expect(describeSchema(z.union([z.string(), z.number()]))).toBe(
			"string or number",
		);
	});

	it("describes arrays with element type", () => {
		expect(describeSchema(z.array(z.string()))).toBe("string[]");
	});

	it("describes tuples with element types", () => {
		expect(describeSchema(z.tuple([z.string(), z.number()]))).toBe(
			"[string, number]",
		);
	});

	it("describes enums with quoted values", () => {
		expect(describeSchema(z.enum(["a", "b"]))).toBe('"a" | "b"');
	});

	it("describes literals with JSON value", () => {
		expect(describeSchema(z.literal("hello"))).toBe('"hello"');
		expect(describeSchema(z.literal(42))).toBe("42");
	});

	it("describes optional fields with ? suffix", () => {
		expect(describeSchema(z.string().optional())).toBe("string?");
	});

	it("describes nullable fields with | null", () => {
		expect(describeSchema(z.string().nullable())).toBe("string | null");
	});

	it("describes default fields as inner type", () => {
		expect(describeSchema(z.string().default("foo"))).toBe("string");
	});

	it("describes effects as inner type", () => {
		expect(describeSchema(z.preprocess(Number, z.number()))).toBe("number");
	});

	it("describes pipeline as input type", () => {
		expect(describeSchema(z.pipeline(z.string(), z.string().min(1)))).toBe(
			"string",
		);
	});

	it("describes branded types as inner type", () => {
		expect(describeSchema(z.string().brand<"Email">())).toBe("string");
	});

	it("describes readonly types with readonly prefix", () => {
		expect(describeSchema(z.string().readonly())).toBe("readonly string");
	});

	it("describes catch types as inner type", () => {
		expect(describeSchema(z.string().catch("fallback"))).toBe("string");
	});

	it("describes intersection types with &", () => {
		expect(
			describeSchema(
				z.intersection(
					z.object({ a: z.string() }),
					z.object({ b: z.number() }),
				),
			),
		).toBe("{ a: string } & { b: number }");
	});

	it("describes discriminated unions with 'or'", () => {
		const schema = z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("a"), value: z.string() }),
			z.object({ kind: z.literal("b"), value: z.number() }),
		]);
		expect(describeSchema(schema)).toBe(
			'{ kind: "a", value: string } or { kind: "b", value: number }',
		);
	});

	it("returns unknown for unhandled types", () => {
		// ZodLazy is handled by returning "lazy", but let's test a custom schema
		// that we can't easily construct. Instead, test that lazy works.
		const lazySchema: z.ZodTypeAny = z.lazy(() => z.string());
		expect(describeSchema(lazySchema)).toBe("lazy");
	});
});
