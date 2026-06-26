/// <reference types="chrome" />

import { logger as logModule } from "../../shared/main/logger.js";
import type { AsyncResponse, Command } from "../../shared/main/tool-registry.js";
import { dispatchTool, getRunnerSignal } from "../../shared/main/tool-registry.js";
import { isNativeParityAction, normalizeParityArgs } from "./chrome/native.js";
import { handleHostCallAction } from "./host.js";
import { isValidMainThreadAction } from "./lib/host-registry.js";
import { normalizeParams } from "./lib/params.js";

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

function resolveSignal(relaySignal?: AbortSignal): AbortSignal {
	const signal = relaySignal ?? getRunnerSignal();
	if (signal?.aborted)
		throw new Error("Runner aborted: ExtensionSession stopped");
	return signal ?? new AbortController().signal;
}

async function dispatchCommand(
	command: Command,
	signal: AbortSignal,
): Promise<{ response: AsyncResponse; handler?: string }> {
	if (!isValidMainThreadAction(command.action))
		return { response: unknownActionResponse(command.action) };
	if (command.action.startsWith("host_")) {
		const r = await handleHostCallAction(
			command.action.slice(5),
			command.params,
		);
		return { response: r, handler: "host" };
	}
	const params = isNativeParityAction(command.action)
		? parityParamsForDispatch(command.action, command.params)
		: normalizeParams(command.action, command.params);
	const r = await dispatchTool(
		command.action,
		params,
		command.call_id,
		command.runId,
		signal,
	);
	return { response: r };
}

function startCommandTimer(command: Command) {
	return logModule.child("runner").timer("command_dispatch", {
		action: command.action,
		commandId: command.call_id,
		runId: command.runId,
	});
}

export async function executeMainThreadCommand(
	command: Command,
	relaySignal?: AbortSignal,
): Promise<AsyncResponse> {
	const finish = startCommandTimer(command);
	const { response, handler } = await dispatchCommand(
		command,
		resolveSignal(relaySignal),
	);
	finish({ ok: response.ok, ...(handler ? { handler } : {}) });
	return response;
}
