/** The letter tile's classes, one per colour: tomato, blue, green, purple, orange (the design kit's Projects page). Static so Tailwind finds them. */
export const projectTileClasses = ["bg-project-tile-1", "bg-project-tile-2", "bg-project-tile-3", "bg-project-tile-4", "bg-project-tile-5"] as const;

/** A Project's own colour, from its id alone: the same on every page and for every Member. */
export function projectTileIndex(projectId: string): number {
  let sum = 0;
  for (const char of projectId) sum = (sum * 31 + char.codePointAt(0)!) % 997;
  return sum % projectTileClasses.length;
}

/**
 * The tile colours for Projects in the order a list shows them. Each Project
 * starts from its own colour (`projectTileIndex`); when that is the colour of the
 * card before it, it takes the next colour of the palette instead, so neighbours in
 * a list differ. So a Project keeps its colour wherever the Projects before it
 * don't clash with it, and the first card of any list always has its own.
 */
export function projectTileIndexes(projectIds: readonly string[]): number[] {
  const indexes: number[] = [];
  for (const id of projectIds) {
    let index = projectTileIndex(id);
    if (index === indexes.at(-1)) index = (index + 1) % projectTileClasses.length;
    indexes.push(index);
  }
  return indexes;
}
