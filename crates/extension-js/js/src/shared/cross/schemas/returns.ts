import { z } from "zod";
import { refIdString } from "./helpers.js";
import { JsonSerializableResultSchema } from "./host.js";

// ─── Return value schemas ──────────────────────────────────────

export const PageActionResultSchema = z.object({
	ok: z.literal(true).describe("Whether the action succeeded"),
	action: z.string().describe("Action identifier (e.g. 'page_fill')"),
	refId: refIdString()
		.optional()
		.describe("Element reference ID that was acted upon (e.g. e2)"),
	tag: z.string().optional().describe("HTML tag name of the element"),
	role: z.string().optional().describe("ARIA role of the element"),
	name: z.string().optional().describe("Accessible name of the element"),
	value: z
		.union([z.string(), z.array(z.string())])
		.optional()
		.describe(
			"Final value of the element after the action (string, or string[] for multi-select)",
		),
	checked: z.boolean().optional().describe("Checked state after the action"),
	disabled: z.boolean().optional().describe("Whether the element is disabled"),
	readOnly: z.boolean().optional().describe("Whether the element is read-only"),
	required: z.boolean().optional().describe("Whether the element is required"),
	valid: z
		.boolean()
		.optional()
		.describe("HTML constraint validity after the action, when available"),
	invalid: z
		.boolean()
		.optional()
		.describe("Inverse validity / aria-invalid state after the action"),
	validationMessage: z
		.string()
		.optional()
		.describe("Browser validation message when the element is invalid"),
	invalidControls: z
		.array(
			z.object({
				refId: refIdString().optional(),
				tag: z.string(),
				role: z.string().optional(),
				name: z.string().optional(),
				field: z
					.string()
					.optional()
					.describe("Accessible field label or nearest label text"),
				error: z
					.string()
					.optional()
					.describe(
						"Linked visible error text from aria-errormessage/aria-describedby",
					),
				value: z.string().optional(),
				required: z.boolean().optional(),
				validationMessage: z.string().optional(),
			}),
		)
		.optional()
		.describe("Invalid form controls after submit, when available"),
	text: z.string().optional().describe("Text content of the element"),
	selectedText: z
		.string()
		.optional()
		.describe("Visible option text selected by select_option"),
	controlValue: z
		.union([z.string(), z.array(z.string())])
		.optional()
		.describe(
			"Dropdown/input value after select_option, when different from selectedText",
		),
	key: z
		.string()
		.optional()
		.describe("Key that was pressed (for press actions)"),
	direction: z
		.string()
		.optional()
		.describe("Scroll direction (for scroll actions)"),
	amount: z
		.number()
		.optional()
		.describe("Scroll amount in pixels (for scroll actions)"),
	fileCount: z
		.number()
		.optional()
		.describe("Number of files attached (for setFiles actions)"),
	fileNames: z
		.array(z.string())
		.optional()
		.describe("Names of attached files (for setFiles actions)"),
	observationId: z
		.string()
		.optional()
		.describe(
			"Opaque ID of the observation lease authorizing this action (snapshot-scoped)",
		),
	dispatched: z
		.literal(true)
		.optional()
		.describe(
			"True if the action was dispatched to the DOM. Does NOT prove the application accepted it.",
		),
	verification: z
		.literal("required")
		.optional()
		.describe(
			"Always 'required': a fresh observation is required to verify the effect.",
		),
});

export type PageActionResult = z.infer<typeof PageActionResultSchema>;

/** @deprecated Use PageActionResultSchema directly; handlers no longer return null. */
export const MutationReturnSchema = z.union([PageActionResultSchema, z.null()]);

export const FetchValueSchema = z.object({
	status: z.number().describe("HTTP response status code"),
	ok: z.boolean().describe("Whether the response status is 2xx"),
	headers: z.record(z.string()).describe("Response headers as key-value pairs"),
	body: z
		.string()
		.optional()
		.describe("Response body (omitted when bodyEncoding is handle)"),
	bodyEncoding: z
		.enum(["text", "base64", "handle"])
		.describe("Encoding of the body field"),
	handle: z
		.string()
		.optional()
		.describe("Binary handle when bodyEncoding is handle"),
	byteLength: z.number().describe("Length of the body in bytes"),
	contentType: z.string().describe("Response Content-Type header"),
	finalUrl: z.string().describe("Final URL after redirects"),
});

