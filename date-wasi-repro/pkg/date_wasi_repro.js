/* @ts-self-types="./date_wasi_repro.d.ts" */

const envAllocations = new Map();
const env = {
    abort: () => { throw new Error('abort() called'); },
    printf: (...args) => { console.log(...args); return 0; },
    putchar: (c) => { console.log(String.fromCharCode(c)); return c; },
    strchr: (ptr, c) => {
        const mem = new Uint8Array(wasm.memory.buffer);
        const ch = c & 0xFF;
        while (mem[ptr]) { if (mem[ptr] === ch) return ptr; ptr++; }
        return 0;
    },
    fprintf: () => { return 0; },
    free: (ptr) => {
        if (ptr === 0) return;
        const size = envAllocations.get(ptr);
        if (size !== undefined) {
            wasm.__wbindgen_free(ptr, size, 1);
            envAllocations.delete(ptr);
        }
    },
    realloc: (ptr, newSize) => {
        if (ptr === 0) return env.malloc(newSize);
        const oldSize = envAllocations.get(ptr);
        if (oldSize !== undefined) {
            const newPtr = wasm.__wbindgen_realloc(ptr, oldSize, newSize, 1);
            envAllocations.delete(ptr);
            envAllocations.set(newPtr, newSize);
            return newPtr;
        }
        const newPtr = env.malloc(newSize);
        const mem = new Uint8Array(wasm.memory.buffer);
        mem.copyWithin(newPtr, ptr, ptr + newSize);
        return newPtr;
    },
    vsnprintf: (buf, size, fmt, ap) => {
        const str = String.fromCharCode(0);
        const bytes = new TextEncoder().encode(str);
        const written = Math.min(size - 1, bytes.length);
        const mem = new Uint8Array(wasm.memory.buffer);
        mem.set(bytes.slice(0, written), buf);
        mem[buf + written] = 0;
        return written;
    },
    clock_gettime: (clk, tp) => {
        const now = Date.now();
        const secs = Math.floor(now / 1000);
        const nsec = (now % 1000) * 1000000;
        const mem = new DataView(wasm.memory.buffer);
        mem.setInt32(tp, secs, true);
        mem.setInt32(tp + 4, nsec, true);
        return 0;
    },
    gettimeofday: (tv, tz) => {
        const now = Date.now();
        const secs = Math.floor(now / 1000);
        const usec = (now % 1000) * 1000;
        const mem = new DataView(wasm.memory.buffer);
        mem.setInt32(tv, secs, true);
        mem.setInt32(tv + 4, usec, true);
        return 0;
    },
    pthread_once: () => 0,
    pthread_mutex_init: () => 0,
    pthread_mutex_lock: () => 0,
    pthread_mutex_unlock: () => 0,
    pthread_condattr_init: () => 0,
    pthread_condattr_setclock: () => 0,
    pthread_cond_init: () => 0,
    pthread_condattr_destroy: () => 0,
    pthread_cond_destroy: () => 0,
    pthread_cond_signal: () => 0,
    pthread_cond_wait: () => 0,
    pthread_cond_timedwait: () => 0,
    snprintf: (buf, size, fmt, ...args) => {
        const str = String.fromCharCode(0);
        const bytes = new TextEncoder().encode(str);
        const written = Math.min(size - 1, bytes.length);
        const mem = new Uint8Array(wasm.memory.buffer);
        mem.set(bytes.slice(0, written), buf);
        mem[buf + written] = 0;
        return written;
    },
    isnan: (x) => (Number.isNaN(x) ? 1 : 0),
    isfinite: (x) => (Number.isFinite(x) ? 1 : 0),
    strcmp: (a, b) => {
        const mem = new Uint8Array(wasm.memory.buffer);
        while (mem[a] && mem[b] && mem[a] === mem[b]) { a++; b++; }
        return mem[a] - mem[b];
    },
    calloc: (nmemb, size) => {
        const total = nmemb * size;
        const ptr = wasm.__wbindgen_malloc(total, 1);
        new Uint8Array(wasm.memory.buffer, ptr, total).fill(0);
        envAllocations.set(ptr, total);
        return ptr;
    },
    malloc: (size) => {
        const ptr = wasm.__wbindgen_malloc(size, 1);
        envAllocations.set(ptr, size);
        return ptr;
    },
    scalbn: (x, n) => x * Math.pow(2, n),
    lrint: (x) => Math.round(x),
    isinf: (x) => (!Number.isFinite(x) && !Number.isNaN(x) ? 1 : 0),
    frexp: (x, ep) => {
        const mem = new DataView(wasm.memory.buffer);
        if (x === 0) { mem.setInt32(ep, 0, true); return 0; }
        const exp = Math.floor(Math.log2(Math.abs(x))) + 1;
        const mant = x / Math.pow(2, exp);
        mem.setInt32(ep, exp, true);
        return mant;
    },
    strrchr: (ptr, c) => {
        const mem = new Uint8Array(wasm.memory.buffer);
        const ch = c & 0xFF;
        let last = 0;
        let i = ptr;
        while (mem[i]) { if (mem[i] === ch) last = i; i++; }
        return last;
    },
    vfprintf: () => 0,
    strtod: (ptr, endptr) => {
        const mem = new Uint8Array(wasm.memory.buffer);
        let s = '';
        let i = ptr;
        while (mem[i] && mem[i] !== 0) { s += String.fromCharCode(mem[i]); i++; }
        const val = parseFloat(s);
        if (endptr) {
            const view = new DataView(wasm.memory.buffer);
            view.setInt32(endptr, i, true);
        }
        return val;
    },
    localtime_r: (timep, result) => {
        const view = new DataView(wasm.memory.buffer);
        const t = view.getInt32(timep, true);
        const d = new Date(t * 1000);
        view.setInt32(result, d.getSeconds(), true);
        view.setInt32(result + 4, d.getMinutes(), true);
        view.setInt32(result + 8, d.getHours(), true);
        view.setInt32(result + 12, d.getDate(), true);
        view.setInt32(result + 16, d.getMonth(), true);
        view.setInt32(result + 20, d.getFullYear() - 1900, true);
        view.setInt32(result + 24, d.getDay(), true);
        view.setInt32(result + 28, 0, true);
        view.setInt32(result + 32, 0, true);
        view.setInt32(result + 36, 0, true);
        return result;
    },
    memchr: (ptr, c, n) => {
        const mem = new Uint8Array(wasm.memory.buffer);
        const ch = c & 0xFF;
        for (let i = 0; i < n; i++) { if (mem[ptr + i] === ch) return ptr + i; }
        return 0;
    },
    acosh: (x) => Math.acosh(x),
    asinh: (x) => Math.asinh(x),
    atanh: (x) => Math.atanh(x),
    modf: (x, iptr) => {
        const mem = new DataView(wasm.memory.buffer);
        const intPart = Math.trunc(x);
        mem.setFloat64(iptr, intPart, true);
        return x - intPart;
    },
    signbit: (x) => (Object.is(x, -0) || x < 0 ? 1 : 0),
};


/**
 * @returns {string}
 */
export function run_date_probe() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.run_date_probe();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * @returns {string}
 */
export function run_native_comparison() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.run_native_comparison();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./date_wasi_repro_bg.js": import0,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
        "env": env,
    };
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('date_wasi_repro_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
