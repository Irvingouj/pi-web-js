import { WebSession } from "@pi-oxide/web-js";
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

let globalSession: WebSession | null = null;
let globalRunner: Promise<void> | null = null;
let initPromise: Promise<WebSession> | null = null;

async function ensureSession(): Promise<WebSession> {
  if (globalSession) return globalSession;
  if (!initPromise) {
    initPromise = WebSession.init().then(([session, runner]) => {
      globalSession = session;
      globalRunner = runner;
      return session;
    });
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
      });
  }, []);

  const stopExecution = useCallback(() => {
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
