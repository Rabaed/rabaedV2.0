"use client";

import { formatDate, formatNumber, workItemListHref, type BilingualText, type Locale, type WorkItemDetail } from "@rabaed/domain";
import { cn, DocNo, Icon, type IconName } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { requestedForText, type HistoryText } from "@/lib/inspection";

// A WIR's page parts that read only what the item read and its history give (RP-655, from the
// owner's Inspections (WIR) Screen Board): the line under its Subject, who issued its code, the
// Snags and Comments raised from it, its reply and Cover Note, and on a Revision what the one before
// left. Counts are of the items the viewer sees only (visibility.md, RP-624).

const when = (at: string, locale: Locale) => formatDate(new Date(at), locale, { dateStyle: "medium", timeStyle: "short" });

/** Whoever wrote a text, as the history names them: a person where it may (V14), else the Company. */
const byName = (by: HistoryText["by"], locale: Locale) => [by.memberName?.[locale], by.companyName?.[locale]].filter(Boolean).join(" · ");

/**
 * The line under a WIR's Subject: its Document Number (left to right), Location, Trade and
 * "Requested for", a plain date and time: never "due", "late", a colour or a comparison with today
 * (CLAUDE.md; spec RP-649 story 3).
 */
export function InspectionMeta({ item, locale }: { item: WorkItemDetail; locale: Locale }) {
  const t = useTranslations("workItems.inspection");
  const requested = requestedForText(item.answers.requested_for, locale);
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text">
      {item.documentNumber && (
        <li>
          <DocNo value={item.documentNumber} />
        </li>
      )}
      {item.location && (
        <li className="flex items-center gap-1">
          <Icon name="map-pin" size={16} className="text-muted" />
          <bdi>{item.location.name[locale]}</bdi>
        </li>
      )}
      <li className="flex items-center gap-1">
        <Icon name="ruler" size={16} className="text-muted" />
        <bdi>{item.trade.name[locale]}</bdi>
      </li>
      {requested && (
        <li className="flex items-center gap-1" data-testid="requested-for">
          <Icon name="calendar" size={16} className="text-muted" />
          <span className="text-muted">{t("requestedFor")}</span>
          <strong className="font-semibold tabular-nums">{requested}</strong>
        </li>
      )}
    </ul>
  );
}

/** Beside the code's badge: who issued it, named to everyone who sees it (V14, scenario RP-588-4), and when. */
export function InspectionIssued({ issued, locale }: { issued: HistoryText | null; locale: Locale }) {
  const t = useTranslations("workItems.inspection");
  if (!issued) return null;
  return <span className="text-sm text-muted">{t("issuedBy", { by: byName(issued.by, locale), when: when(issued.at, locale) })}</span>;
}

