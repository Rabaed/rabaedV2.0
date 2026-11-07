"use client";

import { formatDate, intlLocaleOf, moduleKeys, riyadhDay, timeZone, type ActivityFeedEntry, type BilingualText, type Locale, type ModuleKey } from "@rabaed/domain";
import { useEffect, useRef, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { moduleIcons, moduleName } from "../../lib/module-name.ts";
import { Avatar } from "../data/avatar.tsx";
import { toneClasses } from "../data/tone.ts";
import { DocNo } from "../doc-no/doc-no.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Select } from "../form/select.tsx";
import { Switch } from "../form/switch.tsx";
import { Icon } from "../icon/icon.tsx";
import { codeLookColour } from "../status/code-badge.tsx";
import { whatHappened, type ActivityEventLabels, type ActivityFeedFilters } from "./activity-feed-panel.tsx";

/** The page's words, from the app's messages. */
export type ActivityFeedPageLabels = ActivityEventLabels & {
  title: string;
  /** The line under the heading, the Project's name in it. */
  description: string;
  allModules: string;
  allTypes: string;
  mine: string;
  /** "11 entries": the entries loaded so far. */
  count: (n: number) => string;
  today: string;
  yesterday: string;
  /** After the viewer's own name: "(you)". */
  you: string;
  onItem: string;
  internal: string;
  /** A Review Code's chip: "Code C". */
  code: (code: string) => string;
  noNumber: string;
  scrollForOlder: string;
  loading: string;
  emptyTitle: string;
  /** No entry matches the filters. */
  emptyFiltered: string;
  /** No filter, and nothing has happened on the items the viewer sees. */
  emptyNone: string;
};

export type ActivityFeedPageProps = {
  /** The entries loaded so far, newest first, as the API sends them. */
  entries: ActivityFeedEntry[];
  /** Whether there are older entries to load. */
  hasMore: boolean;
  /** Whether the next page is on its way. */
  loading?: boolean;
  /** Loads the next page: called on scrolling to the end, or on "Scroll for older entries" by click or key. */
  onLoadMore: () => void;
  query: ActivityFeedFilters;
  onQueryChange: (query: ActivityFeedFilters) => void;
  /** The Project's Work Item Types, for the Module and Type filters. */
  types: { code: string; name: BilingualText; moduleKey: ModuleKey }[];
  locale: Locale;
  labels: ActivityFeedPageLabels;
  /** An item's page. */
  itemHref: (id: string) => string;
  /** When the page was made (ISO), for "Today" and "Yesterday", so the server and the browser agree. */
  now: string;
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
};

/** A Select's value for "no filter": Radix Select takes no empty value. */
const ALL = "all";

const chip = "inline-flex h-[22px] items-center gap-1 rounded-[6px] px-[7px] text-[11.5px] leading-none whitespace-nowrap";

/**
 * The Activity Feed page (RP-1157, the owner's `Rabaed Activity.html`): the Project's Work Item events
 * the viewer may see, newest first, grouped by day. Each entry reads "<who> <did what> <Document Number>
 * · Subject" with its Module · Type, its Code, whether it is internal and whether the viewer is on the
 * item. Another Company appears by its name and a neutral tile only, people only of the viewer's own
 * Company (V14), exactly as the API sends them. Older entries load on scrolling to the end.
 */
export function ActivityFeedPage({
  entries,
  hasMore,
  loading = false,
  onLoadMore,
  query,
  onQueryChange,
  types,
  locale,
  labels,
  itemHref,
  now,
  linkAs: Link = "a",
}: ActivityFeedPageProps) {
  const end = useRef<HTMLDivElement>(null);
  const loadMore = useRef(onLoadMore);
  loadMore.current = onLoadMore;

  // Scrolling to the end of the page loads the next one.
  useEffect(() => {
    const target = end.current;
    if (!target || !hasMore || loading || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((seen) => seen.some((s) => s.isIntersecting) && loadMore.current(), { rootMargin: "200px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loading, entries.length]);

  const modules = moduleKeys.filter((m) => types.some((type) => type.moduleKey === m));
  const typeOptions = types.filter((type) => !query.module || type.moduleKey === query.module);
  const moduleOf = new Map(types.map((type) => [type.code, type.moduleKey]));
  const filtered = query.module !== undefined || query.type.length > 0 || query.mine;
  const days = byDay(entries, locale, labels, new Date(now));

  return (
    <div className="@container mx-auto flex w-full max-w-[980px] flex-col gap-4" data-testid="activity-feed">
      <header>
        <h1 className="text-[24px] font-bold tracking-[-0.01em] text-text">{labels.title}</h1>
        <p className="mt-1 max-w-[640px] text-[13.5px] leading-[1.45] text-muted">{labels.description}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2 @[721px]:gap-2.5">
        <Select
          aria-label={labels.allModules}
          className="h-9 w-auto min-w-[8.5rem] flex-[1_1_140px] font-semibold @[721px]:flex-none"
          value={query.module ?? ALL}
          options={[{ value: ALL, label: labels.allModules }, ...modules.map((m) => ({ value: m, label: moduleName(m, locale) }))]}
          onValueChange={(v) => {
            const module = v === ALL ? undefined : (v as ModuleKey);
            // A Type of another Module no longer applies.
            const type = query.type.filter((code) => types.some((x) => x.code === code && (!module || x.moduleKey === module)));
            onQueryChange({ ...query, module, type });
          }}
        />
        <Select
          aria-label={labels.allTypes}
          className="h-9 w-auto min-w-[12.5rem] flex-[1_1_140px] font-semibold @[721px]:flex-none"
          value={query.type[0] ?? ALL}
          options={[
            { value: ALL, label: labels.allTypes },
            // "Material Submittal (MAR)": the code left-to-right in either language.
            ...typeOptions.map((x) => ({ value: x.code, label: `${x.name[locale]} (\u2066${x.code}\u2069)` })),
          ]}
          onValueChange={(v) => onQueryChange({ ...query, type: v === ALL ? [] : [v] })}
        />
        <label className="flex basis-full cursor-pointer items-center gap-2 text-[13px] font-semibold text-text @[721px]:basis-auto">
          <Switch checked={query.mine} onCheckedChange={(mine) => onQueryChange({ ...query, mine })} />
          {labels.mine}
        </label>
        <span className="hidden flex-1 @[721px]:block" />
        <span className="w-full text-[12.5px] text-muted @[721px]:w-auto" aria-live="polite">
          {labels.count(entries.length)}
        </span>
      </div>

      {entries.length === 0 && !hasMore ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <span className="flex size-11 items-center justify-center rounded-[12px] border border-border bg-surface-subtle text-muted">
            <Icon name="clock" size={22} />
          </span>
          <p className="text-[14px] font-bold text-text">{labels.emptyTitle}</p>
          <p className="text-[13px] text-muted">{filtered ? labels.emptyFiltered : labels.emptyNone}</p>
        </div>
      ) : (
        <div className="overflow-clip rounded-lg border border-border bg-surface">
          {days.map((day) => (
            <section key={day.key} aria-label={day.name}>
              <h2 className="sticky top-0 z-[2] flex items-center gap-2 border-b border-border-subtle bg-surface-subtle px-4 py-2.5 text-[12.5px] font-bold text-text">
                {day.title}
                {day.date && <small className="text-[11px] font-medium text-muted">· {day.date}</small>}
              </h2>
              <ol>
                {day.entries.map((e, i) => (
                  <li key={e.id} className={cn(i > 0 && "border-t border-border-subtle")}>
                    <Entry e={e} locale={locale} labels={labels} moduleKey={moduleOf.get(e.workItem.type.code)} href={itemHref(e.workItem.id)} Link={Link} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {hasMore &&
            (loading ? (
              <div role="status" className="flex items-center justify-center gap-2 border-t border-border p-[18px] text-[13px] text-muted">
                <span className="size-4 animate-spin rounded-full border-2 border-control-border border-t-primary" aria-hidden />
                {labels.loading}
              </div>
            ) : (
              // Scrolling to it loads the next page; a click or a key does too, for keyboard users.
              <button
                type="button"
                onClick={onLoadMore}
                className={cn("flex w-full items-center justify-center border-t border-border p-[18px] text-[13px] text-muted hover:bg-hover", focusRing)}
              >
                {labels.scrollForOlder}
              </button>
            ))}
        </div>
      )}
      <div ref={end} aria-hidden />
    </div>
  );
}

function Entry({
  e,
  locale,
  labels,
  moduleKey,
  href,
  Link,
}: {
  e: ActivityFeedEntry;
  locale: Locale;
  labels: ActivityFeedPageLabels;
  moduleKey: ModuleKey | undefined;
  href: string;
  Link: ElementType;
}) {
  const person = e.by.memberName;
  // Another Company, or the viewer's own with no person named: the Company by its name alone (V14).
  const who = person?.[locale] ?? e.by.companyName?.[locale] ?? "";
  const time = formatDate(new Date(e.at), locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return (
    <Link
      href={href}
      className={cn(
        "grid grid-cols-[32px_minmax(0,1fr)] items-start gap-2.5 p-3 hover:bg-hover @[721px]:grid-cols-[48px_32px_minmax(0,1fr)_auto] @[721px]:gap-3 @[721px]:px-4",
        focusRing,
      )}
    >
      <time dateTime={e.at} dir="ltr" className="col-start-2 row-start-2 text-[12px] text-muted tabular-nums @[721px]:col-start-1 @[721px]:row-start-1 @[721px]:pt-[7px]">
        {time}
      </time>
      {person ? (
        <Avatar name={person[locale]} initialsFrom={person.en} solid decorative className="row-start-1" />
      ) : (
        <span aria-hidden className="row-start-1 flex size-8 items-center justify-center rounded-[9px] bg-neutral-tint text-neutral-fg">
          <Icon name="building" size={16} />
        </span>
      )}
      <div className="row-start-1 flex min-w-0 flex-col gap-[5px]">
        <p className="text-[13.5px] leading-[1.45] break-words text-text-secondary">
          <b className="font-bold text-text">{who}</b>
          {/* Isolated, so a label ending in a Latin Code ("… · C") keeps its place in Arabic. */}
          {e.byMe && person && <b className="font-bold text-text"> {labels.you}</b>} <bdi>{whatHappened(e, locale, labels)}</bdi>{" "}
          {e.workItem.documentNumber ? (
            <DocNo value={e.workItem.documentNumber} className="font-bold text-text" />
          ) : (
            <span className="text-muted">({labels.noNumber})</span>
          )}
          <span> · {e.workItem.title}</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn(chip, "border border-border bg-surface-subtle font-semibold text-text-secondary")}>
            {moduleKey && <Icon name={moduleIcons[moduleKey]} size={12} />}
            {moduleKey && <span>{moduleName(moduleKey, locale)} ·</span>}
            <bdi dir="ltr" translate="no" className="font-bold">
              {e.workItem.type.code}
            </bdi>
          </span>
          {e.outcome !== null && e.outcomeChip && (
            <span className={cn(chip, "font-bold", codeLookColour[e.outcomeChip.look])}>{e.outcomeChip.name?.[locale] ?? labels.code(e.outcome)}</span>
          )}
          {e.audience === "internal" && (
            <span className={cn(chip, "font-semibold", toneClasses.warning)}>
              <Icon name="lock" size={12} />
              {labels.internal}
            </span>
          )}
          {e.onItem && (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-muted">
              {/* eslint-disable-next-line rabaed/no-avoid-terms -- Tabler's icon name, not copy */}
              <Icon name="user" size={12} />
              {labels.onItem}
            </span>
          )}
        </div>
      </div>
      <Icon name="chevron-right" size={16} className="hidden pt-[7px] text-faint @[721px]:block" />
    </Link>
  );
}

type Day = { key: string; title: string; date: string | null; name: string; entries: ActivityFeedEntry[] };

/** A day as the reference writes it: "31 Oct", or "Wed 28 Oct" with its weekday. Arabic keeps its own order. */
function dayName(at: Date, locale: Locale, weekday: boolean): string {
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: locale === "ar" ? "long" : "short", ...(weekday ? { weekday: locale === "ar" ? "long" : "short" } : {}) };
  if (locale === "ar") return formatDate(at, locale, options);
  const parts = new Intl.DateTimeFormat(intlLocaleOf(locale), { timeZone, ...options }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return [weekday ? part("weekday") : "", part("day"), part("month")].filter(Boolean).join(" ");
}

/** The entries by Saudi calendar day, newest first: "Today · 31 Oct", "Yesterday · 30 Oct", then "Wed 28 Oct". */
function byDay(entries: ActivityFeedEntry[], locale: Locale, labels: ActivityFeedPageLabels, now: Date): Day[] {
  const today = riyadhDay(now);
  const yesterday = riyadhDay(new Date(now.getTime() - 86_400_000));
  const days: Day[] = [];
  for (const e of entries) {
    const at = new Date(e.at);
    const key = riyadhDay(at);
    let day = days.at(-1);
    if (day?.key !== key) {
      const date = dayName(at, locale, false);
      const title = key === today ? labels.today : key === yesterday ? labels.yesterday : dayName(at, locale, true);
      const relative = key === today || key === yesterday;
      day = { key, title, date: relative ? date : null, name: relative ? `${title} ${date}` : title, entries: [] };
      days.push(day);
    }
    day.entries.push(e);
  }
  return days;
}
