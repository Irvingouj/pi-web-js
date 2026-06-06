// @vitest-environment node

import { describe, expect, it } from "vitest";
import { CONTENT_SCRIPT_ACTIONS } from "../../src/shared/registry/content-script-actions.js";
import {
	buildContentScriptSpecs,
	buildLegacyContentScriptSpecs,
} from "../../src/content-script/schemas.js";

describe("buildContentScriptSpecs", () => {
	it("defines params and returns schemas for every routed content-script action", () => {
		const specs = buildContentScriptSpecs();
		expect(specs).toHaveLength(CONTENT_SCRIPT_ACTIONS.size);
		for (const action of CONTENT_SCRIPT_ACTIONS) {
			const spec = specs.find((entry) => entry.registryAction === action);
			expect(spec, `missing spec for ${action}`).toBeDefined();
			expect(spec?.params).toBeDefined();
			expect(spec?.returns).toBeDefined();
		}
	});
});

describe("buildLegacyContentScriptSpecs", () => {
	it("defines legacy direct-action schemas", () => {
		const specs = buildLegacyContentScriptSpecs();
		expect(specs.length).toBeGreaterThan(0);
		for (const spec of specs) {
			expect(spec.registryAction).toBeTruthy();
			expect(spec.handlerKey).toBeTruthy();
			expect(spec.params).toBeDefined();
			expect(spec.returns).toBeDefined();
		}
	});
});