/** One count card: an icon, the Type's name, "n open / m closed", opening the Snag List filtered to it. */
function CountCard({ icon, title, counts, href }: { icon: IconName; title: string; counts: ReactNode; href: string | null }) {
  const body = (
    <>
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-stage-pending-bg text-stage-pending-fg">
        <Icon name={icon} size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm text-muted">{title}</span>
        <span className="font-semibold">{counts}</span>
      </span>
      {href && <Icon name="chevron-right" size={18} className="shrink-0 text-muted rtl:rotate-180" />}
    </>
  );
  const box = "flex min-h-16 items-center gap-3 rounded-lg border border-border bg-surface p-4";
  return href ? (
    <Link href={href} className={cn(box, "hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus")}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

/** The two Types a WIR raises: its Snags (from failed items) and its Comments (Code B's rows). */
const raisedTypes = [
  { code: "SNG", icon: "flag" },
  { code: "CMT", icon: "message-circle" },
] as const;

/**
 * After the code: "Snags: n open / m closed" and "Comments: n open / m closed", each opening the
 * Snag List filtered to this WIR, counting only the items the viewer sees (RP-624). A Type with
 * nothing raised shows 0 / 0.
 */
export function InspectionCounts({ item, locale }: { item: WorkItemDetail; locale: Locale }) {
  const t = useTranslations("workItems");
  const tInspection = useTranslations("workItems.inspection");
  const counts = (open: number, closed: number) => t("fields.raisedItemCounts", { open: formatNumber(open, locale), closed: formatNumber(closed, locale) });
  return (
    <section aria-label={tInspection("counts.label")} className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {raisedTypes.map(({ code, icon }) => {
          const raised = item.raisedItems.find((r) => r.type.code === code);
          const title = t(`fields.raisedItemTypes.${code}`);
          const href = item.documentNumber ? workItemListHref(item.projectId, { module: "snag_list", type: [code], raisedFrom: [item.documentNumber] }) : null;
          return (
            <div key={code} data-testid={`raised-item-counts-${code}`}>
              <CountCard icon={icon} title={title} counts={counts(raised?.open ?? 0, raised?.closed ?? 0)} href={href} />
            </div>
          );
        })}
      </div>
      <p className="flex items-center gap-1 text-sm text-muted">
        <Icon name="filter" size={14} />
        {tInspection("counts.hint")}
      </p>
    </section>
  );
}

/** A text from the history as a card: its heading, the text, and who wrote it and when. */
export function InspectionTextCard({ icon, title, text: card, locale }: { icon: IconName; title: string; text: HistoryText; locale: Locale }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <h2 className="flex items-center gap-2 text-caption font-semibold tracking-wide text-muted uppercase">
        <Icon name={icon} size={16} />
        {title}
      </h2>
      <p className="whitespace-pre-wrap">
        <bdi>{card.text}</bdi>
      </p>
      <p className="text-sm text-muted">
        {byName(card.by, locale)} · {when(card.at, locale)}
      </p>
    </section>
  );
}

/**
 * A Revision's cards (RP-653, RP-655): the item it revises, with its Revision number, and the
 * Snags raised from it, "n closed / m open", which never block this one's code; the link opens
 * the Snag List filtered to that item, where the viewer again sees only its own.
 */
export function InspectionRevision({ item, previous, locale }: { item: WorkItemDetail; previous: { id: string; documentNumber: string | null; revisionNo: number } | null; locale: Locale }) {
  const t = useTranslations("workItems");
  const tInspection = useTranslations("workItems.inspection");
  const counts = item.previousRaisedItems;
  if (item.revisionNo === 0 || (!previous && !counts)) return null;
  const revision = formatNumber(counts?.revisionNo ?? previous?.revisionNo ?? item.revisionNo - 1, locale);
  return (
    <div className="flex flex-col gap-3">
      {previous && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-4 text-sm">
          <Icon name="history" size={18} className="text-muted" />
          <span className="text-muted">{tInspection("revision.of")}</span>
          <Link href={`/work-items/${previous.id}`} className="font-semibold text-brand-fg underline-offset-4 hover:underline">
            {previous.documentNumber ? <DocNo value={previous.documentNumber} /> : tInspection("revision.number", { revision })}
          </Link>
        </p>
      )}
      {counts?.items
        .filter((f) => f.type.code === "SNG")
        .map((f) => (
          <section key={f.type.code} aria-labelledby="inspection-previous-snags" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <div>
              <h2 id="inspection-previous-snags" className="font-semibold">
                {t("fields.previousRaisedItems", { type: t("fields.raisedItemTypes.SNG"), revision })}
              </h2>
              <p className="font-semibold" data-testid={`previous-raised-item-counts-${f.type.code}`}>
                {t("fields.previousRaisedItemCounts", { closed: formatNumber(f.closed, locale), open: formatNumber(f.open, locale) })}
              </p>
            </div>
            <p className="flex items-start gap-2 rounded-md bg-info-tint p-3 text-sm text-info-fg">
              <Icon name="info-circle" size={16} className="mt-0.5 shrink-0" />
              {tInspection("revision.neverBlocks")}
            </p>
            {counts.documentNumber && (
              <Link
                href={workItemListHref(item.projectId, { module: "snag_list", type: ["SNG"], raisedFrom: [counts.documentNumber] })}
                className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md bg-surface-subtle px-3 text-sm font-semibold hover:bg-hover md:min-h-9"
              >
                <Icon name="filter" size={16} />
                {tInspection("revision.openSnagList")}
              </Link>
            )}
          </section>
        ))}
    </div>
  );
}

/** While another Company holds the WIR's checklist (the Consultant inspecting), its readers learn they read the answers with the code (V19). */
export function InspectionWaiting({ company, locale }: { company: BilingualText; locale: Locale }) {
  const t = useTranslations("workItems.inspection");
  return (
    <p className="flex items-start gap-2 rounded-md bg-info-tint p-3 text-sm text-info-fg">
      <Icon name="eye-off" size={16} className="mt-0.5 shrink-0" />
      {t("waiting", { company: company[locale] })}
    </p>
  );
}
