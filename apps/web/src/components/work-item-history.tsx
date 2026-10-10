import {
  answerFields,
  formatFormValue,
  linksChangeField,
  linksChangeValue,
  type FormSchema,
  type Locale,
  type OptionList,
  type WorkItemHistory as History,
} from "@rabaed/domain";
import { DocNo } from "@rabaed/ui";
import { getFormatter, getTranslations } from "next-intl/server";

type Event = History["events"][number];
type Change = NonNullable<Event["changes"]>[number];

// Answers that hold ids (Built-in Fields, people and Companies) are named only on
// the Form itself; a diff says they changed, never the ids.
const idTypes = new Set(["trade", "location", "scopes", "member", "participant"]);

/**
 * A Work Item's history as the viewer may see it. The API already leaves out
 * other Companies' internal events (V5); internal ones shown here are marked as
 * seen only by the viewer's own Company. A change to the answers after Draft
 * lists each field, labelled from the item's Form, with its old and new value.
 */
export async function WorkItemHistory({
  events,
  schema,
  optionLists,
  locale,
}: {
  events: Event[];
  schema: FormSchema;
  optionLists: readonly OptionList[];
  locale: Locale;
}) {
  const t = await getTranslations("workItems.history");
  const format = await getFormatter();

  const what = (e: Event) => {
    if ((e.type === "transition" || e.type === "issue_code") && e.transition) return e.transition[locale];
    if (e.type === "internal_note") {
      return e.transition ? t("internalNoteWith", { transition: e.transition[locale] }) : t("internalNote");
    }
    // A reply's answers internal to the viewer's own Participant (RP-516, V5).
    if (e.type === "internal_answers" && e.transition) return t("internalAnswersWith", { transition: e.transition[locale] });
    if (e.type === "recommend_code") return t("recommendedCode");
    if (e.type === "picked_up" || e.type === "claimed") return t("pickedUp");
    if (e.type === "returned_to_pool" || e.type === "released") return t("returnedToPool");
    // A Handover (RP-108): from whom to whom and why, internal to the holding Participant.
    if (e.type === "assigned" && e.handover) {
      return t("handedOver", { from: e.handover.from?.[locale] ?? "", to: e.handover.to?.[locale] ?? "", because: e.handover.because });
    }
    // A pool of one (§3.3 rule 4): its actor is the holder, internal to their own Participant.
    if (e.type === "assigned" && e.by.memberName) return t("assignedOnlyMember", { name: e.by.memberName[locale] });
    if (e.type === "created") return t("created");
    if (e.type === "answers_changed") return t("answersChanged");
    return t("other");
  };
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
  const who = (e: Event) =>
    [e.by.memberName?.[locale], e.by.companyName?.[locale]].filter((part): part is string => Boolean(part)).join(" · ");

  return (
    <section className="space-y-3">
      <h2 className="text-h6 font-semibold">{t("title")}</h2>
      <ol className="divide-y divide-border border-y border-border" data-testid="work-item-history">
        {[...events].reverse().map((e) => (
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
        ))}
      </ol>
    </section>
  );
}
