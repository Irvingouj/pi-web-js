import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e/extension",
	testMatch: "**/*.spec.ts",
	fullyParallel: false,
	workers: 1,
	// Extension launch + WASM init + first async cell can exceed 10s.
	timeout: 60_000,
	expect: {
		timeout: 5_000,
	},
	use: {
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
});