export const DomSnapshotValueSchema = z.object({
	data: z.object({}).passthrough().describe("Structured snapshot data"),
	text: z.string().describe("Plain text representation of the snapshot"),
});

export const PageHealthParamsSchema = z.object({});

export const PageHealthResultSchema = z.object({
	tabId: z.number(),
	url: z.string(),
	title: z.string(),
	contentScript: z.enum(["connected", "missing"]),
	domApis: z.enum(["ok", "blocked"]),
	mutationsReady: z.boolean(),
	hint: z.string().optional(),
	recovery: z.array(z.string()).optional(),
});

export const TabEvaluateResultSchema = JsonSerializableResultSchema;

export const SnapshotNodeSchema = z.object({
	refId: refIdString().describe("Element reference ID (e.g. e2)"),
	role: z.string().describe("ARIA role of the element"),
	tag: z.string().describe("HTML tag name"),
	controlType: z
		.string()
		.optional()
		.describe(
			'Plain-language control type, e.g. "dropdown" for combobox/select',
		),
	actionable: z
		.boolean()
		.optional()
		.describe("Whether this node can be acted on directly"),
	mustKeep: z
		.boolean()
		.optional()
		.describe(
			"Internal invariant marker: visible text exists and this node must not be dropped by snapshot pipes",
		),
	forControl: z
		.string()
		.optional()
		.describe("refId of the dropdown this validation-proxy belongs to"),
	recommendedAction: z
		.string()
		.optional()
		.describe("Recommended page.* action for this control"),
	controls: z
		.string()
		.optional()
		.describe("ID(s) of controlled popup/listbox elements, when exposed"),
	expanded: z
		.boolean()
		.optional()
		.describe("Expanded state for popup controls"),
	name: z.string().optional().describe("Accessible name of the element"),
	text: z.string().optional().describe("Visible text content of the element"),
	value: z.string().optional().describe("Element value"),
	required: z.boolean().optional().describe("Whether the element is required"),
	valid: z.boolean().optional().describe("Constraint validity state"),
	invalid: z.boolean().optional().describe("Constraint invalidity state"),
	validationMessage: z
		.string()
		.optional()
		.describe("Browser constraint validation message"),
	errorMessage: z
		.string()
		.optional()
		.describe("Visible error text linked to the field"),
	checked: z.boolean().optional().describe("Checked state"),
	disabled: z.boolean().optional().describe("Whether the element is disabled"),
	readOnly: z.boolean().optional().describe("Whether the element is read-only"),
	selected: z.boolean().optional().describe("For <option>: selected state"),
	href: z.string().optional().describe("Absolute URL for link elements"),
	src: z.string().optional().describe("Absolute URL for image elements"),
	alt: z.string().optional().describe("Alternative text for image elements"),
	title: z.string().optional().describe("Title attribute"),
	parentRefId: refIdString()
		.optional()
		.describe("Reference ID of the parent container element"),
	postId: z
		.string()
		.optional()
		.describe("Stable post identifier from data-post-id attribute"),
	permalink: z
		.string()
		.optional()
		.describe("Stable permalink URL from anchor element"),
	imageUrls: z
		.array(z.string())
		.optional()
		.describe("Image URLs contained within this element"),
	accept: z
		.string()
		.optional()
		.describe("For input[type=file]: accepted MIME types/extensions"),
	filesCount: z
		.number()
		.optional()
		.describe("For input[type=file]: selected file count"),
	confidence: z
		.enum(["high", "low"])
		.optional()
		.describe(
			"Clickability confidence; low-confidence wrappers may be deduplicated away",
		),
});

