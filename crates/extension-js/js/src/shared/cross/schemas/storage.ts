import { z } from "zod";
import { bigintLike } from "./helpers.js";

// ─── Storage schemas ───────────────────────────────────────────

export const StorageGetParamsSchema = z.object({
	key: z.string().describe("Storage key to retrieve"),
});

export const StorageSetParamsSchema = z.object({
	key: z.string().describe("Storage key to set"),
	value: z.string().describe("Value to store"),
});

export const StorageDeleteParamsSchema = z.object({
	key: z.string().describe("Storage key to delete"),
});

export const StorageListParamsSchema = z.object({});

const storageSetManyShape = z.object({
	items: z
		.record(z.string())
		.describe("Record of key-value string pairs to store"),
});
export type StorageSetManyParams = z.infer<typeof storageSetManyShape>;
export const StorageSetManyParamsSchema = z.preprocess((val) => {
	if (
		val !== null &&
		typeof val === "object" &&
		!Array.isArray(val) &&
		!("items" in (val as Record<string, unknown>))
	) {
		return { items: val };
	}
	return val;
}, storageSetManyShape) as z.ZodType<StorageSetManyParams>;

const storageGetManyShape = z.object({
	keys: z.array(z.string()).describe("Array of storage keys to retrieve"),
	defaults: z
		.record(z.string())
		.optional()
		.describe("Default string values for missing keys"),
});
export type StorageGetManyParams = z.infer<typeof storageGetManyShape>;
export const StorageGetManyParamsSchema = z.preprocess(
	(val) => (Array.isArray(val) ? { keys: val } : val),
	storageGetManyShape,
) as z.ZodType<StorageGetManyParams>;

export const StorageGetAllParamsSchema = z.object({});

const storageDeleteManyShape = z.object({
	keys: z.array(z.string()).describe("Array of storage keys to delete"),
});
export type StorageDeleteManyParams = z.infer<typeof storageDeleteManyShape>;
export const StorageDeleteManyParamsSchema = z.preprocess(
	(val) => (Array.isArray(val) ? { keys: val } : val),
	storageDeleteManyShape,
) as z.ZodType<StorageDeleteManyParams>;
export const StorageClearParamsSchema = z.object({});

