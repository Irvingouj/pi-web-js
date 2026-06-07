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

type WebSessionModule = typeof import("@pi-oxide/web-js");
type WebSession = WebSessionModule["WebSession"];

let globalSession: InstanceType<WebSession> | null = null;
let globalRunner: Promise<void> | null = null;
let initPromise: Promise<InstanceType<WebSession>> | null = null;

async function ensureSession(): Promise<InstanceType<WebSession>> {
	if (globalSession) return globalSession;
	if (!initPromise) {
		initPromise = import("@pi-oxide/web-js").then(({ WebSession }) =>
			WebSession.init().then(([session, runner]) => {
				globalSession = session;
				globalRunner = runner;
				return session;
			}),
		);
	}
	return initPromise;
}

export function useKernel(
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

	const kernel = {
		status,
		runCell,
		stopExecution,
		restartKernel,
		session: globalSession,
	};
	if (typeof window !== "undefined") {
		(window as any).__kernel = kernel;
	}

	return kernel;
}
