/**
 * File-input resolution for `set_files`. Resolves worker-processed file
 * payloads (base64 bytes or fetched URL) into real `File` objects and
 * verifies they landed on the input.
 */

import { notInteractableError } from "../shared/cross/agent-errors.js";
import { base64ToUint8Array } from "../shared/cross/array-buffer.js";
import { throwStructuredAgentError } from "../shared/cross/normalize-agent-error.js";
import { asRecord } from "./dom-utils.js";

export type ResolvedBytesFile = {
	kind: "bytes";
	name: string;
	data: string;
	mimeType?: string;
};

export type ResolvedUrlFile = {
	kind: "url";
	url: string;
	name: string;
	mimeType?: string;
};

export type ResolvedSetFile = ResolvedBytesFile | ResolvedUrlFile;

function invalidParams(message: string): never {
	throwStructuredAgentError({
		message,
		code: "E_INVALID_PARAMS",
		category: "validation",
	});
}

export function parseResolvedFiles(params: unknown): ResolvedSetFile[] {
	const obj = asRecord(params);
	const filesRaw = obj.files;
	if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
		invalidParams("setFiles requires a non-empty files array");
	}
	const files: ResolvedSetFile[] = [];
	for (const item of filesRaw) {
		const fileObj = asRecord(item);
		const kind = fileObj.kind;
		if (kind === "bytes") {
			const name = typeof fileObj.name === "string" ? fileObj.name.trim() : "";
			const data = typeof fileObj.data === "string" ? fileObj.data : "";
			if (!name || !data) {
				invalidParams("Resolved bytes file requires name and data");
			}
			files.push({
				kind: "bytes",
				name,
				data,
				mimeType:
					typeof fileObj.mimeType === "string" && fileObj.mimeType.length > 0
						? fileObj.mimeType
						: undefined,
			});
			continue;
		}
		if (kind === "url") {
			const url = typeof fileObj.url === "string" ? fileObj.url : "";
			const name = typeof fileObj.name === "string" ? fileObj.name.trim() : "";
			if (!url || !name) {
				invalidParams("Resolved url file requires url and name");
			}
			files.push({
				kind: "url",
				url,
				name,
				mimeType:
					typeof fileObj.mimeType === "string" && fileObj.mimeType.length > 0
						? fileObj.mimeType
						: undefined,
			});
		}
	}
	if (files.length !== filesRaw.length) {
		invalidParams(
			"setFiles files must be worker-resolved (kind: bytes or url)",
		);
	}
	return files;
}

export function fileFromBytes(file: ResolvedBytesFile): File {
	try {
		const bytes = base64ToUint8Array(file.data);
		return new File([bytes.slice()], file.name, {
			type: file.mimeType ?? "application/octet-stream",
		});
	} catch {
		invalidParams(`Invalid base64 data for file ${file.name}`);
	}
}

export async function fileFromUrl(file: ResolvedUrlFile): Promise<File> {
	try {
		const resp = await fetch(file.url);
		if (!resp.ok) {
			throwStructuredAgentError({
				message: `Failed to fetch file URL ${file.url}: HTTP ${resp.status}`,
				code: "E_NETWORK",
				category: "network",
			});
		}
		const bytes = new Uint8Array(await resp.arrayBuffer());
		const type =
			file.mimeType ||
			resp.headers.get("content-type") ||
			"application/octet-stream";
		return new File([bytes.slice()], file.name, { type });
	} catch (err: unknown) {
		if (
			typeof err === "object" &&
			err !== null &&
			"code" in err &&
			typeof (err as { code?: string }).code === "string"
		) {
			throw err;
		}
		const message = err instanceof Error ? err.message : String(err);
		throwStructuredAgentError({
			message: `Failed to fetch file URL ${file.url}: ${message}`,
			code: "E_NETWORK",
			category: "network",
		});
	}
}

export function assertSetFilesEffect(
	el: HTMLInputElement,
	refId: string,
	expectedNames: string[],
): void {
	const actualNames = Array.from(el.files ?? []).map((f) => f.name);
	if (
		(el.files?.length ?? 0) !== expectedNames.length ||
		!expectedNames.every((name, index) => actualNames[index] === name)
	) {
		throwStructuredAgentError(
			notInteractableError("setFiles", refId, {
				expectedNames,
				actualNames,
			}),
		);
	}
}
