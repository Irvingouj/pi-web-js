/**
 * Register a content-script capability on the main-thread registry pipeline:
 * manifest entries + content-script action set. Does not install a main-thread
 * executable tool handler.
 *
 * When `handler` is provided, also wires content-script schema (+ optional
 * in-process handler table for tests). Production CS bundle still uses the
 * handlers map + registerContentScriptSpecs at inject time.
 */
import type { z } from "zod";
import {
	type CapabilitySpec,
	expandCapability,
} from "../cross/capability.js";
import { addContentScriptAction } from "../cross/content-script-actions.js";
import {
	registerContentScriptSpec,
	type ContentScriptHandler,
} from "../../content-script/registry.js";
import { registerContentScriptJsCall } from "./tool-registry.js";

export type { CapabilitySpec, Surface } from "../cross/capability.js";
export { expandCapability, withTabId } from "../cross/capability.js";

export function register<P, R>(spec: CapabilitySpec<P, R>): void {
	const expanded = expandCapability(spec);

	for (const entry of expanded) {
		registerContentScriptJsCall({
			action: entry.action,
			namespace: entry.namespace,
			name: entry.name,
			description: entry.description,
			params: entry.params as z.ZodSchema<P>,
			returns: entry.returns as z.ZodSchema<R>,
			fields: entry.fields,
			aliases: entry.aliases,
			// empty paramTypes → getSerializableJsManifest uses zodToParamDocs
			paramTypes: [],
			returnDoc: entry.returnDoc,
			errorCode: entry.errorCode,
			errorCategory: entry.errorCategory,
			example: entry.example,
			agentMeta: entry.agentMeta,
		});
		addContentScriptAction(entry.action);

		const wireCs =
			spec.wireContentScriptSchema === true || spec.handler !== undefined;
		if (wireCs) {
			registerContentScriptSpec({
				registryAction: entry.action,
				handlerKey: entry.handlerKey,
				params: entry.handlerParams as z.ZodSchema<unknown>,
				returns: entry.returns as z.ZodSchema<unknown>,
			});
			// Handler body is looked up by handlerKey in production (handlers.ts).
			void (spec.handler as ContentScriptHandler | undefined);
		}
	}
}
