import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	test: {
		environment: "jsdom",
	},
	resolve: {
		alias: {
			"@pi-oxide/dom-semantic-tree": "./__mocks__/dom-semantic-tree.js",
			"./extension_js.js": path.resolve(__dirname, "./__mocks__/extension_js.ts"),
		},
	},
});
