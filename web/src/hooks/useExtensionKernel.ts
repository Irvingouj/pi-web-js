import { ExtensionSession } from "@pi-oxide/extension-js";
import type { LogLevel } from "@pi-oxide/extension-js";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { WorkerRunResult } from "../types";

export type KernelStatus = "ready" | "running" | "stopped" | "error";

export interface KernelHandle {
	status: KernelStatus;
	runCell: (cellId: string, code: string, stdin: string) => void;
	stopExecution: () => void;
	restartKernel: () => void;
}

type ResultHandler = (cellId: string, data: WorkerRunResult) => void;
type ErrorHandler = (error: string) => void;

let globalSession: ExtensionSession | null = null;
let globalRunner: Promise<void> | null = null;
let initPromise: Promise<ExtensionSession> | null = null;

async function ensureSession(): Promise<ExtensionSession> {
	if (globalSession) return globalSession;
	if (!initPromise) {
		initPromise = ExtensionSession.init().then(([session, runner]) => {
			globalSession = session;
			globalRunner = runner;
			if (typeof window !== "undefined") {
				const w = window as Window & {
					__jsNotebookSetLogLevel?: (level: string) => void;
					__extensionSession?: ExtensionSession;
				};
				w.__jsNotebookSetLogLevel = (level: string) => {
					const normalized = level as LogLevel;
					session.setLogLevel(normalized);
				};
				w.__extensionSession = session;
				session.setLogLevel("trace");
				const params = new URLSearchParams(window.location.search);
				const logLevel =
					params.get("e2e_log") ?? params.get("log");
				if (
					logLevel === "trace" ||
					logLevel === "debug" ||
					logLevel === "info" ||
					logLevel === "warn" ||
					logLevel === "error"
				) {
					session.setLogLevel(logLevel);
				}
			}
			return session;
		});
	}
	return initPromise;
}

export function useExtensionKernel(
	onResult: ResultHandler,
	onError: ErrorHandler,
): KernelHandle {
	const [status, setStatus] = useState<KernelStatus>("ready");
	const onResultRef = useRef(onResult);
	const onErrorRef = useRef(onError);
	onResultRef.current = onResult;
	onErrorRef.current = onError;

	useEffect(() => {
		ensureSession().catch((err: unknown) => {
			const message = err instanceof Error ? err.message : String(err);
			onErrorRef.current(message);
			setStatus("error");
		});
	}, []);

	const runCell = useCallback((cellId: string, code: string, stdin: string) => {
		const w = typeof window !== "undefined" ? (window as any) : null;
		if (w?.__kernelRunning) {
			return;
		}
		if (w) {
			w.__kernelRunning = true;
		}
		setStatus("running");
		ensureSession()
			.then((session) => session.runCellAsync(code, stdin || ""))
			.then((result) => {
				console.log("[useExtensionKernel] result:", JSON.stringify(result));
				onResultRef.current(cellId, result);
				setStatus("ready");
			})
			.catch((err) => {
				onErrorRef.current(err.message || String(err));
				setStatus("ready");
			})
			.finally(() => {
				if (w) {
					w.__kernelRunning = false;
				}
			});
	}, []);

	const stopExecution = useCallback(() => {
		const w = typeof window !== "undefined" ? (window as any) : null;
		if (w) {
			w.__kernelRunning = false;
		}
		if (globalSession && globalRunner) {
			globalSession.stopWith(globalRunner);
			globalSession = null;
			globalRunner = null;
			initPromise = null;
		}
		setStatus("stopped");
	}, []);

	const restartKernel = useCallback(() => {
		if (globalSession) {
			globalSession.reset();
		}
		setStatus("ready");
	}, []);

	return { status, runCell, stopExecution, restartKernel };
}
