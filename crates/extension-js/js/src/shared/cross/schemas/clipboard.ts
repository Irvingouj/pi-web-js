import { z } from "zod";

// ─── Clipboard schemas ─────────────────────────────────────────

export const ClipboardReadParamsSchema = z.object({});

export const ClipboardWriteParamsSchema = z.union([
	z.tuple([z.union([z.object({ text: z.string() }), z.string()])]),
	z.object({ text: z.string().optional(), value: z.string().optional() }),
]);
