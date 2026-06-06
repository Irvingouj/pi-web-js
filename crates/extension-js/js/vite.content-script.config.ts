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
			input: path.resolve(__dirname, "content-script.ts"),
			output: {
				entryFileNames: "content-script.js",
				format: "iife",
			},
		},
	},
	plugins: [
		dts({
			include: ["./content-script.ts"],
			exclude: ["./vitest.config.ts"],
			entryRoot: ".",
		}),
	],
});
