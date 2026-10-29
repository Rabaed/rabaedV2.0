"use client";

import { formatDate, formatNumber, type BilingualText, type Locale, type WorkItemActions } from "@rabaed/domain";
import { Badge, Button, CodeBadge, cn, Icon } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ReplyChecklistsRead } from "@/components/reply-checklists";
import { phoneBarClass, useTransitionOpener } from "@/components/work-item-actions";
import { InspectionChips, InspectionTiles, tallyOf, useInspection } from "@/components/inspection-context";
import { inspectionActions, itemsShown, type ItemFilter, type SharedChecklist } from "@/lib/inspection";

// A WIR's own page parts (RP-655, from the owner's Inspections (WIR) Screen Board): the Consultant
// Engineer's checklist on a phone with its summary bar and Send to Manager, the Consultant
// Manager's read of it with the Engineer's Recommended Code and the decision bar, and the checklist
// as the code shared it. Every action is one the API offers the viewer; the Engineer's answers
// stay the Consultant's until the code (V19), which only the API decides.

/**
 * The Engineer's summary bar (RP-655): fixed at the bottom of a phone's screen, at the foot of the
 * checklist on a desktop. "18 Pass 2 Fail 1 N/A", how many of all are answered with a progress bar,
 * and Send to Manager, the move the API offers that Recommends a Code, waiting until every item is
 * answered (the API checks it again).
 */
