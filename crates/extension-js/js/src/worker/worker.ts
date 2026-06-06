// Web Worker for extension-js
// Loads extension-js WASM and communicates with main thread.

import init, {
  ExtensionSession,
  registerJsCallBatch as register_js_call_batch,
  setLogLevel as setWasmLogLevel,
} from "../../pkg/extension_js.js";
import type { FsAction, FsActionMap } from "../shared/fs-types.js";
import type { LogLevel } from "../shared/logger.js";
import { logger, registerWasmSetLogLevel, setLogLevel } from "../shared/logger.js";
import type { DispatchContext } from "../shared/registry/types.js";
import { getRoute } from "../shared/registry/routes.js";
import { populateRoutesFromManifest } from "../shared/registry/routes.js";
import {
  coerceWasmParams,
  manifestEntryToWasm,
  type SerializableJsCallManifestEntry,
} from "../shared/tool-registry.js";

let session: ExtensionSession | null = null;
let initialized = false;
const pendingRelays = new Map<
  string,
  {
    settle: (result: unknown) => void;
    timeoutId: ReturnType<typeof setTimeout>;
    abort?: () => void;
    owner: string;
    port: RelayPort;
  }
>();

type RelayPort = {
  postMessage(message: unknown): void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent) => void,
  ) => void;
  start?: () => void;
};

function safePortPost(port: RelayPort, message: unknown): boolean {
  try {
    port.postMessage(message);
    return true;
  } catch (error: unknown) {
    const messageText = error instanceof Error ? error.message : String(error);
    logger.error("port_post_failed", { error: messageText });
    return false;
  }
}

const MAX_PENDING_RELAYS = 1000;

function cancelRemoteRelay(relayId: string, owner: string, port: RelayPort): void {
  if (owner === "main-thread" || owner === "content-script") {
    safePortPost(port, { type: "relayCancel", id: relayId, owner });
  } else {
    safePortPost(port, { type: "registryCallCancel", id: relayId });
  }
}

export function settleAllPendingRelays(code: string, message: string): void {
  for (const [relayId, pending] of pendingRelays) {
    clearTimeout(pending.timeoutId);
    cancelRemoteRelay(relayId, pending.owner, pending.port);
    pending.settle({
      ok: false,
      error: { message, code },
    });
    pendingRelays.delete(relayId);
  }
}

// Worker-local registry for handlers that execute in the same worker as the VM
const workerHandlerRegistry = new Map<string, (params: unknown, context?: unknown) => Promise<unknown>>();
const runAbortControllers = new Map<string, AbortController>();

export function registerWorkerHandler(
  action: string,
  handler: (params: unknown, context?: unknown) => Promise<unknown>,
): void {
  workerHandlerRegistry.set(action, handler);
}

