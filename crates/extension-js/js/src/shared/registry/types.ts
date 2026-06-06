export type TabPolicy = "active" | "required" | "optional";

export type RouteEndpoint = "main-thread" | "content-script" | `worker:${string}`;

export type Route = {
	endpoint: RouteEndpoint;
	tabPolicy: TabPolicy;
};

export type DispatchContext = {
	action: string;
	callId?: number;
	runId?: string;
	signal?: AbortSignal;
};
