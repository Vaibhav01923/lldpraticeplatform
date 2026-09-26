import type { ComponentType } from 'react';

export interface EditorProps {
  value: unknown;
  onChange: (value: unknown) => void;
}

export type Editor = ComponentType<EditorProps>;
