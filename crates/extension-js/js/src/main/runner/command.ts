/// <reference types="chrome" />
import type { AsyncResponse, Command } from "../../shared/tool-registry.js";
import { dispatchTool, getRunnerSignal } from "../../shared/tool-registry.js";
import { logger as logModule } from "../../shared/logger.js";
import { isValidMainThreadAction } from "./lib/host-registry.js";
import { isNativeParityAction, normalizeParityArgs } from "./chrome/native.js";
import { normalizeParams } from "./lib/params.js";
import { handleHostCallAction } from "./host.js";

function parityParamsForDispatch(action: string, params: unknown): unknown {
	if (!isNativeParityAction(action)) return params;
	const args = Array.isArray(params) ? params : [];
	return normalizeParityArgs(action, args);
}

function unknownActionResponse(action: string): AsyncResponse {
	return {
		ok: false,
		error: { message: `Unknown action: ${action}`, code: "E_UNKNOWN" },
	};
}

export async function executeMainThreadCommand(command: Command, relaySignal?: AbortSignal): Promise<AsyncResponse> {
	const signal = relaySignal ?? getRunnerSignal();
	if (signal?.aborted) throw new Error("Runner aborted: ExtensionSession stopped");
	const logger = logModule.child("runner");
	const finish = logger.timer("command_dispatch", { action: command.action, commandId: command.call_id, runId: command.runId });
	if (!isValidMainThreadAction(command.action)) { finish({ ok: false }); return unknownActionResponse(command.action); }
	if (command.action.startsWith("host_")) { const r = await handleHostCallAction(command.action.slice(5), command.params); finish({ ok: r.ok, handler: "host" }); return r; }
	const params = isNativeParityAction(command.action) ? parityParamsForDispatch(command.action, command.params) : normalizeParams(command.action, command.params);
	const r = await dispatchTool(command.action, params, command.call_id, command.runId, signal);
	finish({ ok: r.ok });
	return r;
}
