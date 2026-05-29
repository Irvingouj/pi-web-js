// Fake env module for WASM C library imports
// Provides minimal implementations for QuickJS runtime

export function gettimeofday(tv: number, tz: number): number {
  return 0;
}

export function pthread_once(control: number, init: number): number {
  return 0;
}
