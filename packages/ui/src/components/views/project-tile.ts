/** The letter tile's classes, one per colour: tomato, blue, green, purple, orange (the design kit's Projects page). Static so Tailwind finds them. */
export const projectTileClasses = ["bg-project-tile-1", "bg-project-tile-2", "bg-project-tile-3", "bg-project-tile-4", "bg-project-tile-5"] as const;

/** Which of the five colours a Project's tile has: from its id alone, so it is the same on every page, every visit and for every Member. */
export function projectTileIndex(projectId: string): number {
  let sum = 0;
  for (const char of projectId) sum = (sum * 31 + char.codePointAt(0)!) % 997;
  return sum % projectTileClasses.length;
}
