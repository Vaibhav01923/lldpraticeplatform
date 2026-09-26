import { useEffect, useState } from 'react';
import type { EditorProps } from './types';

/**
 * Fallback for a submission format the server offers but the client has no dedicated editor for.
 * It lets a new format work end to end on day one; a nicer editor can be added later without touching the server.
 */
export function JsonEditor({ value, onChange }: EditorProps) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string>();

  useEffect(() => setText(JSON.stringify(value, null, 2)), [value]);

  return (
    <div className="stack-sm">
      <textarea
        className="textarea code-editor"
        value={text}
        rows={16}
        spellCheck={false}
        aria-label="Design as JSON"
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setError(undefined);
          } catch {
            setError('Not valid JSON yet.');
          }
        }}
      />
      {error && <div className="help" style={{ color: 'var(--bad)' }}>{error}</div>}
    </div>
  );
}
