import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmMock = path.resolve(__dirname, "./__mocks__/extension_js.ts");

export default defineConfig({
	test: {
		environment: "jsdom",
	},
	plugins: [
		{
			name: "wasm-mock-alias",
			enforce: "pre",
			resolveId(id) {
				if (id.endsWith("pkg/extension_js.js") || id === "./extension_js.js") {
					return wasmMock;
				}
			},
		},
	],
	resolve: {
		alias: [
			{
				find: "@pi-oxide/dom-semantic-tree",
				replacement: path.resolve(
					__dirname,
					"./__mocks__/dom-semantic-tree.js",
				),
			},
		],
	},
});
