import type { Locale, WorkItemHistory as History } from "@rabaed/domain";
import { DocNo } from "@rabaed/ui";
import { getFormatter, getTranslations } from "next-intl/server";

type Event = History["events"][number];

/**
 * A Work Item's history as the viewer may see it. The API already leaves out
 * other Companies' internal events (V5); internal ones shown here are marked as
 * seen only by the viewer's own Company.
 */
export async function WorkItemHistory({ events, locale }: { events: Event[]; locale: Locale }) {
  const t = await getTranslations("workItems.history");
  const format = await getFormatter();

  const what = (e: Event) => {
    if ((e.type === "transition" || e.type === "issue_code") && e.transition) return e.transition[locale];
    if (e.type === "internal_note") {
      return e.transition ? t("internalNoteWith", { transition: e.transition[locale] }) : t("internalNote");
    }
    if (e.type === "created" || e.type === "claimed" || e.type === "released") return t(e.type);
    return t("other");
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
            {e.reason && <p className="whitespace-pre-wrap">{e.reason}</p>}
            {e.internalNote && <p className="whitespace-pre-wrap">{e.internalNote}</p>}
            {e.audience === "internal" && <p className="text-xs text-muted">{t("internal")}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