export const SnapshotResultSchema = z.object({
	text: z
		.string()
		.describe(
			"Broad text-first representation of the page, including visible text, form values, and validation/error text",
		),
	nodes: z
		.array(SnapshotNodeSchema)
		.describe(
			"Broad snapshot nodes with refIds where possible; not limited to interactive elements",
		),
	formErrors: z
		.array(
			z.object({
				field: z.string().describe("Field label or refId"),
				error: z.string().describe("Linked visible error text"),
				refId: z.string().describe("refId of the invalid control"),
			}),
		)
		.optional()
		.describe("Visible linked form errors grouped by field"),
	url: z.string().describe("Current page URL"),
	title: z.string().describe("Current page title"),
	viewport: z
		.object({
			width: z.number().describe("Viewport width in pixels"),
			height: z.number().describe("Viewport height in pixels"),
		})
		.describe("Viewport dimensions"),
	observationId: z
		.string()
		.optional()
		.describe(
			"Opaque ID of the observation lease granted by this snapshot. Pass to subsequent actions to prove they act on fresh observations.",
		),
});

interface DomNode {
	refId?: string;
	tag: string;
	role?: string;
	name?: string;
	text?: string;
	mustKeep?: boolean;
	attributes?: Record<string, string>;
	hidden?: boolean;
	hiddenReason?:
		| "display-none"
		| "visibility-hidden"
		| "aria-hidden"
		| "opacity-zero"
		| "hidden-attr"
		| "inert";
	value?: string;
	checked?: boolean;
	disabled?: boolean;
	readOnly?: boolean;
	selected?: boolean;
	required?: boolean;
	valid?: boolean;
	invalid?: boolean;
	validationMessage?: string;
	errorMessage?: string;
	href?: string;
	src?: string;
	alt?: string;
	title?: string;
	parentRefId?: string;
	postId?: string;
	permalink?: string;
	imageUrls?: string[];
	accept?: string;
	filesCount?: number;
	controlType?: string;
	actionable?: boolean;
	recommendedAction?: string;
	confidence?: "high" | "low";
	controls?: string;
	expanded?: boolean;
	forControl?: string;
	children?: DomNode[];
}

export const DomNodeSchema: z.ZodType<DomNode> = z.object({
	refId: refIdString().optional(),
	tag: z.string(),
	role: z.string().optional(),
	name: z.string().optional(),
	text: z.string().optional(),
	mustKeep: z
		.boolean()
		.optional()
		.describe(
			"Internal invariant marker: visible text exists and this node must not be dropped by DOM/snapshot pipes",
		),
	attributes: z
		.record(z.string())
		.optional()
		.describe("All HTML attributes (raw)"),
	hidden: z.boolean().optional(),
	hiddenReason: z
		.enum([
			"display-none",
			"visibility-hidden",
			"aria-hidden",
			"opacity-zero",
			"hidden-attr",
			"inert",
		])
		.optional(),
	value: z.string().optional(),
	checked: z.boolean().optional(),
	disabled: z.boolean().optional(),
	readOnly: z.boolean().optional(),
	selected: z.boolean().optional().describe("For <option>: selected state"),
	required: z.boolean().optional().describe("Whether the element is required"),
	valid: z.boolean().optional().describe("Constraint validity state"),
	invalid: z.boolean().optional().describe("Constraint invalidity state"),
	validationMessage: z
		.string()
		.optional()
		.describe("Browser constraint validation message"),
	errorMessage: z
		.string()
		.optional()
		.describe("Visible error text linked to the field"),
	href: z.string().optional().describe("Absolute URL for link elements"),
	src: z.string().optional().describe("Absolute URL for image elements"),
	alt: z.string().optional().describe("Alternative text for image elements"),
	title: z.string().optional().describe("Title attribute"),
	parentRefId: refIdString()
		.optional()
		.describe("Reference ID of the parent container element"),
	postId: z
		.string()
		.optional()
		.describe("Stable post identifier from data-post-id attribute"),
	permalink: z
		.string()
		.optional()
		.describe("Stable permalink URL from anchor element"),
	imageUrls: z
		.array(z.string())
		.optional()
		.describe("Image URLs contained within this element"),
	accept: z
		.string()
		.optional()
		.describe("For input[type=file]: accepted MIME/extensions"),
	filesCount: z
		.number()
		.optional()
		.describe("For input[type=file]: selected file count"),
	controlType: z
		.string()
		.optional()
		.describe(
			'Plain-language control type, e.g. "dropdown" for combobox/select',
		),
	actionable: z
		.boolean()
		.optional()
		.describe("Whether this node can be acted on directly"),
	recommendedAction: z
		.string()
		.optional()
		.describe("Recommended page.* action for this control"),
	confidence: z
		.enum(["high", "low"])
		.optional()
		.describe(
			"Clickability confidence; low-confidence wrappers may be deduplicated away",
		),
	controls: z
		.string()
		.optional()
		.describe("ID(s) of controlled popup/listbox elements, when exposed"),
	expanded: z
		.boolean()
		.optional()
		.describe("Expanded state for popup controls"),
	forControl: z
		.string()
		.optional()
		.describe("refId of the dropdown this validation-proxy belongs to"),
	children: z
		.array(z.lazy(() => DomNodeSchema))
		.optional()
		.describe("Nested descendants up to `depth`"),
});

