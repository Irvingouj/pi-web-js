// Fake env module for WASM C library imports
// Provides minimal implementations for QuickJS runtime

export function gettimeofday(_tv: number, _tz: number): number {
	return 0;
}

export function pthread_once(_control: number, _init: number): number {
	return 0;
}