function generateId(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function mapNumericLevel(level: number): LogLevel {
  if (level <= 0) return "debug";
  if (level === 1) return "info";
  if (level === 2) return "warn";
  if (level === 3) return "error";
  return "none";
}

const workerPortRegistry = new Map<string, RelayPort>();
const portInFlightCalls = new Map<string, AbortController>();

export function registerWorkerPort(owner: string, port: RelayPort): void {
  if (workerPortRegistry.has(owner)) {
    throw new Error(`Worker port already registered for owner: ${owner}`);
  }
  if (typeof port.addEventListener !== "function") {
    throw new Error(`Worker port for owner "${owner}" cannot receive responses`);
  }
  workerPortRegistry.set(owner, port);
  port.addEventListener("message", async (event: MessageEvent) => {
    const message = event.data as Record<string, unknown> | null;
    if (
      message !== null &&
      (message.type === "asyncRelayResult" || message.type === "registryCallResult") &&
      typeof message.id === "string"
    ) {
      resolveAsyncRelayResult(message.id, message.result);
      return;
    }
    if (
      message !== null &&
      message.type === "registryCallCancel" &&
      typeof message.id === "string"
    ) {
      portInFlightCalls.get(message.id)?.abort();
      portInFlightCalls.delete(message.id);
      return;
    }
    if (
      message !== null &&
      message.type === "registryCall" &&
      typeof message.id === "string" &&
      typeof message.action === "string"
    ) {
      const callId = message.id;
      const callAbort = new AbortController();
      portInFlightCalls.set(callId, callAbort);
      const handler = workerHandlerRegistry.get(message.action);
      let result: unknown;
      if (!handler) {
        result = {
          ok: false,
          error: { message: `Unknown worker action: ${message.action}`, code: "E_UNKNOWN" },
        };
      } else {
        try {
          const value = await handler(message.params, {
            action: message.action,
            callId: message.callId,
            runId: message.runId,
            signal: callAbort.signal,
          });
          result = callAbort.signal.aborted
            ? { ok: false, error: { message: "Relay aborted", code: "E_ABORT" } }
            : { ok: true, value };
        } catch (error: unknown) {
          result = {
            ok: false,
            error: {
              message: error instanceof Error ? error.message : String(error),
              code: callAbort.signal.aborted ? "E_ABORT" : "E_WORKER_HANDLER",
            },
          };
        }
      }
      portInFlightCalls.delete(callId);
      if (!safePortPost(port, { type: "registryCallResult", id: callId, result })) {
        resolveAsyncRelayResult(callId, {
          ok: false,
          error: { message: "Failed to deliver worker handler response", code: "E_PORT" },
        });
      }
    }
  });
  port.start?.();
}

export function resolveAsyncRelayResult(id: string, result: unknown): boolean {
  const pending = pendingRelays.get(id);
  if (pending) {
    pending.settle(result);
    return true;
  }
  logger.warn("asyncRelayResult_no_pending_relay", { id });
  return false;
}

function resolvePort(owner: string): RelayPort | null {
  if (owner === "main-thread" || owner === "content-script") {
    return self;
  }
  const port = workerPortRegistry.get(owner);
  if (port) {
    return port;
  }
  return null;
}

export function safePostAsCall(options: {
  owner: string;
  action: string;
  timeoutMs: number;
  tabPolicy?: string;
}): (params: unknown, context?: { callId?: number; runId?: string; signal?: AbortSignal }) => Promise<unknown> {
  const { owner, action, timeoutMs, tabPolicy } = options;
  return (params: unknown, context?) => {
    return new Promise((resolve, reject) => {
      if (context?.signal?.aborted) {
        const abortError = new Error(`Relay aborted for action: ${action}`);
        (abortError as Error & { code: string }).code = "E_ABORT";
        reject(abortError);
        return;
      }
      const port = resolvePort(owner);
      if (!port) {
        reject(new Error(`No port available for action: ${action}`));
        return;
      }
      if (pendingRelays.size >= MAX_PENDING_RELAYS) {
        reject(new Error(
          `Too many pending calls (${MAX_PENDING_RELAYS} limit exceeded). ` +
          `Action: ${action}`
        ));
        return;
      }
      const relayId = generateId();
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (context?.signal) {
          context.signal.removeEventListener("abort", onAbort);
        }
        pendingRelays.delete(relayId);
        fn();
      };

      const cancelRemoteExecution = () => {
        cancelRemoteRelay(relayId, owner, port);
      };

      const onAbort = () => {
        cancelRemoteExecution();
        const abortError = new Error(`Relay aborted for action: ${action}`);
        (abortError as Error & { code: string }).code = "E_ABORT";
        settle(() => reject(abortError));
      };

      if (context?.signal) {
        context.signal.addEventListener("abort", onAbort);
      }

      const timeoutId = setTimeout(() => {
        cancelRemoteExecution();
        settle(() => reject(new Error(`Relay timeout for action: ${action}`)));
      }, timeoutMs);

      pendingRelays.set(relayId, {
        settle: (result: unknown) => settle(() => resolve(result)),
        timeoutId,
        abort: onAbort,
        owner,
        port,
      });
      const runId = context?.runId;
      const callId = context?.callId;
      if (
        !safePortPost(port, {
          type: owner === "main-thread" || owner === "content-script"
            ? "asyncRelay"
            : "registryCall",
          id: relayId,
          owner,
          action,
          params,
          callId,
          tabPolicy,
          command: { action, params, runId, callId },
          runId,
        })
      ) {
        settle(() => reject(new Error(`Failed to post relay for action: ${action}`)));
      }
    });
  };
}

const WORKER_CONTEXT_ID = "worker";
const DEFAULT_RELAY_TIMEOUT_MS = 30_000;

export function extensionDispatch(
  params: unknown,
  context?: DispatchContext,
): Promise<unknown> {
  params = coerceWasmParams(params);
  const action = context?.action;
  if (!action) {
    return Promise.resolve({
      ok: false,
      error: { message: "Missing action in dispatch context", code: "E_MISSING_ACTION" },
    });
  }

  if (workerHandlerRegistry.has(action)) {
    const handler = workerHandlerRegistry.get(action)!;
    const signal = context?.signal ?? (
      context?.runId ? runAbortControllers.get(context.runId)?.signal : undefined
    );
    return (async () => {
      try {
        const value = await handler(params, { ...context, signal });
        return { ok: true, value };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const code = typeof error === "object" && error !== null &&
          "code" in error && typeof error.code === "string"
          ? error.code
          : "E_WORKER_HANDLER";
        return { ok: false, error: { message, code } };
      }
    })();
  }

  const route = getRoute(action);
  if (!route) {
    return Promise.resolve({
      ok: false,
      error: { message: `No route registered for action: ${action}`, code: "E_NO_ROUTE" },
    });
  }

  const remoteCall = safePostAsCall({
    owner: route.endpoint,
    action,
    timeoutMs: DEFAULT_RELAY_TIMEOUT_MS,
    tabPolicy: route.tabPolicy,
  });
  return remoteCall(params, {
    ...context,
    signal: context?.signal ?? (
      context?.runId ? runAbortControllers.get(context.runId)?.signal : undefined
    ),
  });
}

