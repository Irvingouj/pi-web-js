import {
	autocompletion,
	type CompletionContext,
	type CompletionResult,
} from "@codemirror/autocomplete";
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
} from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import {
	bracketMatching,
	defaultHighlightStyle,
	foldGutter,
	indentOnInput,
	syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
	drawSelection,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	lineNumbers,
	rectangularSelection,
} from "@codemirror/view";
import type { FunctionalComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useTheme } from "../hooks/useTheme";

interface Props {
	id: string;
	value: string;
	placeholder: string;
	kind: "code" | "markdown";
	onChange: (value: string) => void;
	onRun?: () => void;
	onDoneEditing?: () => void;
	autoFocus?: boolean;
}

const jsKeywords = [
	"async",
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"import",
	"in",
	"instanceof",
	"let",
	"new",
	"null",
	"return",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"undefined",
	"var",
	"void",
	"while",
	"with",
	"yield",
];

const jsBuiltins = [
	"console.log",
	"console.error",
	"console.warn",
	"console.info",
	"JSON.stringify",
	"JSON.parse",
	"Object.keys",
	"Object.values",
	"Object.entries",
	"Object.assign",
	"Array.isArray",
	"Array.from",
	"String",
	"Number",
	"Boolean",
	"Date",
	"Math.random",
	"Math.floor",
	"Math.ceil",
	"Math.max",
	"Math.min",
	"Math.abs",
	"Math.sqrt",
	"Math.PI",
	"setTimeout",
	"setInterval",
	"clearTimeout",
	"clearInterval",
	"parseInt",
	"parseFloat",
	"isNaN",
	"isFinite",
	"encodeURIComponent",
	"decodeURIComponent",
];

const notebookGlobals = [
	"web.fetch",
	"web.url.parse",
	"web.url.encode",
	"web.log",
	"web.sleep",
	"web.storage.get",
	"web.storage.set",
	"web.storage.delete",
	"web.storage.list",
	"crypto.sha256",
	"crypto.md5",
	"crypto.hmac_sha256",
	"crypto.hex_encode",
	"crypto.hex_decode",
	"host.call",
	"chrome.tabs.query",
	"chrome.tabs.create",
	"chrome.tabs.update",
	"chrome.tabs.remove",
	"chrome.tabs.sendMessage",
	"chrome.runtime.sendMessage",
	"chrome.alarms.create",
	"chrome.alarms.clear",
	"chrome.action.setBadgeText",
	"chrome.action.setBadgeBackgroundColor",
	"chrome.action.setTitle",
	"chrome.contextMenus.create",
	"chrome.contextMenus.remove",
	"chrome.windows.getAll",
	"chrome.windows.create",
	"chrome.windows.update",
	"chrome.windows.remove",
	"chrome.sidePanel.setOptions",
	"chrome.cookies.get",
	"chrome.cookies.set",
	"chrome.cookies.remove",
	"chrome.cookies.getAll",
	"chrome.bookmarks.search",
	"chrome.bookmarks.create",
	"chrome.bookmarks.remove",
	"chrome.history.search",
	"chrome.history.deleteUrl",
	"chrome.notifications.create",
	"chrome.notifications.clear",
	"chrome.scripting.executeScript",
	"dom.snapshot",
	"dom.format",
	"page.snapshot",
	"page.click",
	"page.dblclick",
	"page.fill",
	"page.type",
	"page.press",
	"page.select",
	"page.check",
	"page.hover",
	"page.unhover",
	"page.scroll",
	"page.scrollTo",
	"page.url",
	"page.title",
	"page.screenshot",
	"page.goto",
	"page.back",
	"page.forward",
	"page.reload",
	"page.wait",
	"page.tabs",
	"page.switch",
	"page.newTab",
	"page.close",
	"page.activeTab",
	"runtime.inspect",
	"runtime.fetch",
	"tab.query",
	"tab.open",
	"tab.close",
	"tab.current",
	"tab.focus",
	"tab.click",
	"tab.fill",
	"tab.type",
	"tab.evaluate",
	"tab.fetch",
	"tab.snapshot",
	"tab.screenshot",
	"tab.url",
	"tab.title",
	"tab.back",
	"tab.forward",
	"tab.reload",
	"tab.wait",
	"tab.goto",
	"tab.scroll",
	"tab.scrollTo",
	"tab.press",
	"tab.select",
	"tab.check",
	"tab.hover",
	"tab.unhover",
];

