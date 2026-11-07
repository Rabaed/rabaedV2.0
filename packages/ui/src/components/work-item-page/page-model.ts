
/**
 * A small read the Submittal Panel's action bar draws from (RP-1151, RP-1237), worked out apart from
 * React so it is tested on its own. It reads only what the Workflow map read already gives the viewer.
 */

/**
 * The Review Code each offered Transition issues, by its key (gap table row 27): the outcome its
 * Workflow's close Transition of that key sets. A Transition that sets none has no code; so does
 * every one while the Workflow map isn't read.
 */
export function transitionCodes(
  offered: readonly { key: string }[],
  definition: { transitions: readonly { key: string; kind: string; outcome?: string | null }[] } | null,
): Record<string, string> {
  if (!definition) return {};
  const byKey = new Map(definition.transitions.map((t) => [t.key, t]));
  return Object.fromEntries(
    offered.flatMap((t) => {
      const defined = byKey.get(t.key);
      return defined?.kind === "close" && defined.outcome ? [[t.key, defined.outcome]] : [];
    }),
  );
}
