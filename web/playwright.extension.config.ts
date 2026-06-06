import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e/extension",
	testMatch: "**/*.spec.ts",
	testIgnore: "**/legacy/**",
	fullyParallel: false,
	workers: 1,
	timeout: 600_000,
	expect: {
		timeout: 30_000,
	},
	use: {
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
});