/**
 * find() return element shape. Mirrors PipelineNode (no nested children):
 * the shared DOM pipeline enriches each matched element with the same form,
 * link, image, dropdown, clickability, and post/permalink metadata used by
 * snapshot and dom, so find stays in parity with the other surfaces.
 */
export const FindNodeSchema = z.object({
	refId: refIdString().describe("Element reference ID (e.g. e2)"),
	tag: z.string().describe("HTML tag name"),
	role: z.string().describe("ARIA role of the element"),
	name: z.string().optional().describe("Accessible name of the element"),
	text: z.string().optional().describe("Visible text content of the element"),
	mustKeep: z
		.boolean()
		.optional()
		.describe(
			"Internal invariant marker: visible text exists and this node must not be dropped by snapshot pipes",
		),
	value: z.string().optional().describe("Element value"),
	checked: z.boolean().optional().describe("Checked state"),
	disabled: z.boolean().optional().describe("Whether the element is disabled"),
	readOnly: z.boolean().optional().describe("Whether the element is read-only"),
	selected: z.boolean().optional().describe("For <option>: selected state"),
	required: z.boolean().optional().describe("Whether the element is required"),
	valid: z.boolean().optional().describe("Constraint validity state"),
	invalid: z.boolean().optional().describe("Constraint invalidity state"),
	validationMessage: z
		.string()
		.optional()
		.describe("Browser constraint validation message"),
	errorMessage: z
		.string()
		.optional()
		.describe("Visible error text linked to the field"),
	href: z.string().optional().describe("Absolute URL for link elements"),
	src: z.string().optional().describe("Absolute URL for image elements"),
	alt: z.string().optional().describe("Alternative text for image elements"),
	title: z.string().optional().describe("Title attribute"),
	parentRefId: refIdString()
		.optional()
		.describe("Reference ID of the parent container element"),
	postId: z
		.string()
		.optional()
		.describe("Stable post identifier from data-post-id attribute"),
	permalink: z
		.string()
		.optional()
		.describe("Stable permalink URL from anchor element"),
	imageUrls: z
		.array(z.string())
		.optional()
		.describe("Image URLs contained within this element"),
	accept: z
		.string()
		.optional()
		.describe("For input[type=file]: accepted MIME/extensions"),
	filesCount: z
		.number()
		.optional()
		.describe("For input[type=file]: selected file count"),
	controlType: z
		.string()
		.optional()
		.describe(
			'Plain-language control type, e.g. "dropdown" for combobox/select',
		),
	actionable: z
		.boolean()
		.optional()
		.describe("Whether this node can be acted on directly"),
	recommendedAction: z
		.string()
		.optional()
		.describe("Recommended page.* action for this control"),
	confidence: z
		.enum(["high", "low"])
		.optional()
		.describe("Clickability confidence"),
	controls: z
		.string()
		.optional()
		.describe("ID(s) of controlled popup/listbox elements"),
	expanded: z
		.boolean()
		.optional()
		.describe("Expanded state for popup controls"),
	forControl: z
		.string()
		.optional()
		.describe("refId of the dropdown this validation-proxy belongs to"),
});

export type FindNode = z.infer<typeof FindNodeSchema>;

