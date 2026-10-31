"use client";

import type { BilingualText, ChecklistTemplateChoice, Locale, WorkItemActions } from "@rabaed/domain";
import { Button, ChecklistTemplatePreview, cn, Icon } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useId, type ReactNode } from "react";
import { checklistTemplateLabels } from "@/lib/form-labels";
import { pickedTemplate } from "@/lib/inspection";
import { OpenerAlert, useTransitionOpener } from "./work-item-actions";
import { useWorkItemForm } from "./work-item-form";

type Offered = WorkItemActions["transitions"][number];

// The WIR request's own frame (RP-655, the owner's Inspections (WIR) Screen Board, "WIR request"):
// on a wide screen the Form on the left and, beside it, the picked template's preview and what
// happens next; on a phone one column, the preview under the template cards and what happens
// next at the end. A sticky bar holds Save draft and the move that sends it on. Only the WIR
// request is laid out so: every other Form renders as before.

/** The two columns on a wide screen, one on a phone: `children` the Form's column, `side` beside it. Off, the children as they are. */
export function WirRequestColumns({ on = true, side, children }: { on?: boolean; side: ReactNode; children: ReactNode }) {
  if (!on) return children;
  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
      {/* Beside the Form on a wide screen only; a phone has the preview under the cards and the steps at the end. */}
      <aside className="hidden flex-col gap-4 lg:sticky lg:top-4 lg:flex">{side}</aside>
    </div>
  );
}

/** The picked template's items, beside the Form: the same preview the cards show on a phone. */
export function WirTemplatePreview({ picked, locale }: { picked: ChecklistTemplateChoice | null; locale: Locale }) {
  const t = useTranslations("workItems.inspection.request");
  const tForm = useTranslations("workItems.form");
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h2 id={headingId} className="font-display text-h6 font-semibold">
        {t("previewTitle")}
      </h2>
      {picked?.name ? (
        <ChecklistTemplatePreview choice={picked} locale={locale} labels={checklistTemplateLabels(tForm)} />
      ) : (
        <p className="text-sm text-muted">{t("previewEmpty")}</p>
      )}
    </section>
  );
}

/** What happens once it is sent: the Contractor's review, the inspection on site, the code. `reviewer`: the one Member it goes to, when the API names one. */
export function WirNextSteps({ reviewer, locale, className }: { reviewer: BilingualText | null; locale: Locale; className?: string }) {
  const t = useTranslations("workItems.inspection.request");
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn("flex flex-col gap-2 rounded-lg border border-border bg-surface p-4", className)}>
      <h2 id={headingId} className="text-xs font-semibold tracking-wide text-muted uppercase">
        {t("nextTitle")}
      </h2>
      <ol className="flex list-decimal flex-col gap-1.5 ps-5 text-sm">
        <li>{reviewer ? t("nextReviewBy", { name: reviewer[locale] }) : t("nextReview")}</li>
        <li>{t("nextInspect")}</li>
        <li>{t("nextCode")}</li>
      </ol>
    </section>
  );
}

/**
 * The request's sticky bar: who raised it and where it goes next (or that its number comes on
 * submit), then Save draft and the move that sends it on. The page puts it last in its column, so
 * it stays at the bottom of the screen all the way down.
 */
export function WirRequestBar({ company, goesTo, locale, children }: { company: BilingualText; goesTo: BilingualText | null; locale: Locale; children: ReactNode }) {
  const t = useTranslations("workItems.inspection.request");
  return (
    <div
      role="group"
      aria-label={t("actions")}
      className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 shadow-lg max-md:-mx-1"
    >
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{t("raisedBy", { company: company[locale] })}</p>
        <p className="text-muted">{goesTo ? t("goesTo", { name: goesTo[locale] }) : t("numberOnSubmit")}</p>
      </div>
      <div className="flex flex-1 flex-wrap justify-end gap-2 max-md:basis-full [&>button]:max-md:flex-1">{children}</div>
    </div>
  );
}

/** A Draft WIR's side column: the preview of the template as now picked, then what happens next. */
export function WirDraftSide({ reviewer, locale }: { reviewer: BilingualText | null; locale: Locale }) {
  const form = useWorkItemForm();
  return (
    <>
      <WirTemplatePreview picked={form ? pickedTemplate(form.schema, form.answers, form.checklistTemplates) : null} locale={locale} />
      <WirNextSteps reviewer={reviewer} locale={locale} />
    </>
  );
}

/**
 * A Draft WIR's bar: Save draft (it saves what was typed and stays), and the move that sends it on,
 * exactly as the API offers it, through the same pop-up and Signature and Stamp checks as any action.
 */
export function WirDraftBar({
  workItemId,
  actions,
  send,
  goesTo,
  company,
  locale,
}: {
  workItemId: string;
  actions: WorkItemActions;
  send: Offered | null;
  goesTo: BilingualText | null;
  company: BilingualText;
  locale: Locale;
}) {
  const t = useTranslations("workItems");
  const form = useWorkItemForm();
  const opener = useTransitionOpener(workItemId, actions, locale);
  return (
    <WirRequestBar company={company} goesTo={goesTo} locale={locale}>
      {form?.editable && (
        <Button variant="secondary" disabled={form.pending || !form.dirty} onClick={() => void form.save(false)}>
          {t("saveDraft")}
        </Button>
      )}
      {send && (
        <Button disabled={opener.calls.pending || opener.waiting} aria-busy={opener.waiting || undefined} onClick={() => opener.open(send)}>
          <Icon name="send" size={16} />
          {send.label[locale]}
        </Button>
      )}
      <OpenerAlert opener={opener} className="basis-full text-end" />
      {opener.dialogs}
    </WirRequestBar>
  );
}
