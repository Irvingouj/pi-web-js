import { isContentScriptAction } from "./content-script-actions.js";
import type { ExecutionContextId } from "./manifest.js";
import type { Route, TabPolicy } from "./types.js";

const routes = new Map<string, Route>();

export function setRoute(action: string, route: Route): void {
	routes.set(action, route);
}

export function getRoute(action: string): Route | undefined {
	return routes.get(action);
}

export function clearRoutes(): void {
	routes.clear();
}

export function inferTabPolicy(action: string): TabPolicy {
	if (action.startsWith("tab_")) {
		return "required";
	}
	return "active";
}

export function inferEndpoint(owner: ExecutionContextId): Route["endpoint"] {
	if (owner === "content-script") {
		return "content-script";
	}
	if (owner === "main-thread") {
		return "main-thread";
	}
	if (owner === "worker") {
		return "worker:default";
	}
	return owner.startsWith("worker:")
		? (owner as Route["endpoint"])
		: "main-thread";
}

export function inferOwner(
	action: string,
	owner: ExecutionContextId,
): ExecutionContextId {
	if (owner !== "main-thread") {
		return owner;
	}
	if (isContentScriptAction(action)) {
		return "content-script";
	}
	return owner;
}

export function routeFromOwner(
	action: string,
	owner: ExecutionContextId,
): Route {
	return {
		endpoint: inferEndpoint(inferOwner(action, owner)),
		tabPolicy: inferTabPolicy(action),
	};
}

export function populateRoutesFromManifest(
	entries: Array<{ action: string; owner: ExecutionContextId }>,
): void {
	for (const entry of entries) {
		setRoute(entry.action, routeFromOwner(entry.action, entry.owner));
	}
}
