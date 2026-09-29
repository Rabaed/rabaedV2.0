const arabicScript = /\p{Script=Arabic}/u;

/**
 * The initials Avatar shows for a name: the first letters of the first two
 * words, upper-cased. Arabic letters join, so two would read as a word: an
 * Arabic name gets its first letter only.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  if (arabicScript.test(first)) return first;
  return (first + (words[1]?.[0] ?? "")).toUpperCase();
}
