import { ExtensionSession, setLogLevel } from "@pi-oxide/extension-js";
import { useCallback, useRef, useState } from "preact/hooks";
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
				w.__jsNotebookSetLogLevel = setLogLevel;
				w.__extensionSession = session;
				setLogLevel("info");
				const e2eLog = new URLSearchParams(window.location.search).get(
					"e2e_log",
				);
				if (
					e2eLog === "debug" ||
					e2eLog === "info" ||
					e2eLog === "warn" ||
					e2eLog === "error"
				) {
					setLogLevel(e2eLog);
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
