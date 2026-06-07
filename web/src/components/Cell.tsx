import type { FunctionalComponent } from "preact";
import { useRef } from "preact/hooks";
import type { KernelStatus } from "../hooks/useKernel";
import type { CellKind, Cell as CellType } from "../notebook";
import CellOutput from "./CellOutput";
import CodeMirrorEditor, { type CellEditorHandle } from "./CodeMirrorEditor";
import MarkdownPreview from "./MarkdownPreview";

interface Props {
	cell: CellType;
	index: number;
	totalCells: number;
	kernelStatus: KernelStatus;
	editing: boolean;
	onRun: (cellId: string, source?: string) => void;
	onDelete: (cellId: string) => void;
	onMove: (cellId: string, direction: "up" | "down") => void;
	onAdd: (afterId: string, kind: CellKind) => void;
	onToggleKind: (cellId: string) => void;
	onChangeSource: (cellId: string, source: string) => void;
	onToggleEdit: (cellId: string) => void;
}

const Cell: FunctionalComponent<Props> = ({
	cell,
	index,
	totalCells,
	kernelStatus,
	editing,
	onRun,
	onDelete,
	onMove,
	onAdd,
	onToggleKind,
	onChangeSource,
	onToggleEdit,
}) => {
	const isCode = cell.kind === "code";
	const execLabel =
		cell.executionCount !== null ? `In [${cell.executionCount}]` : "In [ ]";

	const handleChange = (source: string) => {
		onChangeSource(cell.id, source);
	};

	const editorRef = useRef<CellEditorHandle>(null);
	const lastRunRef = useRef(0);
	const handleRun = () => {
		const now = Date.now();
		if (now - lastRunRef.current < 500) {
			console.log(`[Cell.handleRun] debounced cell ${cell.id}`);
			return;
		}
		lastRunRef.current = now;
		const source = editorRef.current?.getText() ?? cell.source;
		console.log(`[Cell.handleRun] running cell ${cell.id}`);
		onRun(cell.id, source);
	};

	const handleToggleEdit = () => {
		onToggleEdit(cell.id);
	};

	const handleToggleKind = () => {
		onToggleKind(cell.id);
	};

	const handleDelete = () => {
		onDelete(cell.id);
	};

	const handleMoveUp = () => onMove(cell.id, "up");
	const handleMoveDown = () => onMove(cell.id, "down");
	const handleAddCode = () => onAdd(cell.id, "code");
	const _handleAddMd = () => onAdd(cell.id, "markdown");

	const kindLabel = isCode ? "JS" : "MD";
	const kindClass = isCode ? "cell-kind-code" : "cell-kind-md";
	const toggleKindLabel = isCode ? "MD" : "JS";

	return (
		<div
			class={`cell cell-${cell.kind} cell-${cell.status}`}
			data-cell-id={cell.id}
			data-testid="cell"
		>
			<div class="cell-rail" />
			<div class="cell-header">
				{isCode && (
					<span class="exec-label" data-testid="cell-execution-count">
						{execLabel}
					</span>
				)}
				<span class={`cell-kind-badge ${kindClass}`}>{kindLabel}</span>
				{isCode && (
					<span
						class={`cell-status status-${cell.status}`}
						data-testid="cell-status"
					>
						{cell.status}
					</span>
				)}
				<div class="cell-actions">
					{isCode && (
						<button
							type="button"
							class="btn btn-sm btn-exec"
							data-action="run"
							data-testid="cell-run-button"
							data-cell-id={cell.id}
							title="Run cell (Ctrl+Enter)"
							onClick={handleRun}
						>
							▶ Run
						</button>
					)}
					{!isCode && (
						<button
							type="button"
							class="btn btn-sm"
							data-action="toggleEdit"
							data-cell-id={cell.id}
							title={editing ? "Render markdown" : "Edit markdown"}
							onClick={handleToggleEdit}
						>
							{editing ? "✓ Done" : "✎ Edit"}
						</button>
					)}
					<button
						type="button"
						class="btn btn-sm"
						data-action="toggleKind"
						data-cell-id={cell.id}
						title={`Convert to ${toggleKindLabel} cell`}
						onClick={handleToggleKind}
					>
						{toggleKindLabel}
					</button>
					<button
						type="button"
						class="btn btn-sm"
						data-action="add"
						data-cell-id={cell.id}
						title="Add code below"
						onClick={handleAddCode}
					>
						+
					</button>
					<button
						type="button"
						class="btn btn-sm"
						data-action="up"
						data-testid="cell-move-up-button"
						data-cell-id={cell.id}
						title="Move up"
						disabled={index === 0}
						onClick={handleMoveUp}
					>
						↑
					</button>
					<button
						type="button"
						class="btn btn-sm"
						data-action="down"
						data-testid="cell-move-down-button"
						data-cell-id={cell.id}
						title="Move down"
						disabled={index === totalCells - 1}
						onClick={handleMoveDown}
					>
						↓
					</button>
					<button
						type="button"
						class="btn btn-sm btn-danger"
						data-action="delete"
						data-testid="cell-delete-button"
						data-cell-id={cell.id}
						title="Delete cell"
						disabled={totalCells <= 1}
						onClick={handleDelete}
					>
						✕
					</button>
				</div>
			</div>
			<div class="cell-body">
				{isCode ? (
					<CodeMirrorEditor
						ref={editorRef}
						id={cell.id}
						value={cell.source}
						placeholder="Enter JavaScript code here..."
						kind="code"
						onChange={handleChange}
						onRun={handleRun}
					/>
				) : editing ? (
					<CodeMirrorEditor
						id={cell.id}
						value={cell.source}
						placeholder="Write markdown here..."
						kind="markdown"
						onChange={handleChange}
						onDoneEditing={handleToggleEdit}
						autoFocus
					/>
				) : (
					<MarkdownPreview
						source={cell.source}
						onDoubleClick={handleToggleEdit}
					/>
				)}
			</div>
			{isCode && (
				<CellOutput
					outputs={cell.outputs}
					errors={cell.errors}
					result={cell.result}
				/>
			)}
		</div>
	);
};

export default Cell;
