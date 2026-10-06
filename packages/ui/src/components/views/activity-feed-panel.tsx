"use client";

import { formatDate, moduleKeys, type ActivityFeedEntry, type ActivityFeedQuery, type BilingualText, type Locale, type ModuleKey } from "@rabaed/domain";
import { useEffect, useRef, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Field } from "../form/field.tsx";
import { Select } from "../form/select.tsx";
import { Switch } from "../form/switch.tsx";
import { moduleName } from "./project-dashboard.tsx";

const copy = {
  title: { en: "Activity", ar: "النشاط" },
  module: { en: "Module", ar: "الوحدة" },
  type: { en: "Type", ar: "النوع" },
  all: { en: "All", ar: "الكل" },
  mine: { en: "Only items I'm on", ar: "العناصر التي أشارك فيها فقط" },
  viewAll: { en: "View all", ar: "عرض الكل" },
  loadMore: { en: "Load more", ar: "تحميل المزيد" },
  loading: { en: "Loading…", ar: "جارٍ التحميل…" },
  empty: { en: "Nothing has happened on the items you can see yet.", ar: "لم يحدث شيء بعد على العناصر التي يمكنك رؤيتها." },
  internal: { en: "Only your Company sees this", ar: "لا يراه إلا شركتك" },
  noNumber: { en: "No number yet", ar: "بلا رقم بعد" },
  // What happened, for events that aren't a Transition.
  claimed: { en: "claimed", ar: "استلم" },
  released: { en: "released to the pool", ar: "أعاد إلى المجموعة" },
  assigned: { en: "assigned", ar: "أسند" },
  internalNote: { en: "wrote an Internal Note with", ar: "كتب ملاحظة داخلية مع" },
  recommended: { en: "recommended a Code on", ar: "أوصى برمز على" },
  cancelled: { en: "cancelled", ar: "ألغى" },
  updated: { en: "updated", ar: "حدّث" },
} satisfies Record<string, Record<Locale, string>>;

/** A Select's value for "no filter": Radix Select takes no empty value. */
const ALL = "all";

/** The feed's filters, as the API takes them. */
export type ActivityFeedFilters = Pick<ActivityFeedQuery, "type" | "mine"> & { module?: ModuleKey | undefined };

export type ActivityFeedPanelProps = {
  /** The entries loaded so far, newest first, as the API sends them. */
  entries: ActivityFeedEntry[];
  /** Whether there are older entries to load. */
  hasMore: boolean;
  /** Whether the next page is on its way. */
  loading?: boolean;
  /** Loads the next page: called on scrolling to the end, or "Load more". */
  onLoadMore: () => void;
  query: ActivityFeedFilters;
  /** Shows the feed for new filters. */
  onQueryChange: (query: ActivityFeedFilters) => void;
  /** The Project's Work Item Types, for the Module and Type filters. */
  types: { code: string; name: BilingualText; moduleKey: ModuleKey }[];
  locale: Locale;
  /** An item's page. */
  itemHref: (id: string) => string;
  /** Where "View all" opens the feed full height; left out on that page itself. */
  viewAllHref?: string | undefined;
  /** The feed at full height ("View all"), rather than a panel that scrolls on its own. */
  fullHeight?: boolean;
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
};

/**
 * The Activity Feed (spec RP-344, design §5): the Project's Work Item events
 * the viewer may see, newest first, each "<Company> <did what> <Document
 * Number> · Subject" and a link to its item. Another Company appears by its
 * name only, people only of the viewer's own Company (V14), exactly as the API
 * sends them. More entries load on scrolling to the end; "View all" opens the
 * feed full height.
 */
