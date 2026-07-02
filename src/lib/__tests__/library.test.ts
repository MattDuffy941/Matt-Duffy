import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteGroove, listGrooves, renameGroove, saveGroove } from '../library';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

const Q1 = '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|x---------------|&S=|----------------|&K=|----------------|';
const Q2 = '?TimeSig=4/4&Div=16&Tempo=120&Measures=1&H=|----------------|&S=|o---------------|&K=|----------------|';

describe('groove library', () => {
  it('starts empty', () => {
    expect(listGrooves()).toEqual([]);
  });

  it('saves and lists grooves, most recent first', () => {
    saveGroove('First', Q1, 1000);
    saveGroove('Second', Q2, 2000);
    const list = listGrooves();
    expect(list.map((g) => g.name)).toEqual(['Second', 'First']);
    expect(list[1].query).toBe(Q1);
  });

  it('upserts by name case-insensitively instead of duplicating', () => {
    saveGroove('My Beat', Q1, 1000);
    saveGroove('my beat', Q2, 2000);
    const list = listGrooves();
    expect(list).toHaveLength(1);
    expect(list[0].query).toBe(Q2);
    expect(list[0].name).toBe('my beat');
  });

  it('deletes by id', () => {
    const a = saveGroove('A', Q1, 1000);
    saveGroove('B', Q2, 2000);
    deleteGroove(a.id);
    expect(listGrooves().map((g) => g.name)).toEqual(['B']);
  });

  it('renames by id', () => {
    const a = saveGroove('Old', Q1, 1000);
    renameGroove(a.id, 'New name');
    expect(listGrooves()[0].name).toBe('New name');
  });

  it('survives corrupted storage', () => {
    store.set('grooveBuilder.savedGrooves.v1', '{not json');
    expect(listGrooves()).toEqual([]);
    saveGroove('Recovered', Q1, 1000);
    expect(listGrooves()).toHaveLength(1);
  });

  it('persists across reads (round-trips through storage)', () => {
    saveGroove('Keeper', Q1, 1000);
    const list = listGrooves();
    expect(list[0].name).toBe('Keeper');
    expect(list[0].savedAt).toBe(1000);
  });
});
