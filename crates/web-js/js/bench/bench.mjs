// QuickJS-in-WASM ephemeral-VM benchmark for @pi-oxide/web-js.
//
// Model under test (the proposed background-event design):
//   each "event handler" does  new WebSession() -> runCellAsync(code) -> free()
//   i.e. a fresh QuickJS Runtime+Context per handler, deallocated after.
//
// What we measure, mapped to the start-up phases:
//   bootstrap : one-off dynamic-import = base64 decode + wasm compile + instantiate
//               + __wbindgen_start (Phase A). Happens once, at module load.
//   init      : new WebSession() = rquickjs Runtime + Context + init_registry +
//               injectRegistryBindings + register_browser_globals (Phase B+C).
//   run       : runCellAsync(code) settling to a result.
//   free      : session.free() = drop Runtime -> Rust allocator pool (deallocate).
//   heap      : WebAssembly.Memory.buffer.byteLength after each free.
//               A plateau means the Rust allocator reuses its pool across handlers —
//               the whole point of the ephemeral model vs a persistent VM.
//
// Engine: rquickjs 0.11 (rust-alloc) compiled to ~8.9MB wasm (inlined as base64).

import { initSync, WebSession } from "../web_js.js";

// Module already auto-initialized at import (see web_js.js tail). initSync() now
// just returns the cached exports — which include the linear `memory`.
const wasmExports = initSync();
const memory = wasmExports.memory;

const hasGc = typeof globalThis.gc === "function";
const crossOriginIsolated = globalThis.crossOriginIsolated === true;

function heapBytes() {
  return memory.buffer.byteLength;
}

function pct(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(
    sortedArr.length - 1,
    Math.ceil((p / 100) * sortedArr.length) - 1,
  );
  return sortedArr[Math.max(0, idx)];
}

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length || 1;
  return {
    n: s.length,
    min: s[0] ?? 0,
    p50: pct(s, 50),
    p95: pct(s, 95),
    p99: pct(s, 99),
    max: s[s.length - 1] ?? 0,
    mean: s.reduce((a, b) => a + b, 0) / n,
  };
}

const fmtMs = (x) => `${x.toFixed(2)}ms`;
const fmtMB = (b) => `${(b / (1024 * 1024)).toFixed(2)}MB`;

// One ephemeral handler: new -> run -> free. Returns per-phase timings + post-free heap.
async function oneCycle(code) {
  const t0 = performance.now();
  const session = new WebSession();
  const t1 = performance.now();
  await session.runCellAsync(code, "");
  const t2 = performance.now();
  session.free();
  const t3 = performance.now();
  // If JS GC is exposed, run it so any detached wasm slabs don't keep pages pinned.
  // (The linear-memory metric itself is GC-independent; this just keeps JS tidy.)
  if (hasGc) globalThis.gc();
  return {
    initMs: t1 - t0,
    runMs: t2 - t1,
    freeMs: t3 - t2,
    totalMs: t3 - t0,
    heapAfter: heapBytes(),
  };
}

function detectPlateau(samples, threshold, window) {
  for (let i = window; i < samples.length; i++) {
    const w = samples.slice(i - window, i);
    if (Math.max(...w) - Math.min(...w) < threshold) return i - window;
  }
  return -1;
}

function sparkline(samples) {
  if (samples.length < 2) return "";
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const range = max - min || 1;
  const chars = "▁▂▃▄▅▆▇█";
  const W = 60;
  const step = Math.max(1, Math.floor(samples.length / W));
  let out = "";
  for (let i = 0; i < samples.length; i += step) {
    const v = samples[i];
    const idx = Math.min(
      chars.length - 1,
      Math.floor(((v - min) / range) * (chars.length - 1)),
    );
    out += chars[idx];
  }
  return `${out}  (${fmtMB(min)} → ${fmtMB(max)})`;
}

export async function runBench(config = {}) {
  const iterations = config.iterations ?? 200;
  const warmup = config.warmup ?? 10;
  const code = config.code ?? "1+1";
  const heavyCode = config.heavyCode ?? null;

  // Warmup: establish the Rust allocator working set (this is the plateau-builder).
  for (let i = 0; i < warmup; i++) await oneCycle(code);

  // First post-warmup handler — representative "cold handler" once the pool is primed.
  const first = await oneCycle(code);

  // Steady-state sampling.
  const inits = [];
  const runs = [];
  const frees = [];
  const totals = [];
  const heaps = [];
  for (let i = 0; i < iterations; i++) {
    const c = await oneCycle(code);
    inits.push(c.initMs);
    runs.push(c.runMs);
    frees.push(c.freeMs);
    totals.push(c.totalMs);
    heaps.push(c.heapAfter);
  }

  const report = {
    engine: "rquickjs 0.11 (rust-alloc) in WASM — @pi-oxide/web-js",
    gcExposed: hasGc,
    crossOriginIsolated,
    config: { iterations, warmup, code, heavyCode },
    coldHandler: first,
    steady: {
      initMs: stats(inits),
      runMs: stats(runs),
      freeMs: stats(frees),
      totalMs: stats(totals),
    },
    heap: {
      baselineAfterWarmup: first.heapAfter,
      min: Math.min(...heaps),
      max: Math.max(...heaps),
      final: heaps[heaps.length - 1],
      plateauAt: detectPlateau(heaps, 1024, 10),
      samples: heaps,
    },
  };

  if (heavyCode) {
    const heavy = [];
    const n = Math.min(iterations, 50);
    for (let i = 0; i < n; i++) heavy.push((await oneCycle(heavyCode)).totalMs);
    report.heavyCell = { code: heavyCode, totalMs: stats(heavy) };
  }

  // Best-effort browser-accounted memory total (Chrome, needs crossOriginIsolated).
  if (
    crossOriginIsolated &&
    typeof performance !== "undefined" &&
    typeof performance.measureUserAgentSpecificMemory === "function"
  ) {
    try {
      if (hasGc) globalThis.gc();
      const m = await performance.measureUserAgentSpecificMemory();
      report.browserMemory = m;
    } catch {
      /* ignore — linear-memory metric above is the primary one */
    }
  }

  return report;
}

