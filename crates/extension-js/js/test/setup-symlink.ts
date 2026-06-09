import * as fs from "node:fs";
import * as path from "node:path";

const realWasmPath = path.resolve(__dirname, "../pkg/extension_js.js");
const symlinkPath = path.resolve(__dirname, "_real_wasm.js");

if (fs.existsSync(realWasmPath) && !fs.existsSync(symlinkPath)) {
	try {
		fs.symlinkSync(path.relative(__dirname, realWasmPath), symlinkPath);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== "EEXIST") {
			throw err;
		}
	}
}
