import { useMemo } from 'react';
import type { ClassKind, RelationKind } from '../../../../shared/contracts';
import { emptyCard, type CardPayload } from '../../lib/design';
import { KIND_LABELS, RELATION_HELP, RELATION_LABELS } from '../../lib/labels';
import type { EditorProps } from './types';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function normalise(value: unknown): CardPayload {
  const v = (value ?? {}) as Partial<CardPayload>;
  return {
    classes: (v.classes ?? []).map((c) => ({ ...emptyCard(), ...c })),
    relationships: (v.relationships ?? []).map((r) => ({ from: r.from ?? '', to: r.to ?? '', kind: r.kind ?? ('association' as RelationKind), label: r.label ?? '' })),
  };
}

const lines = (text: string) => text.split('\n');
const rowsFor = (items: string[], min = 3) => Math.max(min, Math.min(8, items.length + 1));

/**
 * Class–Responsibility–Collaborator cards. Writing the responsibility down forces the decision a bare box
 * on a diagram lets you skip, and is what the reviewers (rules and AI) judge cohesion from.
 */
export function CrcEditor({ value, onChange }: EditorProps) {
  const data = useMemo(() => normalise(value), [value]);
  const names = data.classes.map((c) => c.name.trim()).filter(Boolean);
  const emit = (next: CardPayload) => onChange(next);

  const setCard = (i: number, patch: Partial<CardPayload['classes'][number]>) =>
    emit({ ...data, classes: data.classes.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const removeCard = (i: number) => {
    const gone = data.classes[i]!.name.trim();
    emit({
      classes: data.classes.filter((_, j) => j !== i),
      relationships: gone ? data.relationships.filter((r) => r.from !== gone && r.to !== gone) : data.relationships,
    });
  };

  // Renaming a class keeps its relationships attached.
  const rename = (i: number, name: string) => {
    const old = data.classes[i]!.name.trim();
    emit({
      classes: data.classes.map((c, j) => (j === i ? { ...c, name } : c)),
      relationships: old ? data.relationships.map((r) => ({ ...r, from: r.from === old ? name.trim() : r.from, to: r.to === old ? name.trim() : r.to })) : data.relationships,
    });
  };

  const setRel = (i: number, patch: Partial<CardPayload['relationships'][number]>) =>
    emit({ ...data, relationships: data.relationships.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  const collaborators = (name: string): string[] => {
    if (!name.trim()) return [];
    const set = new Set<string>();
    for (const r of data.relationships) {
      if (r.from === name && r.to) set.add(r.to);
      if (r.to === name && r.from) set.add(r.from);
    }
    return [...set];
  };

  return (
    <div className="stack">
      <div className="cards-grid">
        {data.classes.map((c, i) => {
          const invalid = c.name.trim() !== '' && !IDENTIFIER.test(c.name.trim());
          const collabs = collaborators(c.name.trim());
          return (
            <div key={i} className={`class-card kind-${c.kind}`}>
              <div className="class-card-head">
                <input
                  className="input name mono-input"
                  value={c.name}
                  placeholder="ClassName"
                  aria-label={`Class ${i + 1} name`}
                  aria-invalid={invalid}
                  onChange={(e) => rename(i, e.target.value)}
                  spellCheck={false}
                />
                <select className="select" value={c.kind} aria-label={`Kind of ${c.name || `class ${i + 1}`}`} onChange={(e) => setCard(i, { kind: e.target.value as ClassKind })}>
                  {(Object.keys(KIND_LABELS) as ClassKind[]).map((k) => (
                    <option key={k} value={k}>{KIND_LABELS[k]}</option>
                  ))}
                </select>
                <button className="icon-btn" onClick={() => removeCard(i)} aria-label={`Remove ${c.name || `class ${i + 1}`}`} title="Remove this class">✕</button>
              </div>
              <div className="class-card-body">
                {invalid && <div className="help" style={{ color: 'var(--bad)' }}>Use letters, digits and underscores, e.g. ParkingLot.</div>}
                <label className="field">
                  Responsibility: one sentence
                  <textarea
                    className="textarea"
                    rows={2}
                    placeholder="What does this class own and decide?"
                    value={c.responsibility}
                    onChange={(e) => setCard(i, { responsibility: e.target.value })}
                  />
                </label>
                <div className="members">
                  <label className="field">
                    Attributes
                    <textarea
                      className="textarea"
                      rows={rowsFor(c.attributes)}
                      placeholder={'size\noccupied'}
                      value={c.attributes.join('\n')}
                      onChange={(e) => setCard(i, { attributes: lines(e.target.value) })}
                      spellCheck={false}
                    />
                  </label>
                  <label className="field">
                    Methods
                    <textarea
                      className="textarea"
                      rows={rowsFor(c.methods)}
                      placeholder={'fits(vehicle)\nreserve()'}
                      value={c.methods.join('\n')}
                      onChange={(e) => setCard(i, { methods: lines(e.target.value) })}
                      spellCheck={false}
                    />
                  </label>
                </div>
                <div className="collabs">
                  <span>Works with:</span>
                  {collabs.length === 0 ? <span className="faint">nobody yet: add a relationship below</span> : collabs.map((n) => <span key={n} className="chip">{n}</span>)}
                </div>
              </div>
            </div>
          );
        })}
        <button className="add-card" onClick={() => emit({ ...data, classes: [...data.classes, emptyCard()] })}>
          + Add a class
        </button>
      </div>

      <div className="stack-sm">
        <h3>Relationships</h3>
        <p className="help">Read each row as a sentence: “<b>Car</b> extends <b>Vehicle</b>”, “<b>ParkingLot</b> owns <b>Level</b>”.</p>
        {data.relationships.length === 0 && <p className="muted small">No relationships yet. Connect your classes so reviewers can see who collaborates with whom.</p>}
        {data.relationships.map((r, i) => (
          <div key={i} className="rel-row">
            <select className="select" value={r.from} aria-label={`Relationship ${i + 1} source`} onChange={(e) => setRel(i, { from: e.target.value })}>
              <option value="">Class…</option>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <select className="select" value={r.kind} aria-label={`Relationship ${i + 1} kind`} title={RELATION_HELP[r.kind]} onChange={(e) => setRel(i, { kind: e.target.value as RelationKind })}>
              {(Object.keys(RELATION_LABELS) as RelationKind[]).map((k) => <option key={k} value={k}>{RELATION_LABELS[k]}</option>)}
            </select>
            <select className="select" value={r.to} aria-label={`Relationship ${i + 1} target`} onChange={(e) => setRel(i, { to: e.target.value })}>
              <option value="">Class…</option>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <input className="input" value={r.label} placeholder="label (optional)" aria-label={`Relationship ${i + 1} label`} onChange={(e) => setRel(i, { label: e.target.value })} />
            <button className="icon-btn" aria-label={`Remove relationship ${i + 1}`} onClick={() => emit({ ...data, relationships: data.relationships.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <div>
          <button className="btn btn-sm" disabled={names.length < 2} onClick={() => emit({ ...data, relationships: [...data.relationships, { from: '', to: '', kind: 'association', label: '' }] })}>
            + Add relationship
          </button>
          {names.length < 2 && <span className="help" style={{ marginLeft: 10 }}>Name at least two classes first.</span>}
        </div>
      </div>
    </div>
  );
}
