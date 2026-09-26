import type { KeyboardEvent } from 'react';
import type { EditorProps } from './types';

const CHEAT = `classDiagram
  class PricingStrategy {
    <<interface>>
    +fee(ticket) Money
  }
  class HourlyPricing
  PricingStrategy <|.. HourlyPricing      %% HourlyPricing implements PricingStrategy
  ParkingLot *-- Level                    %% ParkingLot owns Level
  ParkingLot --> PricingStrategy : uses   %% association with a label
  Ticket ..> Vehicle                      %% dependency
  note for ParkingLot "Coordinates entry and exit"`;

/**
 * Mermaid text. Mermaid has no syntax for "what is this class responsible for", so the format reads it from
 * `note for ClassName "…"` lines. The reviewers rely on those.
 */
export function MermaidEditor({ value, onChange }: EditorProps) {
  const source = String((value as { source?: string } | undefined)?.source ?? '');

  // Tab inserts two spaces instead of leaving the field.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || e.shiftKey) return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: end } = el;
    const next = `${source.slice(0, s)}  ${source.slice(end)}`;
    onChange({ source: next });
    requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
  };

  return (
    <div className="stack-sm">
      <textarea
        className="textarea code-editor"
        value={source}
        onChange={(e) => onChange({ source: e.target.value })}
        onKeyDown={onKeyDown}
        spellCheck={false}
        aria-label="Mermaid class diagram source"
        placeholder="classDiagram&#10;  class ParkingLot&#10;  …"
        rows={16}
      />
      <details>
        <summary className="small muted" style={{ cursor: 'pointer' }}>Syntax cheat sheet</summary>
        <pre className="hint mono small" style={{ overflow: 'auto', margin: '8px 0 0' }}>{CHEAT}</pre>
      </details>
    </div>
  );
}