export const PageDomResultSchema = z.object({
	nodes: z.array(DomNodeSchema),
	url: z.string(),
	title: z.string(),
});

export const ChromeTabSchema = z
	.object({
		id: z.number().optional().describe("Tab ID"),
		tabId: z.number().optional().describe("Tab ID (added by runner)"),
		index: z.number().optional().describe("Tab index in the window"),
		windowId: z.number().optional().describe("Window ID"),
		url: z.string().optional().describe("Tab URL"),
		title: z.string().optional().describe("Tab title"),
		status: z.string().optional().describe("Tab status (loading or complete)"),
		active: z.boolean().optional().describe("Whether the tab is active"),
		pinned: z.boolean().optional().describe("Whether the tab is pinned"),
		highlighted: z
			.boolean()
			.optional()
			.describe("Whether the tab is highlighted"),
		incognito: z.boolean().optional().describe("Whether the tab is incognito"),
		favIconUrl: z.string().optional().describe("Favicon URL"),
		audible: z.boolean().optional().describe("Whether the tab is audible"),
		groupId: z.number().optional().describe("Group ID"),
		openerTabId: z.number().optional().describe("Opener tab ID"),
		discarded: z.boolean().optional().describe("Whether the tab is discarded"),
		autoDiscardable: z
			.boolean()
			.optional()
			.describe("Whether the tab is auto-discardable"),
		width: z.number().optional().describe("Tab width"),
		height: z.number().optional().describe("Tab height"),
		sessionId: z.string().optional().describe("Session ID"),
	})
	.passthrough();
export const ChromeTabArraySchema = z.array(ChromeTabSchema);

export const ChromeWindowSchema = z
	.object({
		id: z.number().optional().describe("Window ID"),
		focused: z.boolean().optional().describe("Whether the window is focused"),
		top: z.number().optional().describe("Window top position"),
		left: z.number().optional().describe("Window left position"),
		width: z.number().optional().describe("Window width"),
		height: z.number().optional().describe("Window height"),
		tabs: ChromeTabArraySchema.optional().describe(
			"Array of tabs in the window",
		),
		incognito: z
			.boolean()
			.optional()
			.describe("Whether the window is incognito"),
		type: z.string().optional().describe("Window type"),
		state: z.string().optional().describe("Window state"),
		alwaysOnTop: z
			.boolean()
			.optional()
			.describe("Whether the window is always on top"),
		sessionId: z.string().optional().describe("Session ID"),
	})
	.passthrough();
export const ChromeWindowArraySchema = z.array(ChromeWindowSchema);

export const ChromeCookieSchema = z
	.object({
		name: z.string().describe("Cookie name"),
		value: z.string().describe("Cookie value"),
		domain: z.string().optional().describe("Cookie domain"),
		hostOnly: z
			.boolean()
			.optional()
			.describe("Whether the cookie is host-only"),
		path: z.string().optional().describe("Cookie path"),
		secure: z.boolean().optional().describe("Whether the cookie is secure"),
		httpOnly: z
			.boolean()
			.optional()
			.describe("Whether the cookie is HTTP-only"),
		sameSite: z.string().optional().describe("SameSite policy"),
		session: z
			.boolean()
			.optional()
			.describe("Whether the cookie is a session cookie"),
		expirationDate: z
			.number()
			.optional()
			.describe("Expiration date as Unix timestamp"),
		storeId: z.string().optional().describe("Store ID"),
	})
	.nullable();
export const ChromeCookieArraySchema = z.array(
	ChromeCookieSchema.nullable().unwrap(),
);

export const ChromeBookmarkSchema = z
	.object({
		id: z.string().describe("Bookmark ID"),
		parentId: z.string().optional().describe("Parent folder ID"),
		index: z.number().optional().describe("Bookmark index"),
		url: z.string().optional().describe("Bookmark URL"),
		title: z.string().describe("Bookmark title"),
		dateAdded: z.number().optional().describe("Date added"),
		dateGroupModified: z.number().optional().describe("Date group modified"),
		children: z
			.array(z.object({ id: z.string() }).passthrough())
			.optional()
			.describe("Child bookmarks"),
	})
	.passthrough();
