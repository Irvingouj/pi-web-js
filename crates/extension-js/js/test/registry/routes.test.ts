// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import {
	addContentScriptAction,
	clearContentScriptActions,
} from "../../src/shared/cross/content-script-actions.js";
import {
	clearRoutes,
	inferTabPolicy,
	populateRoutesFromManifest,
	routeFromOwner,
} from "../../src/shared/main/routes.js";

describe("registry routes", () => {
	beforeEach(() => {
		clearRoutes();
		clearContentScriptActions();
	});

	it("inferTabPolicy requires tabId for tab_* actions", () => {
		expect(inferTabPolicy("tab_click")).toBe("required");
		expect(inferTabPolicy("page_click")).toBe("active");
	});

	it("routeFromOwner rewrites main-thread page actions to content-script", () => {
		addContentScriptAction("page_click");
		const route = routeFromOwner("page_click", "main-thread");
		expect(route.endpoint).toBe("content-script");
		expect(route.tabPolicy).toBe("active");
	});

	it("populateRoutesFromManifest registers manifest owners", () => {
		populateRoutesFromManifest([
			{ action: "sidepanel_url", owner: "main-thread" },
			{ action: "tab_click", owner: "content-script" },
		]);
		const main = routeFromOwner("sidepanel_url", "main-thread");
		const tab = routeFromOwner("tab_click", "content-script");
		expect(main.endpoint).toBe("main-thread");
		expect(tab.endpoint).toBe("content-script");
		expect(tab.tabPolicy).toBe("required");
	});
});
