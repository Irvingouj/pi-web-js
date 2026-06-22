// @vitest-environment jsdom
// Regression: refindByFingerprint must NOT rebind a refId to a different
// element that merely shares the same role. Only role+name exact match is
// safe. Role-only or tag+role fallback is forbidden.

import { describe, it, expect, beforeEach } from "vitest";
import { resetLease, grantObservation, requireTarget } from "../src/content-script/observation-lease.js";

describe("refind safety regression", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		resetLease();
	});

	it("disconnected target with same-role different-name element throws E_STALE, does not rebind", () => {
		const target = document.createElement("button");
		target.setAttribute("role", "button");
		target.setAttribute("aria-label", "Submit");
		target.setAttribute("data-ref-id", "r1");
		document.body.appendChild(target);

		const decoy = document.createElement("div");
		decoy.setAttribute("role", "button");
		decoy.setAttribute("aria-label", "Cancel");
		document.body.appendChild(decoy);

		grantObservation([{ refId: "r1", element: target }]);
		target.remove();

		expect(() => requireTarget("r1", "click")).toThrow();
		try {
			requireTarget("r1", "click");
		} catch (e) {
			const err = e as Error & { code?: string };
			expect(err.code).toBe("E_STALE");
		}
	});
});
