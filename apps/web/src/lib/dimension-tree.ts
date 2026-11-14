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

/**
 * What a grant editor offers (RP-1239): the active values, and an archived one only while `kept`
 * (what the grant already covers) holds it, so it can be unticked but never picked anew. The
 * settings pickers and lists use it too (RP-1251), with a record's own Trade as `kept`.
 */
export function pickable<T extends { id: string; active: boolean }>(values: T[], kept: ReadonlySet<string>): T[] {
  return values.filter((v) => v.active || kept.has(v.id));
}

/**
 * A Project's values without its Whole Project Location (RP-1304), for the grant editors and the
 * Settings tree: any Location covers it, so no grant lists it, and it is built in, never edited.
 */
export function grantable<T extends { wholeProject?: true }>(dimensions: { trade: T[]; location: T[] }): { trade: T[]; location: T[] } {
  return { trade: dimensions.trade, location: dimensions.location.filter((l) => !l.wholeProject) };
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
