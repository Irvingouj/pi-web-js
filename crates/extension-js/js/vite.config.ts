import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import path from "path";

const externalize = (id: string) =>
	id === "zod" ||
	id === "@pi-oxide/dom-semantic-tree" ||
	id.endsWith("extension_js.js");

export default defineConfig({
	base: "./",
	build: {
		lib: {
			entry: path.resolve(__dirname, "index.ts"),
			formats: ["es"],
			fileName: "index",
		},
		outDir: "pkg",
		emptyOutDir: false,
		assetsDir: ".",
		rollupOptions: {
			external: externalize,
			output: {
				chunkFileNames: "[name].js",
				entryFileNames: "[name].js",
			},
		},
	},
	worker: {
		format: "es",
		rollupOptions: {
			external: externalize,
			output: {
				chunkFileNames: "[name].js",
				entryFileNames: "[name].js",
			},
		},
	},
	plugins: [
		{
			name: "external-extension-js",
			enforce: "pre",
			resolveId(id) {
				if (id.endsWith("extension_js.js")) {
					return { id, external: true };
				}
			},
		},
		dts({
			include: ["./*.ts"],
			exclude: ["./*.test.ts", "./vitest.config.ts"],
		}),
	],
});
