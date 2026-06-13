// Loaded by extension e2e through dist assets + eval (extension QuickJS context).

function ensureContractLoaded(contractSource) {
	if (typeof globalThis.__contractItems === "undefined") {
		eval(contractSource);
	}
}

function typedFromThrown(err) {
	const msg = err?.message ? err.message : String(err);
	const codeMatch = msg.match(/^([A-Z][A-Z_0-9]+)/);
	return {
		ok: false,
		error: {
			message: msg,
			code: codeMatch ? codeMatch[1] : "E_UNKNOWN",
		},
	};
}

async function runContractApi(item, fx) {
	const expected = item.expected;
	const expectedCode = item.expectedCode || "";
	try {
		if (expected === "rejection") {
			try {
				await item.run(fx);
				return {
					ok: false,
					error: {
						code: "E_EXPECTED_REJECTION",
						message: `${item.action} should have rejected`,
					},
				};
			} catch (err) {
				const typed = typedFromThrown(err);
				if (
					expectedCode &&
					typed.error.code !== expectedCode &&
					!typed.error.message.includes(expectedCode)
				) {
					return {
						ok: false,
						error: {
							code: "E_WRONG_ERROR_CODE",
							message: `expected ${expectedCode} got ${typed.error.code}`,
						},
					};
				}
				return { ok: true, value: { rejected: true, code: typed.error.code } };
			}
		}

		const value = await item.run(fx);
		if (value && value.ok === false) {
			if (expected === "typed_error") {
				if (
					expectedCode &&
					value.error.code !== expectedCode &&
					!value.error.message.includes(expectedCode)
				) {
					return {
						ok: false,
						error: {
							code: "E_WRONG_ERROR_CODE",
							message: `expected ${expectedCode} got ${value.error.code}`,
						},
					};
				}
				return { ok: true, value: { typedError: value.error } };
			}
			return value;
		}

		if (expected === "typed_error") {
			return {
				ok: false,
				error: {
					code: "E_EXPECTED_TYPED_ERROR",
					message: `${item.action} should have returned typed error`,
				},
			};
		}

		return { ok: true, value };
	} catch (err) {
		if (expected === "typed_error" || expected === "rejection") {
			const typed = typedFromThrown(err);
			if (
				expectedCode &&
				typed.error.code !== expectedCode &&
				!typed.error.message.includes(expectedCode)
			) {
				return {
					ok: false,
					error: {
						code: "E_WRONG_ERROR_CODE",
						message: `expected ${expectedCode} got ${typed.error.code}`,
					},
				};
			}
			return { ok: true, value: { thrown: typed.error } };
		}
		return typedFromThrown(err);
	}
}

function clearDestructiveFixtureIds(item, fx, result) {
	if (!result?.ok) return;
	if (item.action === "chrome.tabs.remove") {
		fx.createdTabId = null;
	}
	if (item.action === "chrome.windows.remove") {
		fx.createdWindowId = null;
	}
	if (item.action === "chrome.bookmarks.remove") {
		fx.bookmarkId = "";
	}
	if (item.action === "chrome.bookmarks.removeTree") {
		fx.bookmarkFolderId = "";
	}
}

function fixtureSummary(fx) {
	return {
		ok: true,
		bookmarkId: fx.bookmarkId ? fx.bookmarkId : "",
		bookmarkFolderId: fx.bookmarkFolderId ? fx.bookmarkFolderId : "",
		createdTabId: fx.createdTabId ? fx.createdTabId : null,
		createdWindowId: fx.createdWindowId ? fx.createdWindowId : null,
		sessionId: fx.sessionId ? fx.sessionId : "",
		activeTabId: fx.active?.tabId ? fx.active.tabId : null,
	};
}

async function runChromeFixtureSetup(
	contractSource,
	runDestructive,
	fixturePrefix,
) {
	ensureContractLoaded(contractSource);
	const fx = await buildFixture(runDestructive);
	globalThis.__chromeContractFx = fx;
	print(fixturePrefix + JSON.stringify(fixtureSummary(fx)));
	return fx;
}

async function runChromeApiSingle(
	contractSource,
	apiName,
	runDestructive,
	resultPrefix,
) {
	ensureContractLoaded(contractSource);
	const fx = globalThis.__chromeContractFx;
	if (!fx) {
		print(
			resultPrefix +
				JSON.stringify({
					ok: false,
					error: {
						code: "E_NO_FIXTURE",
						message:
							"chrome fixture not initialized; run runChromeFixtureSetup first",
					},
					api: apiName,
				}),
		);
		return;
	}

	const item = globalThis.__contractItems.find((c) => c.action === apiName);
	if (!item) {
		print(
			resultPrefix +
				JSON.stringify({
					ok: false,
					error: {
						code: "E_MISSING_CASE",
						message: `missing contract item ${apiName}`,
					},
					api: apiName,
				}),
		);
		return;
	}
	if (item.skip) {
		print(
			resultPrefix +
				JSON.stringify({
					ok: false,
					error: {
						code: "E_SKIPPED",
						message: `${item.action} skipped without destructive run`,
					},
					api: apiName,
				}),
		);
		return;
	}
	if (item.destructive && !runDestructive) {
		print(
			resultPrefix +
				JSON.stringify({
					ok: false,
					error: {
						code: "E_DESTRUCTIVE_SKIPPED",
						message: `${item.action} requires destructive run`,
					},
					api: apiName,
				}),
		);
		return;
	}

	const result = await runContractApi(item, fx);
	print(
		resultPrefix + JSON.stringify(Object.assign({}, result, { api: apiName })),
	);
}

async function runChromeFixtureTeardown(contractSource, runDestructive) {
	ensureContractLoaded(contractSource);
	if (globalThis.__chromeContractFx) {
		await teardownFixture(globalThis.__chromeContractFx, runDestructive);
		globalThis.__chromeContractFx = null;
	}
}

async function runContractBatch(
	contractSource,
	apiNames,
	runDestructive,
	resultPrefix,
) {
	ensureContractLoaded(contractSource);

	async function emit(result) {
		print(`${resultPrefix + JSON.stringify(result)}\n`);
	}

	const fx = await buildFixture(runDestructive);
	try {
		for (const name of apiNames) {
			const item = globalThis.__contractItems.find((c) => c.action === name);
			if (!item) {
				emit({
					ok: false,
					error: {
						code: "E_MISSING_CASE",
						message: `missing contract item ${name}`,
					},
					api: name,
				});
				continue;
			}
			if (item.skip) {
				emit({
					ok: false,
					error: {
						code: "E_SKIPPED",
						message: `${item.action} skipped without destructive run`,
					},
					api: name,
				});
				continue;
			}
			if (item.destructive && !runDestructive) {
				emit({
					ok: false,
					error: {
						code: "E_DESTRUCTIVE_SKIPPED",
						message: `${item.action} requires destructive run`,
					},
					api: name,
				});
				continue;
			}
			const result = await runContractApi(item, fx);
			clearDestructiveFixtureIds(item, fx, result);
			await emit(Object.assign({}, result, { api: name }));
		}
	} finally {
		await teardownFixture(fx, runDestructive);
	}
}

globalThis.runContractBatch = runContractBatch;
globalThis.runChromeFixtureSetup = runChromeFixtureSetup;
globalThis.runChromeApiSingle = runChromeApiSingle;
globalThis.runChromeFixtureTeardown = runChromeFixtureTeardown;
