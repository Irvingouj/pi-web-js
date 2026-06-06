// Loaded by extension-js.contract.spec.ts through dist assets + eval (extension context).
async function runContractBatch(
	contractSource,
	apiNames,
	runDestructive,
	resultPrefix,
) {
	if (typeof globalThis.__contractItems === "undefined") {
		eval(contractSource);
	}

	async function emit(result) {
		print(resultPrefix + JSON.stringify(result) + "\n");
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
							message: item.action + " should have rejected",
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
								message:
									"expected " + expectedCode + " got " + typed.error.code,
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
								message:
									"expected " + expectedCode + " got " + value.error.code,
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
						message: item.action + " should have returned typed error",
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
							message:
								"expected " + expectedCode + " got " + typed.error.code,
						},
					};
				}
				return { ok: true, value: { thrown: typed.error } };
			}
			return typedFromThrown(err);
		}
	}

	const fx = await buildFixture(runDestructive);
	try {
		for (const name of apiNames) {
			const item = __contractItems.find((c) => c.action === name);
			if (!item) {
				emit({
					ok: false,
					error: {
						code: "E_MISSING_CASE",
						message: "missing contract item " + name,
					},
					api: name,
				});
				continue;
			}
			if (item.skip && !runDestructive) {
				emit({
					ok: false,
					error: {
						code: "E_SKIPPED",
						message: item.action + " skipped without destructive run",
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
						message: item.action + " requires destructive run",
					},
					api: name,
				});
				continue;
			}
			const result = await runContractApi(item, fx);
			await emit({ ...result, api: name });
		}
	} finally {
		await teardownFixture(fx, runDestructive);
	}
}

globalThis.runContractBatch = runContractBatch;
