import type { BrowserContext, Page } from "@playwright/test";

export type ExtensionHarness = {
	context: BrowserContext;
	extensionId: string;
	sidepanel: Page;
	fixtureTab: Page;
	userDataDir: string;
	serviceWorkerErrors: string[];
	browserConsoleErrors: string[];
};

export type CellExecution<T> = {
	status: "success" | "error";
	result: T | null;
	stdout: string;
	stderr: string;
};

export type ContractResult<T = unknown> =
	| { ok: true; value: T }
	| {
			ok: false;
			error: {
				code: string;
				message: string;
				category?: string;
			};
	  };

export type ExtensionFixture = {
	extensionId: string;
	fixtureUrl: string;
	fixtureTabId: number;
	originalTabIds: number[];
	originalWindowIds: number[];
	runId: string;
};

export type ApiExpectation =
	| { kind: "success" }
	| { kind: "error"; code?: string; category?: string }
	| { kind: "permission_error"; permission: string };

export type ApiGroup =
	| "runtime"
	| "fs-path-crypto"
	| "storage-network"
	| "chrome"
	| "page-tab"
	| "sidepanel"
	| "security-errors";

export type ApiCase = {
	api: string;
	group: ApiGroup;
	destructive: boolean;
	skip: boolean;
	contractExpected: "success" | "typed_error" | "rejection";
	expectedCode: string;
	expectation: ApiExpectation;
	source: (fixture: ExtensionFixture) => string;
	assert: (
		execution: CellExecution<ContractResult>,
		harness: ExtensionHarness,
		fixture: ExtensionFixture,
	) => Promise<void>;
};

export type ContractItemMeta = {
	action: string;
	context: string;
	destructive: boolean;
	requiresFixture: string;
	skip: boolean;
	expected: "success" | "typed_error" | "rejection";
	expectedCode: string;
};
