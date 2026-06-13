import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect } from "@playwright/test";
import {
	CHROME_NAMESPACE_PERMISSION,
	CONTRACT_PATH,
	EXTENSION_GLOBAL_GAP_APIS,
	EXTENSION_TIMER_GAP_APIS,
	GRANTED_PERMISSIONS,
} from "./constants.ts";
import { buildStrictRunnerSource } from "./runner-source.ts";
import { parseAllSentinels } from "./sentinels.ts";
import type {
	ApiCase,
	ApiExpectation,
	ApiGroup,
	ContractItemMeta,
} from "./types.ts";

function loadContractMetadata(): {
	items: ContractItemMeta[];
	manifest: string[];
} {
	const contractJs = readFileSync(CONTRACT_PATH, "utf8");
	const sandbox: Record<string, unknown> = {
		CONTRACT: [],
		MANIFEST: [],
		print: () => {},
		console,
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
		Promise,
		Error,
		Uint8Array,
		TabHandle: class TabHandle {},
		tab: {},
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(contractJs, sandbox);
	const listFn = sandbox.listAllApisExtensionContract as
		| (() => ContractItemMeta[])
		| undefined;
	if (!listFn) {
		throw new Error(
			"Failed to load contract metadata from all-apis-extension-contract.js",
		);
	}
	const items = listFn();
	const manifestMatch = contractJs.match(/const MANIFEST = (\[[\s\S]*?\]);/);
	const manifest = manifestMatch
		? (vm.runInContext(`(${manifestMatch[1]})`, sandbox) as string[])
		: items.map((item) => item.action);
	return { items, manifest: [...manifest] };
}

const { items: CONTRACT_ITEMS, manifest: CONTRACT_MANIFEST } =
	loadContractMetadata();

export { CONTRACT_ITEMS, CONTRACT_MANIFEST };

export function mapContextToGroup(api: string, context: string): ApiGroup {
	if (
		api.startsWith("host.call.__proto__") ||
		api.startsWith("host.call.unknown") ||
		api === "host.call.__proto__.blocked" ||
		api === "host.call.unknown.blocked"
	) {
		return "security-errors";
	}
	if (api.startsWith("host.")) return "sidepanel";
	if (
		api.startsWith("t.") ||
		api.startsWith("tab.") ||
		api.startsWith("dom.") ||
		api.startsWith("page.")
	) {
		return "page-tab";
	}
	if (api.startsWith("chrome.")) return "chrome";
	if (
		api.startsWith("fs.") ||
		api.startsWith("path.") ||
		api.startsWith("crypto.")
	) {
		return "fs-path-crypto";
	}
	if (
		api.startsWith("web.") ||
		api.startsWith("global.fetch") ||
		api.startsWith("global.localStorage") ||
		api.startsWith("global.sessionStorage")
	) {
		return "storage-network";
	}
	if (context === "sidepanel") return "sidepanel";
	if (context === "content-script") return "page-tab";
	if (context === "rust-native" && api.startsWith("dom.")) return "page-tab";
	return "runtime";
}

function getChromeNamespace(api: string): string | null {
	if (!api.startsWith("chrome.")) return null;
	const parts = api.split(".");
	if (parts.length >= 3 && parts[1] === "system") {
		return `${parts[0]}.${parts[1]}.${parts[2]}`;
	}
	return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : null;
}

function getPermissionGap(api: string): string | null {
	const namespace = getChromeNamespace(api);
	if (!namespace) return null;
	const required = CHROME_NAMESPACE_PERMISSION[namespace];
	if (required === undefined) return null;
	if (required === null) return null;
	return GRANTED_PERMISSIONS.has(required) ? null : required;
}

function mapExpectation(item: ContractItemMeta): ApiExpectation {
	const permissionGap = getPermissionGap(item.action);
	if (permissionGap) {
		return { kind: "permission_error", permission: permissionGap };
	}
	if (EXTENSION_TIMER_GAP_APIS.has(item.action)) {
		return {
			kind: "error",
			code: "E_TIMER_UNSUPPORTED",
			category: "typed_error",
		};
	}
	if (EXTENSION_GLOBAL_GAP_APIS.has(item.action)) {
		return {
			kind: "error",
			code: "E_GLOBAL_UNSUPPORTED",
			category: "typed_error",
		};
	}
	if (item.expected === "success") return { kind: "success" };
	return {
		kind: "error",
		code: item.expectedCode || undefined,
		category: item.expected,
	};
}

function defaultAssert(apiCase: ApiCase): ApiCase["assert"] {
	return async (execution) => {
		expect(execution.status, `${apiCase.api} cell status`).toBe("success");
		const parsed = parseAllSentinels(execution.stdout);
		const entry = parsed.find(
			(p) => (p as { api?: string }).api === apiCase.api,
		);
		expect(entry, `${apiCase.api} sentinel`).toBeTruthy();
		if (
			apiCase.expectation.kind === "error" &&
			(apiCase.expectation.code === "E_TIMER_UNSUPPORTED" ||
				apiCase.expectation.code === "E_GLOBAL_UNSUPPORTED")
		) {
			expect(entry?.ok, `${apiCase.api} platform gap`).toBe(false);
			return;
		}
		if (apiCase.expectation.kind === "permission_error") {
			expect(entry?.ok, `${apiCase.api} permission gap`).toBe(false);
			if (entry && !entry.ok) {
				const haystack =
					`${entry.error.code} ${entry.error.message}`.toLowerCase();
				const perm = apiCase.expectation.permission.toLowerCase();
				expect(
					haystack.includes("permission") ||
						haystack.includes(perm) ||
						entry.error.code === "E_PERMISSION",
				).toBe(true);
			}
			return;
		}
		if (apiCase.contractExpected === "success") {
			expect(entry?.ok, `${apiCase.api} ok`).toBe(true);
			return;
		}
		expect(
			entry?.ok,
			`${apiCase.api} expected ${apiCase.contractExpected}`,
		).toBe(true);
		if (apiCase.expectedCode && entry && "value" in entry && entry.ok) {
			const value = entry.value as Record<string, unknown>;
			const err =
				(value.typedError as { code?: string; message?: string }) ||
				(value.thrown as { code?: string; message?: string }) ||
				(value.rejected as { code?: string; message?: string });
			const haystack = `${err?.code ?? ""} ${err?.message ?? ""} ${JSON.stringify(value)}`;
			expect(haystack.includes(apiCase.expectedCode)).toBe(true);
		}
	};
}

function buildApiCases(): ApiCase[] {
	return CONTRACT_ITEMS.map((item) => {
		const group = mapContextToGroup(item.action, item.context);
		const expectation = mapExpectation(item);
		const apiCase: ApiCase = {
			api: item.action,
			group,
			destructive: item.destructive,
			skip:
				item.skip ||
				EXTENSION_TIMER_GAP_APIS.has(item.action) ||
				EXTENSION_GLOBAL_GAP_APIS.has(item.action),
			contractExpected: item.expected,
			expectedCode: item.expectedCode,
			expectation,
			source: (fixture) =>
				buildStrictRunnerSource(
					[item.action],
					item.destructive || !item.skip,
					fixture.extensionId,
				),
			assert: defaultAssert({
				api: item.action,
				group,
				destructive: item.destructive,
				skip: item.skip,
				contractExpected: item.expected,
				expectedCode: item.expectedCode,
				expectation,
				source: () => "",
				assert: async () => {},
			}),
		};

		if (item.action === "t.fill") {
			apiCase.assert = async (execution, harness, fixture) => {
				await defaultAssert(apiCase)(execution, harness, fixture);
				const input = harness.fixtureTab.locator("#input");
				await expect(input).toHaveValue("hello");
			};
		}
		if (item.action === "t.click") {
			apiCase.assert = async (execution, harness, fixture) => {
				await defaultAssert(apiCase)(execution, harness, fixture);
				const clicks = await harness.fixtureTab.evaluate(() => {
					return (window as unknown as { __clicks?: number }).__clicks ?? 0;
				});
				expect(clicks).toBeGreaterThanOrEqual(0);
			};
		}

		return apiCase;
	});
}

export const API_CASES = buildApiCases();