export function createExecutableCallback(entry: SerializableJsCallManifestEntry): (params: unknown, context?: { callId?: number; runId?: string; signal?: AbortSignal }) => Promise<unknown> {
  if (entry.owner === WORKER_CONTEXT_ID) {
    // Same worker - look up handler from worker-local registry
    const handler = workerHandlerRegistry.get(entry.action);
    if (!handler) {
      throw new Error(
        `No worker-local handler registered for action: ${entry.action}`
      );
    }
    return async (params, context) => {
      const signal = context?.signal ?? (
        context?.runId ? runAbortControllers.get(context.runId)?.signal : undefined
      );
      try {
        const value = await handler(params, { ...context, action: entry.action, signal });
        return { ok: true, value };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const code = typeof error === "object" && error !== null &&
          "code" in error && typeof error.code === "string"
          ? error.code
          : entry.errorCode;
        return { ok: false, error: { message, code } };
      }
    };
  } else {
    // Remote context (main thread, another worker, etc.)
    const remoteCall = safePostAsCall({
      owner: entry.owner,
      action: entry.action,
      timeoutMs: DEFAULT_RELAY_TIMEOUT_MS,
    });
    return (params, context) => remoteCall(params, {
      ...context,
      signal: context?.signal ?? (
        context?.runId ? runAbortControllers.get(context.runId)?.signal : undefined
      ),
    });
  }
}

function initFsRegistry(s: ExtensionSession) {
  registerWorkerHandler("exists", (p) => s.fsExists(p as FsActionMap["exists"]["params"]));
  registerWorkerHandler("stat", (p) => s.fsStat(p as FsActionMap["stat"]["params"]));
  registerWorkerHandler("read", (p) => s.fsRead(p as FsActionMap["read"]["params"]));
  registerWorkerHandler("readText", (p) => s.fsReadText(p as FsActionMap["readText"]["params"]));
  registerWorkerHandler("readBase64", (p) => s.fsReadBase64(p as FsActionMap["readBase64"]["params"]));
  registerWorkerHandler("list", (p) => s.fsList(p as FsActionMap["list"]["params"]));
  registerWorkerHandler("mkdir", (p) => s.fsMkdir(p as FsActionMap["mkdir"]["params"]));
  registerWorkerHandler("delete", (p) => s.fsDelete(p as FsActionMap["delete"]["params"]));
  registerWorkerHandler("copy", (p) => s.fsCopy(p as FsActionMap["copy"]["params"]));
  registerWorkerHandler("move", (p) => s.fsMove(p as FsActionMap["move"]["params"]));
  registerWorkerHandler("write", (p) => s.fsWrite(p as FsActionMap["write"]["params"]));
  registerWorkerHandler("writeText", (p) => s.fsWriteText(p as FsActionMap["writeText"]["params"]));
  registerWorkerHandler("writeBase64", (p) => s.fsWriteBase64(p as FsActionMap["writeBase64"]["params"]));
  registerWorkerHandler("append", (p) => s.fsAppend(p as FsActionMap["append"]["params"]));
  registerWorkerHandler("appendText", (p) => s.fsAppendText(p as FsActionMap["appendText"]["params"]));
  registerWorkerHandler("appendBase64", (p) => s.fsAppendBase64(p as FsActionMap["appendBase64"]["params"]));
  registerWorkerHandler("readRange", (p) => s.fsReadRange(p as FsActionMap["readRange"]["params"]));
  registerWorkerHandler("update", (p) => s.fsUpdate(p as FsActionMap["update"]["params"]));
  registerWorkerHandler("hash", (p) => s.fsHash(p as FsActionMap["hash"]["params"]));
}

