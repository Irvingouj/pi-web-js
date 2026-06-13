import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e/web",
	timeout: 30_000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		baseURL: "http://127.0.0.1:5173",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
		headless: true,
	},
	webServer: {
		command: "npm run dev -- --host 127.0.0.1 --port 5173 --no-open",
		url: "http://127.0.0.1:5173",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
