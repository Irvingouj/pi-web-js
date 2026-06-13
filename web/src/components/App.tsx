import type { FunctionalComponent } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { loadFromIndexedDB, useAutoSave } from "../hooks/useAutoSave";
import { useExtensionKernel } from "../hooks/useExtensionKernel";
import { useKernel } from "../hooks/useKernel";
import { useTheme } from "../hooks/useTheme";
import { formatCellError } from "../lib/formatCellError";
import type { CellKind, Cell as CellType, Notebook } from "../notebook";
import {
	createCell,
	createNotebook,
	deserializeNotebook,
	serializeNotebook,
} from "../notebook";
import type { WorkerRunResult } from "../types";
import Cell from "./Cell";
import Toolbar from "./Toolbar";
import TopBar from "./TopBar";

const App: FunctionalComponent = () => {
	const [notebook, setNotebook] = useState<Notebook>(createNotebook);
	const [editingCells, setEditingCells] = useState<Set<string>>(new Set());
	const { theme, toggle: toggleTheme } = useTheme();
	const { scheduleSave, saveNow } = useAutoSave();
	const runAllQueueRef = useRef<string[]>([]);
	const notebookRef = useRef(notebook);
	notebookRef.current = notebook;

	const handleResult = useCallback((cellId: string, data: WorkerRunResult) => {
		setNotebook((prev) => {
			const cells = prev.cells.map((c) => {
				if (c.id !== cellId) return c;
				const updated = { ...c };
				updated.outputs = data.stdout || [];
				updated.errors = data.stderr || [];
				updated.result = data.result || null;
				if (data.error) {
					updated.errors = [...updated.errors, formatCellError(data.error)];
					updated.status =
						data.error.kind === "fuel_exhausted" ? "stopped" : "error";
				} else {
					updated.status = "success";
				}
				updated.executionCount = data.execution_count || null;
				return updated;
			});
			return { ...prev, cells };
		});

		if (runAllQueueRef.current.length > 0) {
			const nextId = runAllQueueRef.current.shift()!;
			setTimeout(() => {
				const nb = notebookRef.current;
				const cell = nb.cells.find((c) => c.id === nextId);
				if (cell) kernel.runCell(nextId, cell.source, "");
			}, 0);
		}
	}, []);

	const handleError = useCallback((error: string) => {
		console.error("[kernel error]", error);
	}, []);

	const isExtensionContext =
		typeof window !== "undefined" && !!(window as any).chrome?.runtime?.id;
	const webKernel = useKernel(handleResult, handleError);
	const extKernel = useExtensionKernel(handleResult, handleError);
	const kernel = isExtensionContext ? extKernel : webKernel;

	useEffect(() => {
		scheduleSave(notebook);
	}, [notebook, scheduleSave]);

	useEffect(() => {
		loadFromIndexedDB().then((saved) => {
			if (saved && saved.cells.length > 0) {
				const cells = saved.cells.map((c) => ({
					...c,
					status: "idle" as const,
					outputs: [],
					errors: [],
				}));
				setNotebook({ ...saved, cells });
			}
		});
	}, []);

	useEffect(() => {
		const handler = () => saveNow(notebookRef.current);
		window.addEventListener("beforeunload", handler);
		return () => window.removeEventListener("beforeunload", handler);
	}, [saveNow]);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.get("showcase") === "true") {
			import("../showcase").then((mod) => {
				setNotebook(mod.createShowcaseNotebook());
			});
		}
	}, []);

	const updateCell = useCallback((cellId: string, patch: Partial<CellType>) => {
		setNotebook((prev) => ({
			...prev,
			cells: prev.cells.map((c) => (c.id === cellId ? { ...c, ...patch } : c)),
		}));
	}, []);

	const handleSourceChange = useCallback(
		(cellId: string, source: string) => {
			updateCell(cellId, { source });
		},
		[updateCell],
	);

	const handleRunCell = useCallback(
		(cellId: string, source?: string) => {
			const cell = notebookRef.current.cells.find((c) => c.id === cellId);
			if (!cell) return;
			const runSource = source ?? cell.source;
			updateCell(cellId, { status: "running", outputs: [], errors: [] });
			kernel.runCell(cellId, runSource, "");
		},
		[updateCell, kernel],
	);

	const handleRunAll = useCallback(() => {
		const ids = notebookRef.current.cells.map((c) => c.id);
		if (ids.length === 0) return;
		runAllQueueRef.current = ids.slice(1);
		const firstId = ids[0];
		const cell = notebookRef.current.cells.find((c) => c.id === firstId);
		if (cell) {
			updateCell(firstId, { status: "running", outputs: [], errors: [] });
			kernel.runCell(firstId, cell.source, "");
		}
	}, [updateCell, kernel]);

	const handleStop = useCallback(() => {
		kernel.stopExecution();
		setNotebook((prev) => ({
			...prev,
			cells: prev.cells.map((c) =>
				c.status === "running"
					? {
							...c,
							status: "stopped" as const,
							errors: [...c.errors, "Execution stopped by user"],
						}
					: c,
			),
		}));
		runAllQueueRef.current = [];
	}, [kernel]);

	const handleRestart = useCallback(() => {
		kernel.restartKernel();
		setNotebook((prev) => ({
			...prev,
			cells: prev.cells.map((c) => ({
				...c,
				executionCount: null,
				status: "idle" as const,
				outputs: [],
				errors: [],
			})),
		}));
		runAllQueueRef.current = [];
	}, [kernel]);

	const handleClearOutputs = useCallback(() => {
		setNotebook((prev) => ({
			...prev,
			cells: prev.cells.map((c) => ({
				...c,
				outputs: [],
				errors: [],
				status: "idle" as const,
			})),
		}));
	}, []);

	const handleAddCell = useCallback(
		(afterId?: string, kind: CellKind = "code") => {
			const cell = createCell("", kind);
			setNotebook((prev) => {
				const cells = [...prev.cells];
				if (afterId) {
					const idx = cells.findIndex((c) => c.id === afterId);
					cells.splice(idx + 1, 0, cell);
				} else {
					cells.push(cell);
				}
				return { ...prev, cells };
			});
		},
		[],
	);

	const handleDeleteCell = useCallback((cellId: string) => {
		setNotebook((prev) => {
			if (prev.cells.length <= 1) return prev;
			return { ...prev, cells: prev.cells.filter((c) => c.id !== cellId) };
		});
	}, []);

	const handleMoveCell = useCallback(
		(cellId: string, direction: "up" | "down") => {
			setNotebook((prev) => {
				const cells = [...prev.cells];
				const idx = cells.findIndex((c) => c.id === cellId);
				if (idx < 0) return prev;
				const newIdx = direction === "up" ? idx - 1 : idx + 1;
				if (newIdx < 0 || newIdx >= cells.length) return prev;
				[cells[idx], cells[newIdx]] = [cells[newIdx], cells[idx]];
				return { ...prev, cells };
			});
		},
		[],
	);

	const handleToggleKind = useCallback((cellId: string) => {
		setNotebook((prev) => ({
			...prev,
			cells: prev.cells.map((c) =>
				c.id === cellId
					? {
							...c,
							kind: (c.kind === "code" ? "markdown" : "code") as CellKind,
							outputs: [],
							errors: [],
							executionCount: null,
							status: "idle" as const,
						}
					: c,
			),
		}));
		setEditingCells((prev) => {
			const next = new Set(prev);
			next.delete(cellId);
			return next;
		});
	}, []);

	const handleToggleEdit = useCallback((cellId: string) => {
		setEditingCells((prev) => {
			const next = new Set(prev);
			if (next.has(cellId)) {
				next.delete(cellId);
			} else {
				next.add(cellId);
			}
			return next;
		});
	}, []);

	const handleSaveNotebook = useCallback(() => {
		const json = serializeNotebook(notebookRef.current);
		const blob = new Blob([json], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "notebook.json";
		a.click();
		URL.revokeObjectURL(url);
	}, []);

	const handleLoadNotebook = useCallback(() => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json";
		input.onchange = () => {
			const file = input.files?.[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = () => {
				const nb = deserializeNotebook(reader.result as string);
				if (nb) {
					setNotebook(nb);
				} else {
					alert("Invalid notebook file");
				}
			};
			reader.readAsText(file);
		};
		input.click();
	}, []);

	const handleNewNotebook = useCallback(() => {
		if (!confirm("Start a new notebook? Unsaved changes will be lost.")) return;
		kernel.restartKernel();
		setNotebook(createNotebook());
		setEditingCells(new Set());
		runAllQueueRef.current = [];
	}, [kernel]);

	return (
		<div id="app" data-testid="app-root">
			<TopBar
				kernelStatus={kernel.status}
				theme={theme}
				onToggleTheme={toggleTheme}
			/>
			<Toolbar
				onRunAll={handleRunAll}
				onStop={handleStop}
				onRestart={handleRestart}
				onAddCode={() => handleAddCell(undefined, "code")}
				onAddMarkdown={() => handleAddCell(undefined, "markdown")}
				onClear={handleClearOutputs}
				onSave={handleSaveNotebook}
				onLoad={handleLoadNotebook}
				onNew={handleNewNotebook}
			/>
			<main class="canvas">
				<div id="cells-container" data-testid="cells-container">
					{notebook.cells.map((cell, idx) => (
						<Cell
							key={cell.id}
							cell={cell}
							index={idx}
							totalCells={notebook.cells.length}
							kernelStatus={kernel.status}
							editing={editingCells.has(cell.id)}
							onRun={handleRunCell}
							onDelete={handleDeleteCell}
							onMove={handleMoveCell}
							onAdd={handleAddCell}
							onToggleKind={handleToggleKind}
							onChangeSource={handleSourceChange}
							onToggleEdit={handleToggleEdit}
						/>
					))}
				</div>
			</main>
			<footer class="footer">
				Powered by{" "}
				<a href="https://github.com/boa-dev/boa" target="_blank" rel="noopener">
					boa
				</a>{" "}
				·{" "}
				<a
					href="https://developer.mozilla.org/en-US/docs/Web/JavaScript"
					target="_blank"
					rel="noopener"
				>
					JavaScript
				</a>
				<span class="footer-sep">·</span>
				<a href="?showcase=true" class="footer-showcase">
					📚 Showcase
				</a>
			</footer>
		</div>
	);
};

export default App;
