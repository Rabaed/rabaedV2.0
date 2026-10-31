// The one "no due date" check for tests of what Rabaed prints (RP-1150). CLAUDE.md: Rabaed shows no due
// dates, deadlines or SLAs, only Step Age, and never writes "overdue". A test of a PDF, an export or a
// JSON answer calls this instead of keeping a regex of its own: the first one, /overdue|deadline|duedate|sla/,
// matched inside other words, so a Company or person named "Islam" failed it at random (#536 left the queue).
import { expect } from "vitest";

// Whole words, any case. Bare "due" counts ("Payment due") except "due to", which gives a reason, not a date.
// \b is ASCII only, so the Arabic words (late, final date, due date) are matched as they stand.
const deadlineWord = /\b(?:overdue|deadlines?|due[\s_-]?dates?|due(?!\s+to\b)|slas?)\b|متأخر|موعد نهائي|تاريخ الاستحقاق/i;

/**
 * The first deadline word in `text` (as the text reads after identifiers are split), or null. A hump or an
 * underscore ends a word, so a JSON key `isOverdue` or `sla_days` is caught while "Islam" and "translation"
 * pass. A deadline word inside a longer phrase still counts: "deadlines-free" is a mention.
 */
export function deadlineWordIn(text: string): string | null {
  const words = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ");
  return deadlineWord.exec(words)?.[0] ?? null;
}

/** Fails, naming the word and its surroundings, when `text` holds a deadline word. `what` says what was read. */
export function expectNoDeadlineWords(text: string, what = "the text"): void {
  const word = deadlineWordIn(text);
  if (word === null) return;
  const at = text.toLowerCase().indexOf(word.toLowerCase().split(" ")[0]!);
  const around = at < 0 ? "" : ` near ...${text.slice(Math.max(0, at - 30), at + 40).replaceAll("\n", " ")}...`;
  expect.fail(`${what} holds the deadline word "${word}"${around}: Rabaed shows Step Age only (CLAUDE.md).`);
}
