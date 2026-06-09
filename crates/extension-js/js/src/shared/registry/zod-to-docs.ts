// NOTE: We access Zod's internal _def structure where public types don't expose
// all typeName variants. The instanceof-based narrowing below eliminates most
// `as any` casts; the few remaining _def accesses are properly typed thanks to
// TypeScript narrowing after instanceof checks.
import { z } from "zod";
import type { ToolDocParam } from "./manifest.js";

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
	if (schema instanceof z.ZodEffects) {
		return unwrapSchema(schema.innerType());
	}
	if (schema instanceof z.ZodDefault) {
		return unwrapSchema(schema.removeDefault());
	}
	if (schema instanceof z.ZodPipeline) {
		return unwrapSchema(schema._def.in);
	}
	if (schema instanceof z.ZodOptional) {
		return unwrapSchema(schema.unwrap());
	}
	if (schema instanceof z.ZodNullable) {
		return unwrapSchema(schema.unwrap());
	}
	if (schema instanceof z.ZodBranded) {
		return unwrapSchema(schema.unwrap());
	}
	if (schema instanceof z.ZodReadonly) {
		return unwrapSchema(schema.unwrap());
	}
	if (schema instanceof z.ZodCatch) {
		return unwrapSchema(schema.removeCatch());
	}
	return schema;
}

/**
 * Produce a human-readable type description for a Zod schema.
 *
 * @param schema   – the Zod schema to describe
 * @param depth    – current recursion depth (used internally)
 * @param maxDepth – maximum depth before truncating nested objects with "...";
 *                   default 2 is used for validation-error messages, 3 for docs
 */
export function describeSchema(
	schema: z.ZodTypeAny,
	depth = 0,
	maxDepth = 2,
): string {
	if (depth > maxDepth) return "...";

	if (schema instanceof z.ZodObject) {
		const shape = schema.shape;
		// Filter internal fields (e.g. __invalidPositional used for positional-arg rejection)
		const keys = Object.keys(shape).filter((k) => !k.startsWith("__"));
		if (keys.length === 0) return "{ }";
		if (depth >= maxDepth - 1) return "{ ... }";
		const fields = keys.map((k) => {
			const field = shape[k];
			const isOptional = field instanceof z.ZodOptional;
			const type = isOptional
				? describeSchema(field.unwrap(), depth + 1, maxDepth)
				: describeSchema(field, depth + 1, maxDepth);
			return `${k}${isOptional ? "?" : ""}: ${type}`;
		});
		return `{ ${fields.join(", ")} }`;
	}

	if (schema instanceof z.ZodUnion) {
		return schema.options
			.map((o: z.ZodTypeAny) => describeSchema(o, depth, maxDepth))
			.join(" or ");
	}

	if (schema instanceof z.ZodString) return "string";
	if (schema instanceof z.ZodNumber) return "number";
	if (schema instanceof z.ZodBoolean) return "boolean";
	if (schema instanceof z.ZodBigInt) return "bigint";
	if (schema instanceof z.ZodNull) return "null";

	if (schema instanceof z.ZodArray) {
		const elementType = describeSchema(schema.element, depth + 1, maxDepth);
		if (elementType === "unknown" || elementType === "any") {
			return "array";
		}
		return `${elementType}[]`;
	}

	if (schema instanceof z.ZodTuple) {
		return `[${schema.items.map((i: z.ZodTypeAny) => describeSchema(i, depth + 1, maxDepth)).join(", ")}]`;
	}

	if (schema instanceof z.ZodRecord) {
		// ZodRecord does not expose a public valueType accessor; use _def.
		const valueType = describeSchema((schema._def as { valueType: z.ZodTypeAny }).valueType, depth + 1, maxDepth);
		if (valueType === "unknown" || valueType === "any") {
			return "{ [key: string]: unknown }";
		}
		return `{ [key: string]: ${valueType} }`;
	}
	if (schema instanceof z.ZodOptional)
		return `${describeSchema(schema.unwrap(), depth, maxDepth)}?`;
	if (schema instanceof z.ZodLiteral) return JSON.stringify(schema.value);

	if (schema instanceof z.ZodEnum) {
		return schema.options.map((v: string) => `"${v}"`).join(" | ");
	}

	if (schema instanceof z.ZodAny) return "any";
	if (schema instanceof z.ZodUnknown) return "unknown";
	if (schema instanceof z.ZodVoid) return "void";
	if (schema instanceof z.ZodUndefined) return "undefined";
	if (schema instanceof z.ZodEffects)
		return describeSchema(schema.innerType(), depth, maxDepth);
	if (schema instanceof z.ZodDefault)
		return describeSchema(schema.removeDefault(), depth, maxDepth);
	if (schema instanceof z.ZodNullable)
		return `${describeSchema(schema.unwrap(), depth, maxDepth)} | null`;
	if (schema instanceof z.ZodLazy) return "lazy";
	if (schema instanceof z.ZodPromise)
		return `Promise<${describeSchema(schema.unwrap(), depth + 1, maxDepth)}>`;
	if (schema instanceof z.ZodFunction) return "function";
	if (schema instanceof z.ZodDate) return "Date";
	if (schema instanceof z.ZodMap) return "Map";
	if (schema instanceof z.ZodSet) return "Set";

	if (schema instanceof z.ZodIntersection) {
		return `${describeSchema(schema._def.left, depth, maxDepth)} & ${describeSchema(schema._def.right, depth, maxDepth)}`;
	}

	if (schema instanceof z.ZodDiscriminatedUnion) {
		return schema.options
			.map((o: z.ZodTypeAny) => describeSchema(o, depth, maxDepth))
			.join(" or ");
	}

	if (schema instanceof z.ZodBranded)
		return describeSchema(schema.unwrap(), depth, maxDepth);
	if (schema instanceof z.ZodNaN) return "NaN";
	if (schema instanceof z.ZodCatch)
		return describeSchema(schema.removeCatch(), depth, maxDepth);
	if (schema instanceof z.ZodPipeline)
		return describeSchema(schema._def.in, depth, maxDepth);
	if (schema instanceof z.ZodReadonly)
		return `readonly ${describeSchema(schema.unwrap(), depth, maxDepth)}`;

	return "unknown";
}

