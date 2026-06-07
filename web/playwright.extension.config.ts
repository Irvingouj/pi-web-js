import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e/extension",
	testMatch: "**/*.spec.ts",
	fullyParallel: false,
	workers: 1,
	// One small assertion per test; fail fast if a cell or hook hangs.
	timeout: 10_000,
	expect: {
		timeout: 5_000,
	},
	use: {
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
});
