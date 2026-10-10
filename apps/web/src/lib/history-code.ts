/**
 * The Code to show after a history move's label, or null when there is none or the
 * label already names it (a Code Transition's label reads "Approve · A"): one Code,
 * never "Approve · A A" (RP-409, the Download's history).
 */
export function codeAfterLabel(label: string | null, outcome: string | null): string | null {
  if (outcome === null) return null;
  if (label === null) return outcome;
  const words = label.split(/[\s·:,()–-]+/).filter(Boolean);
  return words.includes(outcome) ? null : outcome;
}
