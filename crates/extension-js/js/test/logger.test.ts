// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getLogLevel,
	Logger,
	registerWasmSetLogLevel,
	setLogLevel,
} from "../src/shared/logger.js";

describe("Logger", () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;
	let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		// Force extension context
		vi.stubGlobal("chrome", { runtime: { id: "test-extension-id" } });
		setLogLevel("debug");
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		registerWasmSetLogLevel(() => {});
		setLogLevel("trace");
	});

	it("TM-1: debug level logging works", () => {
		const log = new Logger("test");
		log.debug("test_event", { foo: "bar" });
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("test_event"),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("foo=bar"),
		);
	});

	it("TM-2: level gating (error blocks debug)", () => {
		setLogLevel("error");
		const log = new Logger("test");
		log.debug("test_event");
		expect(consoleLogSpy).not.toHaveBeenCalled();
		expect(consoleWarnSpy).not.toHaveBeenCalled();
		expect(consoleErrorSpy).not.toHaveBeenCalled();
	});

	it("TM-3: child namespace includes parent", () => {
		const log = new Logger("parent").child("child");
		log.info("test_event");
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("[extension-js][parent.child]"),
		);
	});

	it("TM-4: timer includes duration_ms and initial metadata", () => {
		const log = new Logger("test");
		const finish = log.timer("op", { id: 1 });
		finish({ ok: true });
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("duration_ms="),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("ok=true"),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("id=1"));
	});

	it("TM-5: safe serialization of Error", () => {
		const log = new Logger("test");
		log.error("fail", { err: new Error("boom") });
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining('"message":"boom"'),
		);
	});

	it("TM-6: circular object handling", () => {
		const log = new Logger("test");
		const obj: Record<string, unknown> = { a: 1 };
		obj.self = obj;
		log.info("test", { obj });
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("[Circular]"),
		);
	});

	it("TM-7: setLogLevel bridges to WASM when registered", () => {
		const wasmFn = vi.fn();
		registerWasmSetLogLevel(wasmFn);
		setLogLevel("info");
		expect(wasmFn).toHaveBeenCalledWith(2);
	});

	it("TM-7b: trace level maps to numeric 0", () => {
		const wasmFn = vi.fn();
		registerWasmSetLogLevel(wasmFn);
		setLogLevel("trace");
		expect(wasmFn).toHaveBeenCalledWith(0);
	});

	it("TM-8: no throw on invalid metadata (function value)", () => {
		const log = new Logger("test");
		expect(() => log.info("test", { fn: () => {} })).not.toThrow();
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("fn=[Function]"),
		);
	});

	it("TM-9: no throw on malicious metadata getter", () => {
		const log = new Logger("test");
		const obj = {};
		Object.defineProperty(obj, "bad", {
			enumerable: true,
			get() {
				throw new Error("boom");
			},
		});
		expect(() =>
			log.info("test", obj as Record<string, unknown>),
		).not.toThrow();
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("metadata=[unreadable]"),
		);
	});

	it("TM-10: timer works without performance.now", () => {
		vi.stubGlobal("performance", undefined);
		const log = new Logger("test");
		const finish = log.timer("op");
		finish();
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("duration_ms="),
		);
	});

	it("TM-11: debug level includes full Error stack", () => {
		setLogLevel("debug");
		const log = new Logger("test");
		const err = new Error("boom");
		log.debug("test", { err });
		// At debug level, the full stack is present (including second line)
		const secondLine = err.stack?.split("\n")[1];
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining(secondLine),
		);
	});

	it("TM-12: info level truncates Error stack to first line", () => {
		setLogLevel("info");
		const log = new Logger("test");
		const err = new Error("boom");
		log.info("test", { err });
		const firstLine = err.stack?.split("\n")[0];
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining(firstLine),
		);
		// Verify second line is NOT present
		const secondLine = err.stack?.split("\n")[1];
		const calls = consoleLogSpy.mock.calls;
		const hasSecondLine = calls.some((call) => call[0].includes(secondLine));
		expect(hasSecondLine).toBe(false);
	});

	it("TM-13: BigInt serialization", () => {
		const log = new Logger("test");
		log.info("test", { big: 123n });
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("big=123n"),
		);
	});

	it("TM-14: getLogLevel returns current level", () => {
		setLogLevel("warn");
		expect(getLogLevel()).toBe("warn");
	});

	it("TM-15: registerWasmSetLogLevel calls callback immediately with current level", () => {
		setLogLevel("info");
		const wasmFn = vi.fn();
		registerWasmSetLogLevel(wasmFn);
		expect(wasmFn).toHaveBeenCalledWith(2);
	});

	it("TM-16: none level blocks all output", () => {
		setLogLevel("none");
		const log = new Logger("test");
		log.error("should_not_appear");
		expect(consoleErrorSpy).not.toHaveBeenCalled();
	});

	it("TM-17: warn level uses console.warn", () => {
		const log = new Logger("test");
		log.warn("alert");
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			expect.stringContaining("alert"),
		);
	});

	it("TM-18: backward-compatible multi-arg logging", () => {
		const log = new Logger("test");
		log.debug("event", "arg1", 42, true);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("event"),
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("_args=arg1 42 true"),
		);
	});

	it("TM-19: timer respects custom level parameter", () => {
		setLogLevel("warn");
		const log = new Logger("test");
		const finish = log.timer("op", { id: 1 }, "warn");
		finish({ ok: true });
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			expect.stringContaining("duration_ms="),
		);
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			expect.stringContaining("id=1"),
		);
	});

	it("TM-21: trace level emits console.log", () => {
		setLogLevel("trace");
		const log = new Logger("test");
		log.trace("trace_event", { n: 1 });
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("trace_event"),
		);
	});
});

describe("Logger default state", () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		setLogLevel("trace");
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		// Reset to default trace for other suites
		setLogLevel("trace");
	});

	it("TM-20: level rests at trace after cleanup", () => {
		expect(getLogLevel()).toBe("trace");
		const log = new Logger("test");
		log.trace("should_appear");
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("should_appear"),
		);
		setLogLevel("error");
		log.trace("should_not_appear");
		expect(consoleLogSpy).toHaveBeenCalledTimes(1);
	});
});
