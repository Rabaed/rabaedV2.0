import {
  answerFields,
  formatFormValue,
  linksChangeField,
  linksChangeValue,
  type DocumentSummary,
  type FormSchema,
  type Locale,
  type OptionList,
  type WorkItemHistory as History,
} from "@rabaed/domain";
import { DocNo } from "@rabaed/ui";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { historyMoveLabel } from "@/lib/history-move-label";

type Event = History["events"][number];
type Change = NonNullable<Event["changes"]>[number];

// Answers that hold ids (Built-in Fields, people and Companies) are named only on
// the Form itself; a diff says they changed, never the ids.
const idTypes = new Set(["trade", "location", "scopes", "member", "participant", "approved_supplier", "checklist_template"]);
/**
 * Answers the history gives an event as its own line (app.work_item_history's `reason`
 * and `remarks`, read from the same answers), so a reply's answers don't repeat them.
 */
const ownLines: ReadonlySet<string> = new Set(["reason", "remarks"] satisfies (keyof Event)[]);

/**
 * A Work Item's history as the viewer may see it. The API already leaves out
 * other Companies' internal events (V5); internal ones shown here are marked as
 * seen only by the viewer's own Company. A change to the answers after Draft
 * lists each field, labelled from the item's Form, with its old and new value.
 */
