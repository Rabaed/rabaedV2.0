// The one "no due date" check for the api tests of what Rabaed prints (RP-1150). CLAUDE.md: Rabaed shows no due
// dates, deadlines or SLAs, only Step Age, and never writes "overdue". A test of a PDF, an export or a JSON answer
// calls this instead of keeping a regex of its own: the first one, /overdue|deadline|duedate|sla/, matched inside
// other words, so a Company or person named "Islam" failed it at random (#536 left the merge queue).
// `deadlineWordInCopy` in packages/eslint-plugin/src/matchers.ts is the same rule for the lint rules and the ui and
// mailer tests; @rabaed/api has no dependency on that package (a dependencies-only PR would add one), so this is
// the api tests' copy. A change to the rule goes in both.
import { expect } from "vitest";

// Whole words, any case. Bare "due" counts ("Payment due") except "due to", which gives a reason, not a date.
// \b is ASCII only, so the Arabic words (late, final date, due date) are matched as they stand.
const deadlineWord = /\b(?:overdue|deadlines?|due[\s_-]?dates?|due(?!\s+to\b)|slas?)\b|متأخر|موعد نهائي|تاريخ الاستحقاق/i;

/** The text with identifiers split into words: a hump or an underscore ends a word ("isOverdue", "sla_days"). */
function withWordsApart(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}

/**
 * The first deadline word in `text` (as the text reads after identifiers are split), or null. A key `isOverdue`
 * or `sla_days` is caught while "Islam" and "translation" pass. A deadline word inside a longer phrase still
 * counts: "deadlines-free" is a mention. The text needs its words apart: a PDF's squeezed text has none.
 */
export function deadlineWordIn(text: string): string | null {
  return deadlineWord.exec(withWordsApart(text))?.[0] ?? null;
}

/** Fails, naming the word and its surroundings, when `text` holds a deadline word. `what` says what was read. */
export function expectNoDeadlineWords(text: string, what = "the text"): void {
  const apart = withWordsApart(text);
  const found = deadlineWord.exec(apart);
  if (found === null) return;
  const around = apart.slice(Math.max(0, found.index - 30), found.index + found[0].length + 30).replaceAll("\n", " ");
  expect.fail(`${what} holds the deadline word "${found[0]}" near "...${around}...": Rabaed shows Step Age only (CLAUDE.md).`);
}
