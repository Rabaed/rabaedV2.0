import {
  formatDate,
  formFields,
  isFileField,
  isRequired,
  isUnanswered,
  type FormSchema,
  type Locale,
  type ModuleKey,
  type NewItemRoutePreview,
} from "@rabaed/domain";
import type { NewItemRequiredItem, SubmittalPanelLayout } from "@rabaed/ui";

// The create panel's logic (RP-1152), apart from React so it is tested on its own.

/** "Add Submittal" shows, and the panel offers a Form, only to a Member who may raise a Submittals Type and whose Visibility covers a Trade (decision 6). */
export function canRaise(raisable: { types: readonly unknown[] } | null, covered: { trade: readonly unknown[] } | null): boolean {
  return (raisable?.types.length ?? 0) > 0 && (covered?.trade.length ?? 0) > 0;
}

/**
 * What the Form requires before Send for Review (rows 25, 33): the Subject, then each required
 * field in the Form's order (Trade and Location always). A Documents field is done once it holds a
 * file (`filedFields`), every other once answered.
 */
export function requiredItems(input: {
  schema: FormSchema;
  answers: Readonly<Record<string, unknown>>;
  subject: string;
  subjectLabel: string;
  filedFields: ReadonlySet<string>;
  locale: Locale;
}): NewItemRequiredItem[] {
  const { schema, answers, subject, subjectLabel, filedFields, locale } = input;
  const answered = (value: unknown) => !isUnanswered(typeof value === "string" ? value.trim() : value);
  return [
    { key: "subject", label: subjectLabel, done: subject.trim() !== "" },
    ...formFields(schema).flatMap((field) =>
      isRequired(field, answers) && "label" in field
        ? [{ key: field.key, label: field.label[locale], done: isFileField(field) ? filedFields.has(field.key) : answered(answers[field.key]) }]
        : [],
    ),
  ];
}

/** A Form Section shown locked before the first save (row 29): one that holds only Documents fields, a greyed slot per field. */
export type LockedDocumentSection = { sectionKey: string; slots: { key: string; label: string; icon: "file-text" | "photo" }[] };

export function lockedDocumentSections(schema: FormSchema, locale: Locale): LockedDocumentSection[] {
  return schema.sections.flatMap((section) =>
    section.fields.length > 0 && section.fields.every(isFileField)
      ? [{ sectionKey: section.key, slots: section.fields.filter(isFileField).map((f) => ({ key: f.key, label: f.label[locale], icon: f.type === "photos" ? ("photo" as const) : ("file-text" as const) })) }]
      : [],
  );
}

/** The Draft Step the raiser starts at: the Step at the Draft Stage; the route preview's own position. */
export function draftStepKey(preview: Pick<NewItemRoutePreview, "definition" | "stages">): string | null {
  const draft = new Set(preview.stages.filter((s) => s.category === "draft").map((s) => s.key));
  return preview.definition.steps.find((s) => draft.has(s.stage))?.key ?? null;
}

/**
 * What the panel holds after a save (row 13): `stay` keeps the new Draft open with every answer
 * (the Submittals); `clear` empties the Form for the next one, keeping the `keep` fields (a Snag's Trade and Location).
 */
export type AfterSave = { mode: "stay" } | { mode: "clear"; keep?: readonly string[] };

export function afterSaveAnswers(answers: Readonly<Record<string, unknown>>, afterSave: AfterSave): Record<string, unknown> {
  if (afterSave.mode === "stay") return { ...answers };
  const keep = new Set(afterSave.keep ?? []);
  return Object.fromEntries(Object.entries(answers).filter(([key]) => keep.has(key)));
}

/** Something was typed before the first save, so Cancel asks first (row 37): a Subject, or an answer the Form didn't start with. */
export function typedSomething({ subject, answers, start }: { subject: string; answers: Readonly<Record<string, unknown>>; start: Readonly<Record<string, unknown>> }): boolean {
  if (subject.trim() !== "") return true;
  return Object.entries(answers).some(([key, value]) => !(isUnanswered(value) && isUnanswered(start[key])) && JSON.stringify(value) !== JSON.stringify(start[key]));
}

/** "10:42": when the Draft was last saved (`at`, ISO), in Saudi time, 24-hour, Latin digits in both languages (row 38). */
export function savedClock(at: string, locale: Locale): string {
  return formatDate(new Date(at), locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** The media queries the layout follows: a phone below 768px, a tablet from 768px to 1023px; from 1024px the slide-over (decision 1). */
export const phoneQuery = "(max-width: 767px)";
export const tabletQuery = "(max-width: 1023px)";

/** The read of the Types a Module (the Submittals by default) lets the viewer raise on a Project: one rule for the server's read and the browser's. */
export function raisableTypesPath(projectId: string, module: ModuleKey = "submittals"): string {
  const query = module === "submittals" ? "" : `?module=${module}`;
  return `/v1/projects/${encodeURIComponent(projectId)}/raisable-types${query}`;
}

/**
 * The saved Draft in the URL (row 38). After the first save the create panel's URL holds the new
 * item's id beside its Type, `?new=MAR&draft=<id>` (`newSubmittalPanelHref`, `newItemFrom`), so a
 * reload or Esc keeps it: the panel reopens after its save, read from `GET /v1/work-items/:id` and
 * its Form. It reopens only the viewer's own first Draft, still unnumbered, of a Type they may raise
 * on this Project; anything else (hidden, gone, Submitted, another's) is a fresh create panel that
 * names nothing. Closing the panel drops `new` and `draft` together.
 */
export function resumableDraft(
  item: {
    projectId: string;
    type: { code: string };
    documentNumber: string | null;
    revisionNo: number;
    stage: { category: string };
    actions: { saveAnswers: boolean };
  } | null,
  { projectId, types }: { projectId: string; types: readonly { code: string }[] },
): boolean {
  if (item === null) return false;
  return (
    item.projectId === projectId &&
    item.stage.category === "draft" &&
    item.documentNumber === null &&
    item.revisionNo === 0 &&
    item.actions.saveAnswers &&
    types.some((t) => t.code === item.type.code)
  );
}

/** The panel's layout: a page on a phone, the full width on a tablet, the slide-over with its grip and sizes on a desktop. */
export function createSubmittalPanelLayout({ phone, tablet }: { phone: boolean; tablet: boolean }): SubmittalPanelLayout {
  return phone ? "page" : tablet ? "tablet-full" : "slide-over";
}
