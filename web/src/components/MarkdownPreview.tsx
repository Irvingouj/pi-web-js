import { FunctionalComponent } from 'preact';
import { useMemo } from 'preact/hooks';
import { marked } from 'marked';

interface Props {
  source: string;
  onDoubleClick: () => void;
}

const MarkdownPreview: FunctionalComponent<Props> = ({ source, onDoubleClick }) => {
  const html = useMemo(() => {
    return marked.parse(source || '', { async: false }) as string;
  }, [source]);

  return (
    <div
      class="md-preview"
      data-testid="md-preview"
      onDblClick={onDoubleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default MarkdownPreview;
