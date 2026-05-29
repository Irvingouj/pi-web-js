import { FunctionalComponent } from 'preact';
import { useRef, useEffect } from 'preact/hooks';

interface Props {
  id: string;
  value: string;
  placeholder: string;
  kind: 'code' | 'markdown';
  onChange: (value: string) => void;
  onRun?: () => void;
  onDoneEditing?: () => void;
  autoFocus?: boolean;
}

const CellEditor: FunctionalComponent<Props> = ({
  id, value, placeholder, kind, onChange, onRun, onDoneEditing, autoFocus,
}) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
    }
  }, [autoFocus]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = ref.current!;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
      ta.value = newVal;
      ta.selectionStart = ta.selectionEnd = start + 2;
      onChange(newVal);
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (kind === 'code') {
        onRun?.();
      } else {
        onDoneEditing?.();
      }
    }
    if (e.key === 'Escape' && kind === 'markdown') {
      onDoneEditing?.();
    }
  };

  return (
    <textarea
      ref={ref}
      class="cell-editor"
      data-testid="cell-editor"
      id={`editor-${id}`}
      spellcheck={false}
      placeholder={placeholder}
      value={value}
      onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
      onKeyDown={handleKeyDown}
    />
  );
};

export default CellEditor;
