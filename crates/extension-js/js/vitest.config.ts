import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
	},
	resolve: {
		alias: {
			"@pi-oxide/dom-semantic-tree": "./__mocks__/dom-semantic-tree.js",
		},
	},
});