async function initWasm(manifest: SerializableJsCallManifestEntry[]) {
  if (initialized) return;
  await init();
  session = new ExtensionSession();
  const DEFAULT_WASM_LOG_LEVEL = 3;
  setWasmLogLevel(DEFAULT_WASM_LOG_LEVEL);
  registerWasmSetLogLevel(setWasmLogLevel);
  initFsRegistry(session);

  populateRoutesFromManifest(manifest);

  const batch = manifest.map((entry) => ({
    entry: manifestEntryToWasm(entry),
    callback: createExecutableCallback(entry),
  }));
  try {
    register_js_call_batch(batch);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Registry registration failed: ${message}`);
  }

  // Freeze the Rust registry before injecting bindings
  const { freezeManifest } = await import("../../pkg/extension_js.js");
  freezeManifest();

  // Inject bindings after all manifest entries are registered
  session.injectRegistryBindings();
  initialized = true;
}

export type WorkerMessage =
  | { type: "init"; manifest: SerializableJsCallManifestEntry[] }
  | { type: "runCell"; id: string; code: string; stdin: string; runId?: string }
  | { type: "reset"; id?: string }
  | { type: "stop"; id: string }
  | { type: "setFuelLimit"; id?: string; limit: number }
  | { type: "inspectGlobals"; id: string }
  | { type: "loadLibrary"; id: string; source: string }
  | { type: "fsCall"; id: string; action: string; params: unknown }
  | { type: "setLogLevel"; level: number }
  | { type: "asyncRelayResult"; id: string; result: unknown }
  | { type: "registerWorkerPort"; owner: string };

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === "asyncRelayResult") {
    resolveAsyncRelayResult(msg.id, msg.result);
    return;
  }

  if (msg.type === "registerWorkerPort") {
    const port = e.ports[0];
    if (!port) {
      logger.error("register_worker_port_missing", { owner: msg.owner });
      return;
    }
    registerWorkerPort(msg.owner, port);
    return;
  }

  if (msg.type === "init") {
    try {
      await initWasm(msg.manifest);
      self.postMessage({ type: "ready" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("worker_init_failed", { error: message });
      self.postMessage({ type: "error", error: `WASM init failed: ${message}` });
    }
    return;
  }

  if (msg.type === "setLogLevel") {
    setWasmLogLevel(msg.level);
    setLogLevel(mapNumericLevel(msg.level));
    logger.debug("set_log_level", { level: msg.level });
    return;
  }

  if (!initialized || !session) {
    self.postMessage({
      type: "error",
      id: msg.id,
      error: "WASM not initialized",
    });
    return;
  }

  switch (msg.type) {
    case "runCell": {
      const runId = msg.runId;
      const runAbortController = new AbortController();
      if (runId) runAbortControllers.set(runId, runAbortController);
      try {
        const result = await session.runCellAsync(
          msg.code,
          msg.stdin || "",
          runId || "", // propagate correlation ID to WASM so trace spans can be linked end-to-end
        );
        self.postMessage({
          type: "result",
          id: msg.id,
          data: result,
          runId,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("runCell_error", { runId, error: message });
        self.postMessage({
          type: "error",
          id: msg.id,
          error: message,
          runId,
        });
      } finally {
        if (runId) runAbortControllers.delete(runId);
      }
      break;
    }
    case "reset": {
      session.setAborted(true);
      for (const controller of runAbortControllers.values()) controller.abort();
      runAbortControllers.clear();
      settleAllPendingRelays("E_RESET", "Worker reset");
      try {
        session.reset();
        self.postMessage({ type: "result", id: msg.id, data: { ok: true } });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        self.postMessage({ type: "error", id: msg.id, error: message });
      }
      break;
    }
    case "stop": {
      session.setAborted(true);
      for (const controller of runAbortControllers.values()) controller.abort();
      runAbortControllers.clear();
      settleAllPendingRelays("E_STOPPED", "Worker stopped");
      self.postMessage({ type: "result", id: msg.id, data: { ok: true } });
      break;
    }
    case "setFuelLimit": {
      try {
        session.set_fuel_limit(msg.limit);
        if (msg.id) {
          self.postMessage({ type: "result", id: msg.id, data: { ok: true } });
        }
      } catch (err: unknown) {
        if (msg.id) {
          const message = err instanceof Error ? err.message : String(err);
          self.postMessage({ type: "error", id: msg.id, error: message });
        }
      }
      break;
    }
    case "inspectGlobals": {
      try {
        const snap = session.inspect_globals();
        self.postMessage({ type: "result", id: msg.id, data: snap });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        self.postMessage({ type: "error", id: msg.id, error: message });
      }
      break;
    }
    case "loadLibrary": {
      try {
        const result = session.load_library(msg.source);
        self.postMessage({ type: "result", id: msg.id, data: result });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        self.postMessage({ type: "error", id: msg.id, error: message });
      }
      break;
    }
    case "fsCall": {
      const handler = workerHandlerRegistry.get(msg.action);
      if (!handler) {
        self.postMessage({
          type: "error",
          id: msg.id,
          error: `Unknown fs action: ${msg.action}`,
        });
        break;
      }
      try {
        const result = await handler(msg.params);
        self.postMessage({ type: "result", id: msg.id, data: result });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        self.postMessage({ type: "error", id: msg.id, error: message });
      }
      break;
    }
    default: {
      const _exhaustive: never = msg;
      logger.error("unhandled_worker_message", { type: (msg as WorkerMessage).type });
      break;
    }
  }
};