/**
 * Derive parameter documentation from a ZodObject schema.
 *
 * Transparent wrappers (ZodEffects, ZodDefault, ZodPipeline) are unwrapped
 * before inspecting the shape. Keys starting with `__` are filtered out as
 * internal convention. ZodDefault fields are treated as optional because the
 * default value means agents don't need to provide them.
 */
export function zodToParamDocs(schema: z.ZodTypeAny): ToolDocParam[] {
	const unwrapped = unwrapSchema(schema);

	if (!(unwrapped instanceof z.ZodObject)) {
		return [];
	}

	const shape = unwrapped.shape;
	// Filter internal fields (e.g. __invalidPositional used for positional-arg rejection)
	const keys = Object.keys(shape).filter((k) => !k.startsWith("__"));

	return keys.map((k) => {
		const field = shape[k];

		let isOptional = false;
		let isNullable = false;
		let inner = field;

		while (true) {
			if (inner instanceof z.ZodOptional) { isOptional = true; inner = inner.unwrap(); continue; }
			if (inner instanceof z.ZodDefault) { isOptional = true; inner = inner.removeDefault(); continue; }
			if (inner instanceof z.ZodEffects) { inner = inner.innerType(); continue; }
			if (inner instanceof z.ZodNullable) { isNullable = true; inner = inner.unwrap(); continue; }
			if (inner instanceof z.ZodBranded) { inner = inner.unwrap(); continue; }
			if (inner instanceof z.ZodReadonly) { inner = inner.unwrap(); continue; }
			if (inner instanceof z.ZodCatch) { inner = inner.removeCatch(); continue; }
			if (inner instanceof z.ZodPipeline) { inner = inner._def.in; continue; }
			break;
		}

		const type = describeSchema(inner, 1, 3) + (isNullable ? " | null" : "");
		const description = field.description ?? inner.description ?? "";

		return {
			name: k,
			type,
			required: !isOptional,
			description,
		};
	});
}

/**
 * Derive a rich return-type string from a Zod schema.
 *
 * Uses describeSchema with maxDepth=3 so nested objects are expanded one level
 * deeper than validation-error messages.
 */
export function zodToReturnType(schema: z.ZodTypeAny): string {
	return describeSchema(schema, 0, 3);
}