export function ActivityFeedPanel({
  entries,
  hasMore,
  loading = false,
  onLoadMore,
  query,
  onQueryChange,
  types,
  locale,
  itemHref,
  viewAllHref,
  fullHeight = false,
  linkAs: Link = "a",
}: ActivityFeedPanelProps) {
  const t = (key: keyof typeof copy) => copy[key][locale];
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const loadMore = useRef(onLoadMore);
  loadMore.current = onLoadMore;

  // Scrolling to the end loads the next page: within the panel, or the page when full height.
  useEffect(() => {
    const target = end.current;
    if (!target || !hasMore || loading || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((seen) => seen.some((s) => s.isIntersecting) && loadMore.current(), {
      root: fullHeight ? null : scroller.current,
      rootMargin: "120px",
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loading, fullHeight, entries.length]);

  const modules = moduleKeys.filter((m) => types.some((type) => type.moduleKey === m));
  const typeOptions = types.filter((type) => !query.module || type.moduleKey === query.module);

  return (
    <section aria-labelledby="activity-feed-title" className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="activity-feed-title" className="text-h6 font-semibold">
          {t("title")}
        </h2>
        {viewAllHref && !fullHeight && (
          <Link href={viewAllHref} className={cn("rounded-sm text-sm text-primary underline underline-offset-4", focusRing)}>
            {t("viewAll")}
          </Link>
        )}
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("module")}>
          <Select
            value={query.module ?? ALL}
            options={[{ value: ALL, label: t("all") }, ...modules.map((m) => ({ value: m, label: moduleName(m, locale) }))]}
            onValueChange={(v) => {
              const module = v === ALL ? undefined : (v as ModuleKey);
              // A Type of another Module no longer applies.
              const type = query.type.filter((code) => types.some((x) => x.code === code && (!module || x.moduleKey === module)));
              onQueryChange({ ...query, module, type });
            }}
          />
        </Field>
        <Field label={t("type")}>
          <Select
            value={query.type[0] ?? ALL}
            options={[{ value: ALL, label: t("all") }, ...typeOptions.map((x) => ({ value: x.code, label: x.name[locale] }))]}
            onValueChange={(v) => onQueryChange({ ...query, type: v === ALL ? [] : [v] })}
          />
        </Field>
      </div>
      <Field label={t("mine")} layout="inline">
        <Switch checked={query.mine} onCheckedChange={(mine) => onQueryChange({ ...query, mine })} />
      </Field>

      <div ref={scroller} className={cn("min-w-0", !fullHeight && "max-h-[32rem] overflow-y-auto")} data-testid="activity-feed">
        {entries.length === 0 && !hasMore ? (
          <p className="py-4 text-muted">{t("empty")}</p>
        ) : (
          <ol className="divide-y divide-border">
            {entries.map((e) => (
              <li key={e.id}>
                <Link href={itemHref(e.workItem.id)} className={cn("block space-y-1 rounded-sm px-1 py-3 hover:bg-hover", focusRing)}>
                  <p className="break-words">
                    <span className="font-semibold">{e.by.companyName?.[locale]}</span>
                    {e.by.memberName && <span className="text-muted"> · {e.by.memberName[locale]}</span>} {whatHappened(e, locale)}{" "}
                    {e.workItem.documentNumber ? <DocNo value={e.workItem.documentNumber} /> : <span className="text-muted">({t("noNumber")})</span>}
                    <span> · {e.workItem.title}</span>
                  </p>
                  <p className="text-sm text-muted">
                    <time dateTime={e.at}>{formatDate(new Date(e.at), locale, { dateStyle: "medium", timeStyle: "short" })}</time>
                    {e.audience === "internal" && <span> · {t("internal")}</span>}
                  </p>
                </Link>
              </li>
            ))}
          </ol>
        )}
        <div ref={end} aria-hidden />
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="ghost" size="sm" onClick={onLoadMore} disabled={loading}>
              {loading ? t("loading") : t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

/** "<did what>": the Transition taken, or what kind of event it was. */
function whatHappened(e: ActivityFeedEntry, locale: Locale): string {
  const label = e.transition?.[locale];
  switch (e.type) {
    case "transition":
    case "issue_code":
      return label ?? copy.updated[locale];
    case "internal_note":
      return label ? `${copy.internalNote[locale]} ${label}` : copy.internalNote[locale];
    case "claimed":
      return copy.claimed[locale];
    case "released":
      return copy.released[locale];
    case "assigned":
    case "admin_reassigned":
      return copy.assigned[locale];
    case "recommend_code":
      return copy.recommended[locale];
    case "cancelled":
      return copy.cancelled[locale];
    default:
      return copy.updated[locale];
  }
}
