// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlers } from "../src/content-script/handlers.js";
import {
	dispatchContentScriptCall,
	registerContentScriptSpec,
} from "../src/content-script/registry.js";
import { buildContentScriptSpecs } from "../src/content-script/schemas.js";

const mockAddListener = vi.fn();

declare global {
	var chrome: {
		runtime: {
			id: string;
			onMessage: {
				addListener: typeof mockAddListener;
			};
		};
	};
}

// Set up global chrome before any dynamic import
globalThis.chrome = {
	runtime: {
		id: "test-extension-id",
		onMessage: {
			addListener: mockAddListener,
		},
	},
};

// Polyfill CSS.escape for jsdom test environments where it is unavailable
if (typeof globalThis.CSS === "undefined" || !globalThis.CSS.escape) {
	(globalThis as unknown as Record<string, unknown>).CSS = {
		escape: (s: string) => s.replace(/([.*+?^${}()|[\]\\])/g, "\\$1"),
	};
}

// Polyfill DataTransfer for jsdom (from content-script.test.ts)
function installDataTransferPolyfill(): void {
	let usable = false;
	if (typeof globalThis.DataTransfer === "function") {
		try {
			new globalThis.DataTransfer();
			usable = true;
		} catch {
			usable = false;
		}
	}
	if (usable) {
		return;
	}

	class PolyfillDataTransfer {
		private readonly _files: File[] = [];

		items = {
			add: (file: File) => {
				this._files.push(file);
			},
			clear: () => {
				this._files.length = 0;
			},
			get length() {
				return this._files.length;
			},
		};

		get files(): FileList {
			const files = this._files;
			const fileList = {
				length: files.length,
				item: (index: number) => files[index] ?? null,
				[Symbol.iterator]: () => files[Symbol.iterator](),
			} as FileList;
			for (let i = 0; i < files.length; i++) {
				(fileList as FileList & Record<number, File>)[i] = files[i]!;
			}
			return fileList;
		}
	}

	globalThis.DataTransfer =
		PolyfillDataTransfer as unknown as typeof DataTransfer;
}

function installFileInputFilesPolyfill(): void {
	const proto = HTMLInputElement.prototype;
	const existing = Object.getOwnPropertyDescriptor(proto, "files");
	if (!existing) {
		return;
	}
	const fileListByInput = new WeakMap<HTMLInputElement, FileList>();
	Object.defineProperty(proto, "files", {
		get(this: HTMLInputElement) {
			return fileListByInput.get(this) ?? existing.get?.call(this) ?? null;
		},
		set(this: HTMLInputElement, value: FileList) {
			fileListByInput.set(this, value);
			try {
				existing.set?.call(this, value);
			} catch {
				// jsdom may reject programmatic file assignment
			}
		},
		configurable: true,
	});
}

installDataTransferPolyfill();
installFileInputFilesPolyfill();

// Import content-script to register the onMessage listener
await import("../src/content-script/index.js");

describe("T-005: setFiles descends to hidden file input", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	it("set_files with label refId finds nested file input", async () => {
		// Build the Rippling-style fixture
		const label = document.createElement("label");
		label.setAttribute("data-testid", "resume");
		label.setAttribute("data-ref-id", "e11");

		const input = document.createElement("input");
		input.type = "file";
		input.setAttribute("accept", ".doc,.docx,.pdf");
		input.setAttribute("data-testid", "input-resume");
		input.hidden = true;

		const button = document.createElement("button");
		button.type = "button";
		button.setAttribute("data-ref-id", "e12");
		button.textContent = "Drop or select";

		label.appendChild(input);
		label.appendChild(button);
		document.body.appendChild(label);

		let changed = false;
		input.addEventListener("change", () => {
			changed = true;
		});

		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(new Uint8Array([97]), {
				status: 200,
				headers: { "content-type": "text/plain" },
			}),
		);

		const result = await dispatchContentScriptCall(
			"page_set_files",
			"set_files",
			handlers.set_files,
			{
				refId: "e11",
				files: [
					{
						kind: "url",
						url: "https://example.com/r.txt",
						name: "r.txt",
					},
				],
			},
		);

		fetchMock.mockRestore();

		expect(result.ok).toBe(true);
		if (result.ok) {
			const value = result.value as {
				fileCount?: number;
				fileNames?: string[];
			};
			expect(value.fileCount).toBe(1);
			expect(value.fileNames).toEqual(["r.txt"]);
		}
		expect(input.files?.length).toBe(1);
		expect(input.files?.[0]?.name).toBe("r.txt");
		expect(changed).toBe(true);
	});

	it("set_files with button refId descends to sibling file input", async () => {
		const label = document.createElement("label");
		label.setAttribute("data-ref-id", "e11");

		const input = document.createElement("input");
		input.type = "file";
		input.hidden = true;

		const button = document.createElement("button");
		button.type = "button";
		button.setAttribute("data-ref-id", "e12");
		button.textContent = "Drop or select";

		label.appendChild(input);
		label.appendChild(button);
		document.body.appendChild(label);

		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(new Uint8Array([97]), {
				status: 200,
				headers: { "content-type": "text/plain" },
			}),
		);

		const result = await dispatchContentScriptCall(
			"page_set_files",
			"set_files",
			handlers.set_files,
			{
				refId: "e12",
				files: [
					{
						kind: "url",
						url: "https://example.com/r.txt",
						name: "r.txt",
					},
				],
			},
		);

		fetchMock.mockRestore();

		expect(result.ok).toBe(true);
		if (result.ok) {
			const value = result.value as { fileCount?: number };
			expect(value.fileCount).toBe(1);
		}
		expect(input.files?.length).toBe(1);
	});

	it("set_files with display:none file input still succeeds", async () => {
		const label = document.createElement("label");
		label.setAttribute("data-ref-id", "e11");

		const input = document.createElement("input");
		input.type = "file";
		input.style.display = "none";

		label.appendChild(input);
		document.body.appendChild(label);

		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(new Uint8Array([97]), {
				status: 200,
				headers: { "content-type": "text/plain" },
			}),
		);

		const result = await dispatchContentScriptCall(
			"page_set_files",
			"set_files",
			handlers.set_files,
			{
				refId: "e11",
				files: [
					{
						kind: "url",
						url: "https://example.com/r.txt",
						name: "r.txt",
					},
				],
			},
		);

		fetchMock.mockRestore();

		expect(result.ok).toBe(true);
		expect(input.files?.length).toBe(1);
	});

	it("set_files with div without nested file input throws not_file_input", async () => {
		const div = document.createElement("div");
		div.setAttribute("data-ref-id", "e20");
		div.textContent = "No file input here";
		document.body.appendChild(div);

		const result = await dispatchContentScriptCall(
			"page_set_files",
			"set_files",
			handlers.set_files,
			{
				refId: "e20",
				files: [
					{
						kind: "bytes",
						name: "x.txt",
						data: "YQ==",
						mimeType: "text/plain",
					},
				],
			},
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_INTERACTABLE");
		}
	});
});
