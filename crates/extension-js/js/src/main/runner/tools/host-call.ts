import * as schemas from "../../../shared/cross/schemas.js";
import { registerJsCall } from "../../../shared/main/tool-registry.js";
import { asRecord, handleHostCallAction, unwrapResult } from "../runtime.js";

// ─── Host call ───────────────────────────────────────────────────

registerJsCall({
	action: "host_call",
	namespace: "host",
	name: "call",
	description: "Call a host handler",
	params: schemas.HostCallParamsSchema,
	returns: schemas.HostCallResultSchema,
	fields: ["action", "params"],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const obj = asRecord(params);
		const action = obj.action as string;
		const actionParams = obj.params;
		return unwrapResult(await handleHostCallAction(action, actionParams));
	},
	paramTypes: [
		{
			name: "action",
			type: "string",
			required: true,
			description: "Host action name (literal)",
		},
		{
			name: "params",
			type: "host action parameters",
			required: false,
			description: "Parameters for the host action (literal)",
		},
	],
	returnDoc: "Handler result",
	errorCode: "ENOHANDLER",
	errorCategory: "host",

	example: 'host.call(["title", "url"])',
});
