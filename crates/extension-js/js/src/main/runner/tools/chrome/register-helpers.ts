/// <reference types="chrome" />
import { z } from "zod";
import { registerChromePassthrough } from "../../chrome/internals.js";

export const zChromeAny = z.unknown();
/** Chrome void APIs often resolve to undefined, null, or boolean (not strictly null). */
export const zChromeVoid = z.union([z.null(), z.undefined(), z.boolean()]);
/** @deprecated Use zChromeVoid */
export const zChromeNull = zChromeVoid;

/** Register a chrome.* passthrough from action name and API path segments. */
export function regChrome(
	action: string,
	apiPath: string[],
	description: string,
	returnsSchema: z.ZodSchema<unknown> = zChromeAny,
	example?: string,
): void {
	registerChromePassthrough(
		action,
		"chrome",
		description,
		apiPath,
		returnsSchema,
		"ECHROME",
		"extension",
		[],
		example,
	);
}
