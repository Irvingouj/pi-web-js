#!/usr/bin/env node
import { transformSync } from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicE2eDir = path.join(rootDir, "public", "e2e");

const FIXTURE_ORIGIN = "https://extension-js.test";
const FIXTURE_URL = `${FIXTURE_ORIGIN}/fixture`;

const contractSrc = path.join(
	rootDir,
	"tests/e2e/extension/contract/all-apis-extension-contract.js",
);
const runnerSrc = path.join(
	rootDir,
	"tests/e2e/extension/fixtures/contract-batch-runner.js",
);

fs.mkdirSync(publicE2eDir, { recursive: true });

let contract = fs.readFileSync(contractSrc, "utf8");
contract = contract
	.replace(
		'const TEST_URL = "https://example.com/";',
		`const TEST_URL = "${FIXTURE_URL}";`,
	)
	.replace(/https:\/\/example\.com/g, FIXTURE_ORIGIN);

/** QuickJS supports async/await; lower optional chaining + object spread. */
const QUICKJS_SUPPORTED = {
	"async-await": true,
	"async-generator": true,
	"for-await": true,
	class: true,
	arrow: true,
	destructuring: true,
	"const-and-let": true,
	"template-literal": true,
};

function transpileForQuickJS(source) {
	return transformSync(source, { target: "es2015", supported: QUICKJS_SUPPORTED })
		.code;
}

contract = transpileForQuickJS(contract);

let runner = fs.readFileSync(runnerSrc, "utf8");
runner = transpileForQuickJS(runner);

fs.writeFileSync(
	path.join(publicE2eDir, "all-apis-extension-contract.js"),
	contract,
);
fs.writeFileSync(path.join(publicE2eDir, "contract-batch-runner.js"), runner);

const returnOneSrc = path.join(rootDir, "tests/e2e/extension/fixtures/return-one.js");
fs.copyFileSync(returnOneSrc, path.join(publicE2eDir, "return-one.js"));

console.log("Copied e2e contract assets → public/e2e/");
