import { isAnswerField, type FormField } from "@rabaed/domain";

/** How many answers a folded section's header shows. */
const shown = 2;

/**
 * The one line a folded Form section's header shows (RP-1151, gap table row 44): its first two
 * answered fields, as the reader reads them (`text`), joined by " · "; null when it has none.
 * Layout fields hold no answer, and an answer that only reads as spaces counts as none.
 */
export function formSectionSummary(fields: readonly FormField[], text: (field: FormField) => string | null): string | null {
  const answers: string[] = [];
  for (const field of fields) {
    if (answers.length === shown) break;
    if (!isAnswerField(field)) continue;
    const answer = text(field)?.replace(/\s+/g, " ").trim();
    if (answer) answers.push(answer);
  }
  return answers.length === 0 ? null : answers.join(" · ");
}
