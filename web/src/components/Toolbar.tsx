import { FunctionalComponent } from 'preact';

interface Props {
  onRunAll: () => void;
  onStop: () => void;
  onRestart: () => void;
  onAddCode: () => void;
  onAddMarkdown: () => void;
  onClear: () => void;
  onSave: () => void;
  onLoad: () => void;
  onNew: () => void;
}

const Toolbar: FunctionalComponent<Props> = ({
  onRunAll, onStop, onRestart, onAddCode, onAddMarkdown, onClear, onSave, onLoad, onNew,
}) => {
  return (
    <nav class="toolbar">
      <div class="toolbar-group">
        <button class="btn btn-exec" data-testid="run-all-button" title="Run all cells" onClick={onRunAll}>▶ Run All</button>
        <button class="btn btn-stop" data-testid="stop-button" title="Stop execution" onClick={onStop}>■ Stop</button>
        <button class="btn" data-testid="restart-kernel-button" title="Restart kernel" onClick={onRestart}>↻ Restart</button>
      </div>
      <div class="toolbar-sep" />
      <div class="toolbar-group">
        <button class="btn" data-testid="add-cell-button" title="Add code cell" onClick={onAddCode}>+ Code</button>
        <button class="btn" data-testid="add-md-button" title="Add markdown cell" onClick={onAddMarkdown}>+ Markdown</button>
        <button class="btn" data-testid="clear-outputs-button" title="Clear all outputs" onClick={onClear}>Clear Outputs</button>
      </div>
      <div class="toolbar-sep" />
      <div class="toolbar-group">
        <button class="btn" title="New notebook" onClick={onNew}>✕ New</button>
        <button class="btn" data-testid="save-button" title="Save notebook" onClick={onSave}>↓ Save</button>
        <button class="btn" data-testid="load-button" title="Load notebook" onClick={onLoad}>↑ Load</button>
      </div>
    </nav>
  );
};

export default Toolbar;