export async function WorkItemHistory({
  events,
  imported = null,
  projectId,
  schema,
  optionLists,
  documents = [],
  locale,
}: {
  events: Event[];
  /**
   * The Submittal Register Import that created the Draft, for its importing Company only
   * (story 35, RP-645): by whom ("Rabaed" for a Rabaed Engineer's), from which register, linked
   * to the import's page. Undated, as the import's time is when the Draft was started (scenario 61).
   */
  imported?: History["imported"] | null;
  projectId: string;
  schema: FormSchema;
  optionLists: readonly OptionList[];
  /** The item's Documents the viewer sees, to name the reply files a Transition took (ADR 0024). */
  documents?: readonly DocumentSummary[];
  locale: Locale;
}) {
  const t = await getTranslations("workItems.history");
  const format = await getFormatter();

  const what = (e: Event) => historyMoveLabel(e, locale, t);
  const fields = new Map(answerFields(schema).map((f) => [f.key, f]));
  const value = (change: Change, v: unknown) => {
    const field = fields.get(change.field);
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return t("emptyAnswer");
    return field ? formatFormValue(field, v, locale, undefined, optionLists) : String(v);
  };
  // The free Links (the Links System Field): each Link by its Document Number and Subject, never an id.
  const linksText = (v: unknown) => {
    const links = linksChangeValue.safeParse(v);
    if (!links.success || links.data.length === 0) return t("emptyAnswer");
    return links.data.map((l) => `\u2066${l.documentNumber}\u2069 ${l.subject}`).join(", ");
  };
  const changeText = (change: Change) => {
    if (change.field === linksChangeField) {
      return `${t("linksField")}: ${linksText(change.old)} ${locale === "ar" ? "←" : "→"} ${linksText(change.new)}`;
    }
    const field = fields.get(change.field);
    const label = field?.label[locale] ?? change.field;
    if (field && idTypes.has(field.type)) return `${label}: ${t("changedValue")}`;
    return `${label}: ${value(change, change.old)} ${locale === "ar" ? "←" : "→"} ${value(change, change.new)}`;
  };
  // A reply's answers (RP-437): the Cover Note with a Submit, the final verification with
  // a Code, a reply's internal answers for its own Company; labelled from the Action Form
  // they were given in, each answered field once.
  const replyAnswers = (e: Event) => {
    const answers = e.answers;
    if (!answers || !e.answersForm) return [];
    return answerFields(e.answersForm)
      .filter((f) => !ownLines.has(f.key) && answers[f.key] !== undefined && answers[f.key] !== null && answers[f.key] !== "")
      .map((f) => [f, answers[f.key]] as const);
  };
  // The reply files a Transition took (ADR 0024), by the Screen field they were added to.
  const byId = new Map(documents.map((d) => [d.id, d]));
  const replyFiles = (e: Event) => {
    const taken = (e.files ?? []).flatMap((id) => byId.get(id) ?? []);
    const labels = new Map(e.answersForm ? answerFields(e.answersForm).map((f) => [f.key, f.label[locale]]) : []);
    const keys = [...new Set(taken.map((d) => d.fieldKey ?? ""))];
    return keys.map((key) => [labels.get(key) ?? t("files"), taken.filter((d) => (d.fieldKey ?? "") === key).map((d) => d.fileName)] as const);
  };
  const who = (e: Event) =>
    [e.by.memberName?.[locale], e.by.companyName?.[locale]].filter((part): part is string => Boolean(part)).join(" · ");

  return (
    <section className="space-y-3">
      <h2 className="text-h6 font-semibold">{t("title")}</h2>
      <ol className="divide-y divide-border border-y border-border" data-testid="work-item-history">
        {[...events].reverse().map((e) => {
          const answers = replyAnswers(e);
          const files = replyFiles(e);
          return (
          <li key={e.seq} className="space-y-1 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{what(e)}</span>
              <time dateTime={e.at} className="text-sm text-muted">
                {format.dateTime(new Date(e.at), {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Riyadh",
                  numberingSystem: "latn",
                })}
              </time>
            </div>
            <p className="text-sm text-muted">
              {who(e)}
              {e.fromStep && e.toStep && ` · ${e.fromStep[locale]} ${locale === "ar" ? "←" : "→"} ${e.toStep[locale]}`}
            </p>
            {e.documentNumber && (
              <p className="text-sm">
                {t("numbered")} <DocNo value={e.documentNumber} />
              </p>
            )}
            {/* A Transition's reason text; an `assigned` event's label already says why (never "only_member"). */}
            {e.reason && e.type !== "assigned" && <p className="whitespace-pre-wrap">{e.reason}</p>}
            {e.remarks && (
              <p className="whitespace-pre-wrap" data-testid="history-remarks">
                <span className="font-medium">{t("remarks")}:</span> {e.remarks}
              </p>
            )}
            {answers.length > 0 && (
              <dl className="space-y-0.5 text-sm" data-testid="history-answers">
                {answers.map(([field, v]) => (
                  <div key={field.key} className="whitespace-pre-wrap">
                    <dt className="inline font-medium">{field.label[locale]}:</dt>{" "}
                    <dd className="inline">
                      <bdi>{formatFormValue(field, v, locale, undefined, optionLists)}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {files.length > 0 && (
              <dl className="space-y-0.5 text-sm" data-testid="history-files">
                {files.map(([label, names]) => (
                  <div key={label}>
                    <dt className="inline font-medium">{label}:</dt>{" "}
                    <dd className="inline">
                      <bdi>{names.join(", ")}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {e.recommendedCode && (
              <p data-testid="history-recommended-code">
                <span className="font-medium">{t("recommendedCode")}:</span> {e.recommendedCode}
              </p>
            )}
            {e.internalNote && <p className="whitespace-pre-wrap">{e.internalNote}</p>}
            {e.changes && e.changes.length > 0 && (
              <ul className="space-y-0.5 text-sm" data-testid="answer-changes">
                {e.changes.map((change) => (
                  <li key={change.field} className="whitespace-pre-wrap">
                    <bdi>{changeText(change)}</bdi>
                  </li>
                ))}
              </ul>
            )}
            {e.audience === "internal" && <p className="text-xs text-muted">{t("internal")}</p>}
          </li>
          );
        })}
        {imported && (
          <li className="py-3 text-sm" data-testid="history-imported">
            <Link href={`/projects/${projectId}/work-items/imports/${imported.importId}`} className="font-medium text-brand-fg underline-offset-4 hover:underline">
              {t("imported", {
                // Isolated, so a Latin register in an Arabic line keeps its order.
                fileName: `\u2068${imported.fileName}\u2069`,
                by: imported.byRabaed ? t("rabaed") : (imported.memberName?.[locale] ?? t("rabaed")),
              })}
            </Link>
          </li>
        )}
      </ol>
    </section>
  );
}
