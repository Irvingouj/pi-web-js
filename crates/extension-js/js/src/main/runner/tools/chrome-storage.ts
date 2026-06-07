/// <reference types="chrome" />
import { z } from "zod";
import { registerChromePassthrough } from "../chrome/internals.js";

// ─── Chrome extension storage (parity passthrough) ─────────────────

const storageReturn = z.record(z.unknown());

registerChromePassthrough(
	"chrome_storage_local_set",
	"chrome",
	"Set extension local storage values",
	["storage", "local"],
	z.null(),
	"ECHROME",
	"extension",
	[],
	"chrome.storage.local.set({ key: \"value\" })"
);
registerChromePassthrough(
	"chrome_storage_local_get",
	"chrome",
	"Get extension local storage values",
	["storage", "local"],
	storageReturn,
	"ECHROME",
	"extension",
	[],
	"chrome.storage.local.get(\"key\")"
);
registerChromePassthrough(
	"chrome_storage_local_remove",
	"chrome",
	"Remove extension local storage values",
	["storage", "local"],
	z.null(),
	"ECHROME",
	"extension",
	[],
	"chrome.storage.local.remove(\"key\")"
);
registerChromePassthrough(
	"chrome_storage_local_clear",
	"chrome",
	"Clear all extension local storage",
	["storage", "local"],
	z.null(),
	"ECHROME",
	"extension",
	[],
	"chrome.storage.local.clear()"
);
registerChromePassthrough(
	"chrome_storage_sync_set",
	"chrome",
	"Set extension sync storage values",
	["storage", "sync"],
	z.null(),
	"ECHROME",
	"extension",
	[],
	"chrome.storage.sync.set({ key: \"value\" })"
);
registerChromePassthrough(
	"chrome_storage_sync_get",
	"chrome",
	"Get extension sync storage values",
	["storage", "sync"],
	storageReturn,
	"ECHROME",
	"extension",
	[],
	"chrome.storage.sync.get(\"key\")"
);
registerChromePassthrough(
	"chrome_storage_sync_remove",
	"chrome",
	"Remove extension sync storage values",
	["storage", "sync"],
	z.null(),
	"ECHROME",
	"extension",
	[],
	"chrome.storage.sync.remove(\"key\")"
);
registerChromePassthrough(
	"chrome_storage_sync_clear",
	"chrome",
	"Clear all extension sync storage",
	["storage", "sync"],
	z.null(),
	"ECHROME",
	"extension",
	[],
	"chrome.storage.sync.clear()"
);
