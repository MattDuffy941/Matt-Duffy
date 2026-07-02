import { SavedGroove } from '../lib/library';

interface Props {
  grooves: SavedGroove[];
  onLoad: (query: string) => void;
  onDelete: (id: string) => void;
}

export function SavedGrooves({ grooves, onLoad, onDelete }: Props) {
  return (
    <details className="saved-grooves">
      <summary>My Grooves ({grooves.length})</summary>
      {grooves.length === 0 ? (
        <p className="saved-empty">
          Nothing saved yet — write a groove and press <strong>Save</strong>.
        </p>
      ) : (
        <ul>
          {grooves.map((g) => (
            <li key={g.id}>
              <button className="saved-load" onClick={() => onLoad(g.query)} title="Open this groove">
                {g.name}
              </button>
              <span className="saved-date">{new Date(g.savedAt).toLocaleDateString()}</span>
              <button
                className="saved-delete"
                onClick={() => {
                  if (window.confirm(`Delete "${g.name}"?`)) onDelete(g.id);
                }}
                title="Delete"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
