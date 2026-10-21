// Which Jira tickets does a merged pull request close? (RP-307)
//
// Pure parsing, no I/O. A key is closed when it is named in the head branch
// (`RP-296-auto-screenshot-baselines`) or listed after Closes / Fixes / Resolves
// in the PR body (`Closes RP-1, RP-2 and RP-3`). A key only mentioned in passing
// ("see RP-6") is left alone, and so is any other project's key.
//
// Keys match in any case and come back upper-cased: the desktop app names its
// branches in lower case (`claude/rp-627-site-observation-5b2be5`, RP-986).

const key = String.raw`(?<![A-Za-z0-9])RP-\d+(?!\d)`;
const keyPattern = new RegExp(key, "gi");
// Keyword, optional colon, then a list of keys separated by commas, "and", "&" or spaces.
const closingList = new RegExp(
  String.raw`(?<![A-Za-z0-9])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?![A-Za-z0-9]):?[ \t]+((?:${key}(?:[ \t]*(?:,|&|\band\b)[ \t]*|[ \t]+)?)+)`,
  "gi",
);

export interface MergedPullRequest {
  /** Head branch name. */
  branch: string;
  body: string | null | undefined;
}

/** Keys to close, each once, in the order they appear (branch first). */
export function keysToClose({ branch, body }: MergedPullRequest): string[] {
  const found = new Set<string>((branch.match(keyPattern) ?? []).map((k) => k.toUpperCase()));
  for (const list of (body ?? "").matchAll(closingList)) {
    for (const match of (list[1] ?? "").matchAll(keyPattern)) found.add(match[0].toUpperCase());
  }
  return [...found];
}
