/**
 * "My Grooves" — a local library of saved grooves.
 *
 * Persisted in localStorage as canonical URL query strings, so a saved groove
 * restores the full document (title, tempo, all lanes) on load. Storage is
 * device-local, offline, no account. In the iOS wrapper the WKWebView keeps
 * this store across launches, so the same code powers saving there too.
 *
 * All access is guarded so a missing/blocked localStorage (private mode, SSR)
 * degrades to an empty, no-op library rather than throwing.
 */

export interface SavedGroove {
  id: string;
  name: string;
  /** Canonical URL query string, e.g. "?TimeSig=4/4&…". */
  query: string;
  savedAt: number;
}

const KEY = 'grooveBuilder.savedGrooves.v1';

function read(): SavedGroove[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (g): g is SavedGroove =>
        g && typeof g.id === 'string' && typeof g.name === 'string' && typeof g.query === 'string',
    );
  } catch {
    return [];
  }
}

function write(list: SavedGroove[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — silently no-op */
  }
}

function makeId(now: number): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `g_${now}_${read().length}`;
}

/** Saved grooves, most-recently-saved first. */
export function listGrooves(): SavedGroove[] {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Save (upsert by name, case-insensitive). Re-saving under an existing name
 * updates that entry in place rather than creating a duplicate.
 */
export function saveGroove(name: string, query: string, now: number = Date.now()): SavedGroove {
  const trimmed = name.trim();
  const list = read();
  const existing = list.find((g) => g.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    existing.query = query;
    existing.savedAt = now;
    existing.name = trimmed; // adopt the new capitalisation
    write(list);
    return existing;
  }
  const entry: SavedGroove = { id: makeId(now), name: trimmed, query, savedAt: now };
  list.push(entry);
  write(list);
  return entry;
}

export function deleteGroove(id: string): void {
  write(read().filter((g) => g.id !== id));
}

export function renameGroove(id: string, name: string): void {
  const list = read();
  const g = list.find((x) => x.id === id);
  if (g) {
    g.name = name.trim();
    write(list);
  }
}
