#!/usr/bin/env node
/**
 * Post-process wasm-bindgen output to create a self-contained JS module.
 * Base64-embeds the .wasm binary and auto-calls initSync() so consumers
 * don't need to handle a separate file or initialization.
 *
 * Also injects inline C stdlib stubs for the "env" module so Vite never
 * has to resolve an external "env" import.
 *
 * Usage: node scripts/bundle-wasm.js <pkgDir> <cratePrefix>
 *   pkgDir      — wasm-bindgen output directory (e.g. crates/web-js/pkg)
 *   cratePrefix — snake_case crate name used in file names (e.g. web_js)
 */

import fs from 'fs';
import path from 'path';

const pkgDir = process.argv[2] || 'crates/web-js/pkg';
const cratePrefix = process.argv[3] || path.basename(path.dirname(pkgDir)).replace(/-/g, '_');

const wasmPath = path.join(pkgDir, `${cratePrefix}_bg.wasm`);
const jsPath = path.join(pkgDir, `${cratePrefix}.js`);
const dtsPath = path.join(pkgDir, `${cratePrefix}.d.ts`);

if (!fs.existsSync(wasmPath)) {
    console.error('WASM file not found:', wasmPath);
    process.exit(1);
}

const wasmBytes = fs.readFileSync(wasmPath);
const base64 = wasmBytes.toString('base64');

// Chunk base64 to avoid extremely long lines
const chunkSize = 120;
const chunks = [];
for (let i = 0; i < base64.length; i += chunkSize) {
    chunks.push(base64.slice(i, i + chunkSize));
}

let js = fs.readFileSync(jsPath, 'utf-8');

// Remove the default URL fallback that tries to fetch the separate .wasm file.
js = js.replace(
    new RegExp(
        `if \\(module_or_path === undefined\\) \\{\\s*module_or_path = new URL\\('${cratePrefix}_bg\\.wasm', import\\.meta\\.url\\);\\s*\\}`
    ),
    `// Self-contained: WASM is base64-embedded below`
);

// ─── Inject env stubs ─────────────────────────────────────────
// QuickJS compiled for wasm32 imports ~40 C stdlib functions from "env".
// We replace all `import * as importN from "env"` with inline stubs so
// Vite never needs to resolve an external "env" module.

const hasEnvImports = js.includes('import * as import1 from "env"');
if (hasEnvImports) {
    // Remove all env import lines
    js = js.replace(/import \* as import\d+ from "env"\n/g, '');

    // Build the env stub block
    const envStub = `
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
        // Untracked pointers (e.g. from RustAllocator) are leaked
        // to avoid passing wrong size to __wbindgen_free.
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
        // Untracked pointer: malloc+copy to avoid wrong-size realloc
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
        view.setInt32(result + 28, 0, true); // isdst
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
`;

    // Insert env block after the first line (the self-types comment)
    const firstLineEnd = js.indexOf('\n') + 1;
    js = js.slice(0, firstLineEnd) + envStub + js.slice(firstLineEnd);

    // Replace all "env": importN with "env": env
    js = js.replace(/"env": import\d+/g, '"env": env');

    console.log('  Injected inline env stubs');
}

// Append base64 payload + auto-init at the very end
const embedBlock = `

// ─── Self-contained WASM payload ──────────────────────────────

const WASM_BASE64 = [
${chunks.map(c => `    "${c}"`).join(',\n')}
].join("");

const WASM_BYTES = Uint8Array.from(atob(WASM_BASE64), c => c.charCodeAt(0));
initSync({ module: WASM_BYTES });
`;

fs.writeFileSync(jsPath, js + embedBlock);

// Remove the separate .wasm file so it can't accidentally be referenced
fs.unlinkSync(wasmPath);
if (fs.existsSync(wasmPath + '.d.ts')) {
    fs.unlinkSync(wasmPath + '.d.ts');
}

// Copy bundled JS and .d.ts into js/ directory for self-contained packaging
const jsDir = path.resolve(pkgDir, '../js');
if (fs.existsSync(jsDir)) {
    fs.copyFileSync(jsPath, path.join(jsDir, `${cratePrefix}.js`));
    if (fs.existsSync(dtsPath)) {
        fs.copyFileSync(dtsPath, path.join(jsDir, `${cratePrefix}.d.ts`));
    }
    console.log(`Copied bundled files to ${jsDir}`);
}

console.log(`Self-contained build ready at ${pkgDir}`);
console.log(`  JS size: ${(fs.statSync(jsPath).size / 1024 / 1024).toFixed(2)} MB`);
