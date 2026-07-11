import type { FunctionalComponent } from "preact";

interface Props {
	outputs: string[];
	errors: string[];
	result: string | null;
}

function escapeHtml(s: string): string {
	// Guard undefined/null — formatCellError must never return non-string, but
	// a missing switch arm previously crashed the sidepanel on api_error.
	const text = s ?? "";
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

const CellOutput: FunctionalComponent<Props> = ({
	outputs,
	errors,
	result,
}) => {
	const empty = outputs.length === 0 && errors.length === 0 && !result;
	return (
		<div class="cell-outputs" data-testid="cell-output" hidden={empty}>
			{outputs.map((o, i) => (
				<div class="output-line" data-testid="cell-output-line" key={i}>
					{escapeHtml(o)}
				</div>
			))}
			{result && (
				<div class="output-result" data-testid="cell-result">
					{escapeHtml(result)}
				</div>
			)}
			{errors.map((e, i) => (
				<div class="output-error" data-testid="cell-error" key={`e${i}`}>
					{escapeHtml(e)}
				</div>
			))}
		</div>
	);
};

export default CellOutput;
