import { base64ToUint8Array } from "../shared/array-buffer.js";
import type { FetchValueSchema } from "../shared/schemas.js";
import type { z } from "zod";
import { storeBlob } from "./binary-blob-store.js";

type FetchValue = z.infer<typeof FetchValueSchema>;

function wantsStore(params: unknown): boolean {
	if (typeof params !== "object" || params === null) return false;
	const obj = params as Record<string, unknown>;
	if (obj.store === true) return true;
	const options = obj.options;
	if (typeof options === "object" && options !== null) {
		return (options as Record<string, unknown>).store === true;
	}
	return false;
}

export function maybeStoreFetchResult(
	params: unknown,
	result: unknown,
	runId: string | undefined,
): unknown {
	if (!wantsStore(params)) {
		return result;
	}
	if (typeof result !== "object" || result === null || !("bodyEncoding" in result)) {
		return result;
	}
	const fetchValue = result as FetchValue;
	if (fetchValue.bodyEncoding !== "base64" || !fetchValue.body) {
		return result;
	}

	const bytes = base64ToUint8Array(fetchValue.body);
	const handle = storeBlob(runId, bytes, {
		contentType: fetchValue.contentType,
		mimeType: fetchValue.contentType,
	});

	const { body: _body, ...rest } = fetchValue;
	return {
		...rest,
		bodyEncoding: "handle" as const,
		handle,
	};
}
