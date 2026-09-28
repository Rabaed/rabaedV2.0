// The Location tree as the screens show it. Trades are flat, so they come out as given.

type Node = { id: string; parentId: string | null };

/**
 * Values in tree order: each one right after its parent, with its indent level.
 * The top-most values given are level 0, so part of a tree (what a Participant
 * covers) reads the same as the whole.
 */
export function treeOrder<T extends Node>(values: T[]): (T & { level: number })[] {
  const ids = new Set(values.map((v) => v.id));
  const children = new Map<string | null, T[]>();
  for (const v of values) {
    const parent = v.parentId !== null && ids.has(v.parentId) ? v.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), v]);
  }
  const out: (T & { level: number })[] = [];
  const visit = (parent: string | null, level: number) => {
    for (const v of children.get(parent) ?? []) {
      out.push({ ...v, level });
      visit(v.id, level + 1);
    }
  };
  visit(null, 0);
  return out;
}

/** The values covered through a selected ancestor: granting a Location covers everything beneath it. */
export function impliedBySelection(values: Node[], selected: ReadonlySet<string>): Set<string> {
  const parentOf = new Map(values.map((v) => [v.id, v.parentId]));
  const implied = new Set<string>();
  for (const v of values) {
    for (let p = v.parentId; p !== null && p !== undefined; p = parentOf.get(p) ?? null) {
      if (selected.has(p)) {
        implied.add(v.id);
        break;
      }
    }
  }
  return implied;
}