export function InspectionSummaryBar({ workItemId, actions, locale }: { workItemId: string; actions: WorkItemActions; locale: Locale }) {
  const t = useTranslations("workItems.inspection");
  const inspection = useInspection();
  const opener = useTransitionOpener(workItemId, actions, locale);
  const { send } = inspectionActions(actions.transitions);
  if (!inspection || inspection.checklists.length === 0) return null;
  const tally = tallyOf(inspection.checklists.map((c) => ({ items: c.items, answers: inspection.answers[c.fieldKey] ?? {} })));
  const left = tally.total - tally.answered;
  return (
    <section aria-label={t("summary.label")} className={cn("flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 md:sticky md:bottom-4 md:shadow-md", phoneBarClass, "max-md:rounded-none")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="flex flex-wrap items-baseline gap-x-3 text-body">
          <span>
            <strong className="text-success-fg tabular-nums">{formatNumber(tally.passed, locale)}</strong> {t("summary.pass")}
          </span>
          <span>
            <strong className="text-danger-fg tabular-nums">{formatNumber(tally.failed, locale)}</strong> {t("summary.fail")}
          </span>
          <span>
            <strong className="tabular-nums">{formatNumber(tally.na, locale)}</strong> {t("summary.na")}
          </span>
        </p>
        <p className="text-sm text-muted">
          {t.rich("summary.answered", {
            answered: formatNumber(tally.answered, locale),
            total: formatNumber(tally.total, locale),
            strong: (chunks) => <strong className="text-text tabular-nums">{chunks}</strong>,
          })}
        </p>
      </div>
      <div
        role="progressbar"
        aria-label={t("summary.progress")}
        aria-valuemin={0}
        aria-valuemax={tally.total}
        aria-valuenow={tally.answered}
        className="h-1.5 overflow-hidden rounded-full bg-surface-subtle"
      >
        <div className="h-full rounded-full bg-inverse" style={{ width: `${tally.total === 0 ? 0 : (tally.answered / tally.total) * 100}%` }} />
      </div>
      {send && (
        <>
          <Button
            className="min-h-11 w-full"
            disabled={left > 0 || opener.calls.pending || opener.waiting}
            aria-describedby={left > 0 ? "inspection-left" : undefined}
            onClick={() => opener.open(send)}
          >
            <Icon name="send" size={18} />
            {send.label[locale]}
          </Button>
          {left > 0 && (
            <p id="inspection-left" className="sr-only">
              {t("summary.left", { n: formatNumber(left, locale), count: left })}
            </p>
          )}
        </>
      )}
      {(opener.failed || (opener.calls.error && !opener.asking)) && (
        <p role="alert" className="text-sm text-danger-fg">
          {opener.failed ? t("unavailable") : opener.calls.error}
        </p>
      )}
      {opener.dialogs}
    </section>
  );
}

/** The Engineer's Recommended Code, on the Manager's page (RP-433, RP-86): internal to the Consultant (V5). */
export type SentCode = { code: string; by: { companyName: BilingualText | null; memberName: BilingualText | null }; at: string; internalNote: string | null };

function RecommendedCodeCard({ sentCode, holder, raiser, locale }: { sentCode: SentCode; holder: BilingualText | null; raiser: BilingualText; locale: Locale }) {
  const t = useTranslations("workItems.inspection");
  const code = sentCode.code.toLowerCase();
  const name = sentCode.by.memberName?.[locale] ?? sentCode.by.companyName?.[locale] ?? "";
  return (
    <section aria-labelledby="inspection-recommended-code" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="inspection-recommended-code" className="text-caption font-semibold tracking-wide text-muted uppercase">
          {t("sentCode.title")}
        </h2>
        <Badge tone="neutral">
          <Icon name="lock" size={14} />
          {t("internal")}
        </Badge>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <p className="font-semibold">{name}</p>
          <p className="text-sm text-muted">{t("sentCode.sent", { when: formatDate(new Date(sentCode.at), locale, { dateStyle: "medium", timeStyle: "short" }) })}</p>
        </div>
        {(code === "a" || code === "b" || code === "c" || code === "d") && <CodeBadge code={code} locale={locale} size="sm" />}
      </div>
      {sentCode.internalNote && (
        <p className="flex items-start gap-2 rounded-md bg-surface-subtle p-3 text-sm">
          <Icon name="lock" size={16} className="mt-0.5 shrink-0 text-muted" />
          <bdi className="whitespace-pre-wrap">{sentCode.internalNote}</bdi>
        </p>
      )}
      {holder && <p className="text-sm text-muted">{t("sentCode.internalOnly", { company: holder[locale], raiser: raiser[locale] })}</p>}
    </section>
  );
}

/**
 * The Manager's page (RP-655): the checklist the code will take, read-only with each item's answer
 * and photos, filtered by the chips, under the tiles; the Engineer's Recommended Code; and the
 * decision bar with the API's offered Return to Engineer and one "Issue code" that opens the code
 * pop-up over the codes the API offers, the proposed one picked first (ADR 0025).
 */
export function InspectionManager({
  workItemId,
  actions,
  sentCode,
  locale,
}: {
  workItemId: string;
  actions: WorkItemActions;
  sentCode: SentCode | null;
  locale: Locale;
}) {
  const t = useTranslations("workItems.inspection");
  const inspection = useInspection();
  const opener = useTransitionOpener(workItemId, actions, locale);
  const { codes, proposed, others } = inspectionActions(actions.transitions);
  const [filter, setFilter] = useState<ItemFilter>("all");
  if (codes.length === 0) return null;
  // Every code Transition reads the same checklists, as the viewer's own Company answered them.
  const checklists = codes[0]!.checklists ?? [];
  const tally = tallyOf(checklists);
  const proposedCode = codes.find((c) => c.key === proposed) ?? codes[0]!;
  return (
    <div className="flex flex-col gap-4 pb-28 md:pb-0">
      <InspectionTiles tally={tally} locale={locale} />
      {sentCode && inspection && <RecommendedCodeCard sentCode={sentCode} holder={inspection.holder} raiser={inspection.raiser} locale={locale} />}
      {checklists.map((c) => (
        <section key={c.fieldKey} aria-label={c.label[locale]} className="flex flex-col gap-3">
          <InspectionChips items={c.items} answers={c.answers} filter={filter} locale={locale} onFilter={setFilter} />
          <ReplyChecklistsRead workItemId={workItemId} checklists={[c]} locale={locale} shown={new Set(itemsShown(c.items, c.answers, filter))} heading={false} />
        </section>
      ))}
      <section aria-label={t("decision.label")} className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 md:sticky md:bottom-4 md:shadow-md", phoneBarClass)}>
        <div className="flex flex-col">
          <p className="font-semibold">{t("decision.title")}</p>
          {proposed && <p className="text-sm text-muted">{t("decision.proposed", { code: proposedCode.label[locale] })}</p>}
        </div>
        <div className="flex flex-1 flex-wrap justify-end gap-2 max-md:flex-nowrap">
          {others.map((tr) => (
            <Button key={tr.key} variant="secondary" className="min-h-11 max-md:flex-1" disabled={opener.calls.pending || opener.waiting} onClick={() => opener.open(tr)}>
              {tr.kind === "return" && <Icon name="arrow-back-up" size={18} />}
              {tr.label[locale]}
            </Button>
          ))}
          <Button className="min-h-11 max-md:flex-1" disabled={opener.calls.pending || opener.waiting} onClick={() => opener.open(proposedCode, codes)}>
            <Icon name="gavel" size={18} />
            {t("decision.issue")}
          </Button>
        </div>
        {(opener.failed || (opener.calls.error && !opener.asking)) && (
          <p role="alert" className="w-full text-sm text-danger-fg">
            {opener.failed ? t("unavailable") : opener.calls.error}
          </p>
        )}
        {opener.dialogs}
      </section>
    </div>
  );
}

/**
 * The checklist as the code shared it (RP-86; RP-655), for everyone who reads the code: the tiles
 * over it, the chips, and each item's answer, comment, tick and photos, read-only.
 */
export function InspectionShared({ workItemId, checklists, locale }: { workItemId: string; checklists: readonly SharedChecklist[]; locale: Locale }) {
  const t = useTranslations("workItems.inspection");
  const [filter, setFilter] = useState<ItemFilter>("all");
  if (checklists.length === 0) return null;
  return (
    <section aria-labelledby="inspection-shared" className="flex flex-col gap-3">
      <h2 id="inspection-shared" className="text-h6 font-semibold">
        {t("shared.title")}
      </h2>
      <p className="flex items-start gap-2 rounded-md bg-info-tint p-3 text-sm text-info-fg">
        <Icon name="eye" size={16} className="mt-0.5 shrink-0" />
        {t("shared.readable")}
      </p>
      <InspectionTiles tally={tallyOf(checklists)} locale={locale} answeredOf={false} />
      {checklists.map((c) => (
        <div key={c.fieldKey} className="flex flex-col gap-3">
          <InspectionChips items={c.items} answers={c.answers} filter={filter} locale={locale} onFilter={setFilter} />
          <ReplyChecklistsRead
            workItemId={workItemId}
            checklists={[{ fieldKey: c.fieldKey, copyOf: c.fieldKey, label: c.name, name: c.name, items: c.items, required: false, answers: c.answers, canChange: false }]}
            locale={locale}
            shown={new Set(itemsShown(c.items, c.answers, filter))}
            heading={false}
            taken
          />
        </div>
      ))}
    </section>
  );
}
