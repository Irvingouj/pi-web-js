"use strict";
// Web Worker for extension-js
// Loads extension-js WASM, defines __extension_js_relay, and communicates with main thread.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const extension_js_js_1 = __importStar(require("./extension_js.js"));
const logger_js_1 = require("./logger.js");
let session = null;
let initialized = false;
const pendingRelays = new Map();
function generateId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const workerSelf = self;
// Define the relay function that extension-js WASM expects globally
workerSelf.__extension_js_relay = (cmd) => {
    logger_js_1.logger.debug("[worker] __extension_js_relay cmd:", cmd?.action);
    return new Promise((resolve) => {
        const relayId = generateId();
        pendingRelays.set(relayId, resolve);
        self.postMessage({ type: "asyncRelay", id: relayId, command: cmd });
    });
};
async function initWasm() {
    if (initialized)
        return;
    await (0, extension_js_js_1.default)();
    session = new extension_js_js_1.ExtensionSession();
    (0, extension_js_js_1.setLogLevel)(3); // default "error"
    initialized = true;
}
initWasm()
    .then(() => {
    self.postMessage({ type: "ready" });
})
    .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: "error", error: `WASM init failed: ${message}` });
});
self.onmessage = async (e) => {
    const msg = e.data;
    if (msg.type === "setLogLevel") {
        (0, extension_js_js_1.setLogLevel)(msg.level);
        logger_js_1.logger.debug("[worker] WASM log level set to", msg.level);
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
            try {
                const result = await session.runCellAsync(msg.code, msg.stdin || "");
                // Ensure we send a plain serializable object through postMessage
                const plain = JSON.parse(JSON.stringify(result));
                self.postMessage({ type: "result", id: msg.id, data: plain });
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                self.postMessage({ type: "error", id: msg.id, error: message });
            }
            break;
        }
        case "reset": {
            try {
                session.reset();
                self.postMessage({ type: "result", id: msg.id, data: { ok: true } });
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                self.postMessage({ type: "error", id: msg.id, error: message });
            }
            break;
        }
        case "stop": {
            // Reject all pending async relays so their Promises don't dangle
            for (const [relayId, reject] of pendingRelays) {
                reject({
                    ok: false,
                    error: { message: "Worker stopped", code: "E_STOPPED" },
                });
                pendingRelays.delete(relayId);
            }
            self.postMessage({ type: "result", id: msg.id, data: { ok: true } });
            break;
        }
        case "setFuelLimit": {
            try {
                session.set_fuel_limit(msg.limit);
                if (msg.id) {
                    self.postMessage({ type: "result", id: msg.id, data: { ok: true } });
                }
            }
            catch (err) {
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
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                self.postMessage({ type: "error", id: msg.id, error: message });
            }
            break;
        }
        case "loadLibrary": {
            try {
                const result = session.load_library(msg.source);
                self.postMessage({ type: "result", id: msg.id, data: result });
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                self.postMessage({ type: "error", id: msg.id, error: message });
            }
            break;
        }
        case "asyncRelayResult": {
            logger_js_1.logger.debug("[worker] asyncRelayResult id:", msg.id, "result:", typeof msg.result);
            const resolve = pendingRelays.get(msg.id);
            if (resolve) {
                pendingRelays.delete(msg.id);
                resolve(msg.result);
            }
            else {
                logger_js_1.logger.warn("[worker] asyncRelayResult: no pending relay for id", msg.id);
            }
            break;
        }
    }
};