function jsCompletions(context: CompletionContext): CompletionResult | null {
	const word = context.matchBefore(/[\w.]+/);
	if (!word || (word.from === word.to && !context.explicit)) return null;

	const options = [
		...jsKeywords.map((k) => ({ label: k, type: "keyword", boost: 2 })),
		...jsBuiltins.map((k) => ({ label: k, type: "function" })),
		...notebookGlobals.map((k) => ({
			label: k,
			type: "function",
			detail: "notebook API",
		})),
	];

	return {
		from: word.from,
		options,
		filter: true,
	};
}

const themeCompartment = new Compartment();

function getBaseExtensions(
	onChange: (v: string) => void,
	onRun?: () => void,
	onDone?: () => void,
) {
	return [
		highlightSpecialChars(),
		history(),
		drawSelection(),
		EditorState.allowMultipleSelections.of(true),
		syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
		lineNumbers(),
		highlightActiveLineGutter(),
		foldGutter(),
		bracketMatching(),
		indentOnInput(),
		rectangularSelection(),
		highlightActiveLine(),
		keymap.of([
			...defaultKeymap,
			...historyKeymap,
			indentWithTab,
			{
				key: "Ctrl-Enter",
				run: () => {
					onRun?.();
					return true;
				},
			},
			{
				key: "Cmd-Enter",
				run: () => {
					onRun?.();
					return true;
				},
			},
			{
				key: "Escape",
				run: () => {
					onDone?.();
					return false;
				},
			},
		]),
		autocompletion({
			override: [jsCompletions],
			activateOnTyping: true,
		}),
		EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				onChange(update.state.doc.toString());
			}
		}),
		EditorView.theme({
			"&": {
				height: "auto",
				minHeight: "80px",
			},
			".cm-scroller": {
				overflow: "auto",
				minHeight: "80px",
			},
			".cm-content": {
				minHeight: "80px",
			},
			".cm-gutters": {
				minHeight: "80px",
			},
		}),
	];
}

function getLightTheme() {
	return EditorView.theme({
		"&": {
			backgroundColor: "#FFFFFF",
			color: "#111217",
			fontSize: "14px",
		},
		".cm-content": {
			caretColor: "#000080",
			fontFamily:
				"'SF Mono','Fira Code','Cascadia Code','JetBrains Mono','Menlo', monospace",
			lineHeight: "1.6",
			padding: "8px 0",
		},
		".cm-gutters": {
			backgroundColor: "#FAFAFC",
			color: "#747887",
			border: "none",
			borderRight: "1px solid #E2E4EA",
		},
		".cm-activeLineGutter": {
			backgroundColor: "#F3F4F7",
		},
		".cm-activeLine": {
			backgroundColor: "#F4F5FF",
		},
		"&.cm-focused .cm-cursor": {
			borderLeftColor: "#000080",
		},
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
			{
				backgroundColor: "#E8EAFF !important",
			},
		".cm-tooltip": {
			border: "1px solid #E2E4EA",
			borderRadius: "6px",
			boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
		},
		".cm-tooltip-autocomplete": {
			"& > ul > li": {
				padding: "4px 8px",
			},
			"& > ul > li[aria-selected]": {
				backgroundColor: "#E8EAFF",
				color: "#111217",
			},
		},
	});
}

const CodeMirrorEditor: FunctionalComponent<Props> = ({
	id,
	value,
	placeholder,
	kind,
	onChange,
	onRun,
	onDoneEditing,
	autoFocus,
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const { theme } = useTheme();

	useEffect(() => {
		if (!containerRef.current) return;

		const isCode = kind === "code";
		const runHandler = isCode ? onRun : onDoneEditing;

		const state = EditorState.create({
			doc: value,
			extensions: [
				...getBaseExtensions(onChange, runHandler, onDoneEditing),
				...(isCode ? [javascript()] : []),
				themeCompartment.of(theme === "dark" ? oneDark : getLightTheme()),
				EditorState.tabSize.of(2),
				placeholder ? EditorView.lineWrapping : [],
			],
		});

		const view = new EditorView({
			state,
			parent: containerRef.current,
		});

		viewRef.current = view;
		(containerRef.current as any).__codemirror = view;

		if (autoFocus) {
			view.focus();
		}

		return () => {
			view.destroy();
			viewRef.current = null;
		};
	}, []);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		view.dispatch({
			effects: themeCompartment.reconfigure(
				theme === "dark" ? oneDark : getLightTheme(),
			),
		});
	}, [theme]);

	return (
		<div
			ref={containerRef}
			data-testid="cell-editor"
			id={`editor-${id}`}
			class="cm-editor-wrapper"
		/>
	);
};

export default CodeMirrorEditor;
