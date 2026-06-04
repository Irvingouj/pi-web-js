import { marked } from "marked";
import type { FunctionalComponent } from "preact";
import { useMemo } from "preact/hooks";

interface Props {
	source: string;
	onDoubleClick: () => void;
}

const MarkdownPreview: FunctionalComponent<Props> = ({
	source,
	onDoubleClick,
}) => {
	const html = useMemo(() => {
		return marked.parse(source || "", { async: false }) as string;
	}, [source]);

	return (
		// biome-ignore lint/a11y/useSemanticElements: <button> cannot contain arbitrary markdown HTML
		<div
			class="md-preview"
			data-testid="md-preview"
			role="button"
			tabIndex={0}
			onDblClick={onDoubleClick}
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
};

export default MarkdownPreview;
