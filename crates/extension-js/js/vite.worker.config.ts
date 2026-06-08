import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, "pkg/extension_js.js");

const externalize = (id: string) =>
	id.endsWith("extension_js.js") || id === wasmPath;

export default defineConfig({
	base: "./",
	build: {
		lib: {
			entry: path.resolve(__dirname, "src/worker/worker.ts"),
			formats: ["es"],
			fileName: () => "worker",
		},
		outDir: "pkg",
		emptyOutDir: false,
		rollupOptions: {
			external: externalize,
			output: {
				entryFileNames: "worker.js",
			},
		},
	},
	resolve: {
		alias: {
			"./extension_js.js": wasmPath,
		},
	},
	plugins: [
		{
			name: "external-extension-js-wasm",
			enforce: "pre",
			resolveId(id) {
				if (id === "./extension_js.js" || id.endsWith("extension_js.js")) {
					return { id: "./extension_js.js", external: true };
				}
			},
		},
	],
});