export const ChromeBookmarkArraySchema = z.array(ChromeBookmarkSchema);

export const ChromeHistoryItemSchema = z
	.object({
		id: z.string().describe("History item ID"),
		url: z.string().optional().describe("URL"),
		title: z.string().optional().describe("Title"),
		lastVisitTime: z.number().optional().describe("Last visit time"),
		visitCount: z.number().optional().describe("Visit count"),
		typedCount: z.number().optional().describe("Typed count"),
	})
	.passthrough();
export const ChromeHistoryArraySchema = z.array(ChromeHistoryItemSchema);

export const ChromeScriptResultItemSchema = z.object({
	frameId: z.number().describe("Frame ID"),
	result: z.unknown().optional().describe("Script result"),
});
export const ChromeScriptResultSchema = z.array(ChromeScriptResultItemSchema);

export const ChromeNotificationIdSchema = z.string();
export const ChromeNotificationClearSchema = z.boolean();
export const ChromeMenuItemIdSchema = z.union([z.string(), z.number()]);
export const ChromeAlarmsClearSchema = z.boolean();

export const ChromeTabGroupSchema = z
	.object({
		id: z.number().optional().describe("Group ID"),
		collapsed: z
			.boolean()
			.optional()
			.describe("Whether the group is collapsed"),
		color: z.string().optional().describe("Group color"),
		title: z.string().optional().describe("Group title"),
		windowId: z.number().optional().describe("Window ID"),
	})
	.passthrough();
export const ChromeTabGroupArraySchema = z.array(ChromeTabGroupSchema);

export const ChromeSessionSchema = z
	.object({
		lastModified: z.number().optional().describe("Last modified time"),
		tab: ChromeTabSchema.optional().describe("Tab info"),
		window: ChromeWindowSchema.optional().describe("Window info"),
	})
	.passthrough();
export const ChromeSessionArraySchema = z.array(ChromeSessionSchema);

export const ChromeDeviceSchema = z
	.object({
		deviceName: z.string().optional().describe("Device name"),
		sessions: ChromeSessionArraySchema.optional().describe("Sessions"),
	})
	.passthrough();
export const ChromeDeviceArraySchema = z.array(ChromeDeviceSchema);

export const ChromeDownloadSchema = z
	.object({
		id: z.number().optional().describe("Download ID"),
		url: z.string().optional().describe("Download URL"),
		filename: z.string().optional().describe("Filename"),
		startTime: z.string().optional().describe("Start time"),
		endTime: z.string().optional().describe("End time"),
		state: z.string().optional().describe("Download state"),
		danger: z.string().optional().describe("Danger type"),
		paused: z.boolean().optional().describe("Whether the download is paused"),
		error: z.string().optional().describe("Error message"),
		bytesReceived: z.number().optional().describe("Bytes received"),
		totalBytes: z.number().optional().describe("Total bytes"),
		fileSize: z.number().optional().describe("File size"),
		mime: z.string().optional().describe("MIME type"),
		incognito: z
			.boolean()
			.optional()
			.describe("Whether the download is incognito"),
		referrer: z.string().optional().describe("Referrer URL"),
		byExtensionId: z.string().optional().describe("Extension ID"),
		byExtensionName: z.string().optional().describe("Extension name"),
	})
	.passthrough();
export const ChromeDownloadArraySchema = z.array(ChromeDownloadSchema);
export const ChromeDownloadIdSchema = z.number();

export const ChromeSystemCpuInfoSchema = z.object({
	archName: z.string().describe("CPU architecture"),
	modelName: z.string().describe("CPU model"),
	numOfProcessors: z.number().describe("Number of processors"),
	features: z.array(z.string()).describe("CPU features"),
});
export const ChromeSystemMemoryInfoSchema = z.object({
	capacity: z.number().describe("Total memory capacity"),
	availableCapacity: z.number().describe("Available memory capacity"),
});
export const ChromeSystemStorageInfoSchema = z.array(
	z.object({
		id: z.string().describe("Storage ID"),
		name: z.string().describe("Storage name"),
		type: z.string().describe("Storage type"),
		capacity: z.number().describe("Storage capacity"),
	}),
);
