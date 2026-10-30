import { expect } from "vitest";

// A "hidden from X" assert that can't pass on an empty result (RP-1095). An empty read passes
// for the wrong reason when the row was never made, or a step before it failed: chat-rls once
// asserted [] before anything was posted. So the row is read first by a viewer who may see it,
// then not read by each one who may not; both by id, never by a count or a title, since
// another row with the same title proves nothing.

export type HiddenFromOptions<V, R> = {
  /** The rows `viewer` reads: a list, or the one row a read by id gives (an empty list when refused). */
  read: (viewer: V) => Promise<readonly R[]>;
  /** The id of the row that must be hidden. */
  target: string;
  /** Who may see it: each must read it, so the row exists and the read works. */
  seenBy: V | readonly V[];
  /** Who may not: none reads it. */
  hiddenFrom: V | readonly V[];
  /** A row's id; `row.id` when left out. */
  idOf?: (row: R) => string;
  /** How a viewer is named in a failure; `String(viewer)` when left out. */
  name?: (viewer: V) => string;
  /** Prefixes each failure, e.g. the read or the scenario. */
  label?: string;
};

const list = <V>(value: V | readonly V[]): readonly V[] => (Array.isArray(value) ? (value as readonly V[]) : [value as V]);

/** `target` is read by every viewer in `seenBy`, first, and by none in `hiddenFrom`. */
export async function expectHiddenFrom<V, R>(options: HiddenFromOptions<V, R>): Promise<void> {
  const { read, target, label } = options;
  const idOf = options.idOf ?? ((row: R) => (row as { id: string }).id);
  const name = options.name ?? ((viewer: V) => String(viewer));
  const seenBy = list(options.seenBy);
  const hiddenFrom = list(options.hiddenFrom);
  const at = label === undefined ? "" : `${label}: `;
  if (seenBy.length === 0) throw new Error(`${at}seenBy names nobody: a hidden-from assert needs a viewer who reads the row first`);
  if (hiddenFrom.length === 0) throw new Error(`${at}hiddenFrom names nobody`);

  for (const viewer of seenBy) {
    const ids = (await read(viewer)).map(idOf);
    expect(ids, `${at}${name(viewer)} must read ${target} first, or the hidden-from assert proves nothing`).toContain(target);
  }
  for (const viewer of hiddenFrom) {
    const ids = (await read(viewer)).map(idOf);
    expect(ids, `${at}${name(viewer)} must not read ${target}`).not.toContain(target);
  }
}
