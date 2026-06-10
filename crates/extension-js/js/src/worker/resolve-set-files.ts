import { arrayBufferToBase64 } from "../shared/array-buffer.js";
import type { PageSetFilesParams, TabSetFilesParams } from "../shared/generated.js";
import {
	PageSetFilesParamsSchema,
	TabSetFilesParamsSchema,
} from "../shared/schemas.js";
import { takeBlob } from "./binary-blob-store.js";

export type ResolvedSetFile =
	| {
			kind: "bytes";
			name: string;
			data: string;
			mimeType?: string;
	  }
	| {
			kind: "url";
			url: string;
			name: string;
			mimeType?: string;
	  };

function basenameFromRef(ref: string, fallback: string): string {
	const withoutQuery = ref.split(/[?#]/)[0] ?? ref;
	const segment = withoutQuery.split("/").filter(Boolean).pop();
	return segment && segment.length > 0 ? segment : fallback;
}

function invalidParams(message: string) {
	return {
		ok: false as const,
		error: {
			message,
			code: "E_INVALID_PARAMS",
			category: "validation" as const,
		},
	};
}

export async function resolveSetFilesParams(
	action: string,
	params: unknown,
	runId: string | undefined,
	readBase64: (path: string) => Promise<string>,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: { message: string; code: string; category?: string } }> {
	const schema =
		action === "tab_set_files"
			? TabSetFilesParamsSchema
			: PageSetFilesParamsSchema;
	const parsed = schema.safeParse(params);
	if (!parsed.success) {
		return invalidParams(parsed.error.issues[0]?.message ?? "Invalid setFiles params");
	}

	const data = parsed.data as PageSetFilesParams | TabSetFilesParams;
	const resolvedFiles: ResolvedSetFile[] = [];
	for (const file of data.files) {
		if (file.url) {
			resolvedFiles.push({
				kind: "url",
				url: file.url,
				name: file.name ?? basenameFromRef(file.url, "upload.bin"),
				mimeType: file.mimeType,
			});
			continue;
		}
		if (file.path) {
			try {
				const data = await readBase64(file.path);
				resolvedFiles.push({
					kind: "bytes",
					name: file.name ?? basenameFromRef(file.path, "upload.bin"),
					data,
					mimeType: file.mimeType,
				});
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return invalidParams(`Failed to read path ${file.path}: ${message}`);
			}
			continue;
		}
		if (file.handle) {
			const blob = takeBlob(runId, file.handle);
			if (!blob) {
				return invalidParams(`Unknown or expired handle: ${file.handle}`);
			}
			resolvedFiles.push({
				kind: "bytes",
				name: file.name ?? file.handle,
				data: arrayBufferToBase64(blob.bytes),
				mimeType: file.mimeType ?? blob.mimeType ?? blob.contentType,
			});
		}
	}

	return {
		ok: true,
		value: {
			...data,
			files: resolvedFiles,
		},
	};
}
