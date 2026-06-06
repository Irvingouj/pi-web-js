import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import path from "path";

export default defineConfig({
	base: "./",
	build: {
		outDir: "pkg",
		emptyOutDir: false,
		assetsDir: ".",
		rollupOptions: {
			input: path.resolve(__dirname, "src/content-script/index.ts"),
			output: {
				entryFileNames: "content-script.js",
				format: "iife",
			},
		},
	},
	plugins: [
		dts({
			include: ["src/content-script/index.ts"],
			exclude: ["./vitest.config.ts"],
			entryRoot: "src/content-script",
		}),
	],
});
