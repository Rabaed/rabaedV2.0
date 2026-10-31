import {
  answerFields,
  formatFormValue,
  linksChangeField,
  linksChangeValue,
  type AnswerField,
  type DocumentSummary,
  type FormSchema,
  type Locale,
  type OptionList,
  type WorkItemHistory,
} from "@rabaed/domain";

/**
 * What a history entry says beyond its move, worked out once for both pages that show it: the old
 * item page's History (Snag List, WIR) and the Work Item page's "Details" (RP-1151). The rule that a
 * diff never names an id lives here only.
 */

type Event = WorkItemHistory["events"][number];
type Change = NonNullable<Event["changes"]>[number];

/** The words the details need, from `workItems.history`. */
export type HistoryDetailsWords = {
  emptyAnswer: string;
  changedValue: string;
  linksField: string;
  files: string;
};

// Answers that hold ids (Built-in Fields, people and Companies) are named only on the Form itself;
// a diff says they changed, never the ids.
const idTypes: ReadonlySet<string> = new Set(["trade", "location", "scopes", "member", "participant", "approved_supplier", "checklist_template"]);

/**
 * Answers the history gives an event as its own line (app.work_item_history's `reason` and `remarks`,
 * read from the same answers), so a reply's answers don't repeat them.
 */
const ownLines: ReadonlySet<string> = new Set(["reason", "remarks"] satisfies (keyof Event)[]);

const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** One changed answer in words: "Field: old → new", "Field: changed" for an id, the free Links by number and Subject. */
export function changeText(change: Change, schema: FormSchema, optionLists: readonly OptionList[], locale: Locale, words: HistoryDetailsWords): string {
  const arrow = locale === "ar" ? "←" : "→";
  if (change.field === linksChangeField) {
    const links = (v: unknown) => {
      const parsed = linksChangeValue.safeParse(v);
      if (!parsed.success || parsed.data.length === 0) return words.emptyAnswer;
      return parsed.data.map((l) => `\u2066${l.documentNumber}\u2069 ${l.subject}`).join(", ");
    };
    return `${words.linksField}: ${links(change.old)} ${arrow} ${links(change.new)}`;
  }
  const field = answerFields(schema).find((f) => f.key === change.field);
  const label = field?.label[locale] ?? change.field;
  if (field && idTypes.has(field.type)) return `${label}: ${words.changedValue}`;
  const value = (v: unknown) => (empty(v) ? words.emptyAnswer : field ? formatFormValue(field, v, locale, undefined, optionLists) : String(v));
  return `${label}: ${value(change.old)} ${arrow} ${value(change.new)}`;
}

/**
 * A reply's answers (RP-437): each answered field of the Action Form it was given in, once, but for
 * those the history shows as their own lines, and any `skip`ped (the Work Item page shows the Cover
 * Note as the entry's text).
 */
export function replyAnswers(event: Event, skip: ReadonlySet<string> = new Set()): (readonly [AnswerField, unknown])[] {
  const answers = event.answers;
  if (!answers || !event.answersForm) return [];
  return answerFields(event.answersForm)
    .filter((f) => !ownLines.has(f.key) && !skip.has(f.key) && !empty(answers[f.key]))
    .map((f) => [f, answers[f.key]] as const);
}

/** The reply files a Transition took (ADR 0024), by the Screen field they were added to. */
export function replyFiles(event: Event, documents: readonly DocumentSummary[], locale: Locale, words: Pick<HistoryDetailsWords, "files">): (readonly [string, string[]])[] {
  const byId = new Map(documents.map((d) => [d.id, d]));
  const taken = (event.files ?? []).flatMap((id) => byId.get(id) ?? []);
  const labels = new Map(event.answersForm ? answerFields(event.answersForm).map((f) => [f.key, f.label[locale]]) : []);
  const keys = [...new Set(taken.map((d) => d.fieldKey ?? ""))];
  return keys.map((key) => [labels.get(key) ?? words.files, taken.filter((d) => (d.fieldKey ?? "") === key).map((d) => d.fileName)] as const);
}
