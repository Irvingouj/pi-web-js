import { z } from "zod";
import type {
	FsCopyParams,
	FsHashParams,
	FsPathParams,
	FsReadRangeParams,
	FsUpdateParams,
	FsWriteParams,
} from "../generated.js";
import { bigintLike } from "./helpers.js";

// ─── Filesystem schemas ────────────────────────────────────────

export const FsPathParamsSchema = z.object({
	path: z.string().describe("File or directory path"),
});

export const FsCopyParamsSchema = z.object({
	from: z.string().describe("Source path"),
	to: z.string().describe("Destination path"),
});

export const FsWriteParamsSchema = z.object({
	path: z.string().describe("File path to write to"),
	data: z.string().describe("Data to write"),
});

export const FsReadRangeParamsSchema = z.object({
	path: z.string().describe("File path to read from"),
	offset: bigintLike().describe("Byte offset to start reading"),
	len: z.number().describe("Number of bytes to read"),
});

export const FsUpdateParamsSchema = z.object({
	path: z.string().describe("File path to update"),
	offset: bigintLike().describe("Byte offset to start writing"),
	data: z.string().describe("Data to write"),
});

export const FsHashParamsSchema = z.object({
	path: z.string().describe("File path to hash"),
	algo: z
		.string()
		.default("sha256")
		.describe("Hash algorithm (e.g. sha256, md5)"),
});