export function formatReport(report, bootstrapMs) {
  const L = [];
  const push = (s) => L.push(s);
  push("═══ QuickJS ephemeral-VM bench (@pi-oxide/web-js) ═══");
  push(`engine: ${report.engine}`);
  push(
    `config: iterations=${report.config.iterations} warmup=${report.config.warmup} code=${JSON.stringify(report.config.code)}  (gcExposed=${report.gcExposed} crossOriginIsolated=${report.crossOriginIsolated})`,
  );
  push("");
  push("── Phase A: module bootstrap (decode + compile + instantiate + start) ──");
  push(`  cold bootstrap (ONCE, at import): ${fmtMs(bootstrapMs)}`);
  push("");
  push("── Per-handler: new WebSession() [B+C] + runCellAsync [run] + free() [dealloc] ──");
  push(
    `  first post-warmup handler: ${fmtMs(report.coldHandler.totalMs)}  (init ${fmtMs(report.coldHandler.initMs)} + run ${fmtMs(report.coldHandler.runMs)} + free ${fmtMs(report.coldHandler.freeMs)})`,
  );
  push("");
  const s = report.steady;
  push(`── Steady-state (${s.totalMs.n} samples) ──`);
  push(`  init  (B+C):  p50 ${fmtMs(s.initMs.p50)}   p95 ${fmtMs(s.initMs.p95)}   p99 ${fmtMs(s.initMs.p99)}   max ${fmtMs(s.initMs.max)}`);
  push(`  run   (cell): p50 ${fmtMs(s.runMs.p50)}   p95 ${fmtMs(s.runMs.p95)}   p99 ${fmtMs(s.runMs.p99)}`);
  push(`  free  (dealloc): p50 ${fmtMs(s.freeMs.p50)}   p95 ${fmtMs(s.freeMs.p95)}`);
  push(`  TOTAL per handler: p50 ${fmtMs(s.totalMs.p50)}   p95 ${fmtMs(s.totalMs.p95)}   p99 ${fmtMs(s.totalMs.p99)}   max ${fmtMs(s.totalMs.max)}`);
  push("");
  push("── Linear memory (WebAssembly.Memory.buffer.byteLength) ──");
  push(`  after warmup:   ${fmtMB(report.heap.baselineAfterWarmup)}`);
  push(`  steady min/max: ${fmtMB(report.heap.min)} / ${fmtMB(report.heap.max)}`);
  push(`  final:          ${fmtMB(report.heap.final)}`);
  if (report.heap.plateauAt >= 0) {
    push(`  ✓ PLATEAU at iteration #${report.heap.plateauAt} (<1KB drift / 10 samples) — allocator pool reuse confirmed`);
  } else {
    push(`  ✗ NO plateau reached — heap still drifting (raise iterations or investigate)`);
  }
  push(`  heap trace: ${sparkline(report.heap.samples)}`);
  if (report.heavyCell) {
    const h = report.heavyCell.totalMs;
    push("");
    push(`── Heavy cell: ${JSON.stringify(report.heavyCell.code)} ──`);
    push(`  TOTAL: p50 ${fmtMs(h.p50)}   p95 ${fmtMs(h.p95)}   p99 ${fmtMs(h.p99)}`);
  }
  if (report.browserMemory) {
    push("");
    push("── Browser-accounted memory (performance.measureUserAgentSpecificMemory) ──");
    push(`  ${JSON.stringify(report.browserMemory)}`);
  }
  push("");
  push("── Verdict (ephemeral-VM-per-event viability) ──");
  const p95 = s.totalMs.p95;
  if (p95 < 50)
    push(`  ✓ p95 ${fmtMs(p95)} < 50ms — comfortable for alarms / onMessage / navigation events`);
  else if (p95 < 200)
    push(`  ~ p95 ${fmtMs(p95)} — OK for coarse events (alarms); too slow for webRequest blocking`);
  else
    push(`  ✗ p95 ${fmtMs(p95)} — likely too slow for per-event spawn; consider a persistent VM`);
  if (report.heap.plateauAt < 0)
    push(`  ⚠ heap never plateaued — ephemeral model may leak over long runs; check the trace`);
  return L.join("\n");
}
