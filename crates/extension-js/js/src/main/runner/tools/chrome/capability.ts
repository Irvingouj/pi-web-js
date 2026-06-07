/// <reference types="chrome" />
import { makeError } from "../../lib/types.js";

let cachedPermissions: Set<string> | null = null;

/**
 * Manifest permission required for a Chrome API namespace segment.
 * `null` = no manifest permission required (runtime, action, etc.).
 */
const CHROME_NAMESPACE_MANIFEST_PERMISSION: Record<string, string | null> = {
	action: null,
	alarms: "alarms",
	bookmarks: "bookmarks",
	browsingData: "browsingData",
	contextMenus: "contextMenus",
	cookies: "cookies",
	declarativeNetRequest: "declarativeNetRequest",
	desktopCapture: "desktopCapture",
	downloads: "downloads",
	history: "history",
	identity: "identity",
	idle: "idle",
	management: "management",
	notifications: "notifications",
	offscreen: "offscreen",
	pageCapture: "pageCapture",
	permissions: null,
	runtime: null,
	scripting: "scripting",
	sessions: "sessions",
	sidePanel: "sidePanel",
	storage: "storage",
	system: "system.cpu",
	tabGroups: "tabGroups",
	tabs: "tabs",
	topSites: "topSites",
	tts: "tts",
	windows: "windows",
};

/**
 * Initialize capability cache by reading chrome.permissions.getAll().
 * Call once at extension startup.
 */
export async function initCapabilities(): Promise<void> {
	if (typeof chrome !== "undefined" && chrome.runtime?.id) {
		try {
			const manifestPerms = chrome.runtime.getManifest?.().permissions ?? [];
			let granted: string[] = [];
			if (chrome.permissions?.getAll) {
				const all = await chrome.permissions.getAll();
				granted = all.permissions ?? [];
			}
			// Required manifest permissions are granted at install; merge them so
			// the cache matches effective access even when getAll omits some entries.
			cachedPermissions = new Set([...manifestPerms, ...granted]);
		} catch {
			cachedPermissions = null;
		}
	} else {
		cachedPermissions = null;
	}
}

/** Re-read chrome.permissions.getAll() and update the cache. */
export async function refreshCapabilities(): Promise<void> {
	await initCapabilities();
}

/** Reset the capability cache to null (test helper). */
export function resetCapabilities(): void {
	cachedPermissions = null;
}

/**
 * Manifest permission for a chrome API path, or null when no manifest permission is required.
 */
export function manifestPermissionForApiPath(apiPath: string[]): string | null {
	if (apiPath.length === 0) return null;
	const namespace = apiPath[0];
	if (namespace === "system" && apiPath.length >= 2) {
		const sub = apiPath[1];
		if (sub === "cpu" || sub === "memory" || sub === "storage") {
			return `system.${sub}`;
		}
	}
	if (namespace in CHROME_NAMESPACE_MANIFEST_PERMISSION) {
		return CHROME_NAMESPACE_MANIFEST_PERMISSION[namespace];
	}
	return namespace;
}

/**
 * @deprecated Use manifestPermissionForApiPath
 */
export function permissionFromApiPath(apiPath: string[]): string | null {
	return manifestPermissionForApiPath(apiPath);
}

/**
 * Manifest permission for a chrome_* action target.
 * e.g. "chrome_notifications_create" → "notifications"
 */
export function permissionFromChromeAction(action: string): string | null {
	const match = action.match(/^chrome_([a-zA-Z0-9]+)_/);
	if (!match) return null;
	const namespace = match[1];
	if (namespace in CHROME_NAMESPACE_MANIFEST_PERMISSION) {
		return CHROME_NAMESPACE_MANIFEST_PERMISSION[namespace];
	}
	return namespace;
}

/**
 * Whether a manifest permission is currently granted.
 * - null permission → always true (namespace-only APIs)
 * - non-null → cache-only; false when cache missing or permission absent
 */
export function hasPermission(permission: string | null): boolean {
	if (permission === null) return true;
	if (cachedPermissions === null) return false;
	return cachedPermissions.has(permission);
}

/** Throw E_PERMISSION if the manifest permission is required but not granted. */
export function checkPermission(
	apiName: string,
	permission: string | null,
): void {
	if (permission === null) return;
	if (!hasPermission(permission)) {
		throw makeError(
			`Permission denied: ${permission} required for ${apiName}`,
			"E_PERMISSION",
			"permission",
		);
	}
}
