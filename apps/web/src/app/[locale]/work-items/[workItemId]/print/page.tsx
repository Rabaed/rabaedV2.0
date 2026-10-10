import { answerFields, formatDayMonthYear, formatNumber, type Locale, type WorkItemDetail } from "@rabaed/domain";
import { DocNo, StagePill, stageColour } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PrintNow } from "@/components/print-now";
import { WorkItemAttachments } from "@/components/work-item-attachments";
import { WorkItemAnswers, WorkItemFormProvider } from "@/components/work-item-form";
import { WorkItemLinks } from "@/components/work-item-links";
import { redirect } from "@/i18n/navigation";
import { readingChoices } from "@/lib/built-in-choices";
import { codeAfterLabel } from "@/lib/history-code";
import { linkTargetNames } from "@/lib/link-search";
import { getMe, getOptionLists, getSharedWorkItem, getWorkItemForm } from "@/lib/session";

/**
 * Download (RP-409, owner decision B): the item's final output, laid out to print, which the
 * browser saves as a PDF. Everything on it comes from one read, `GET /work-items/:id/shared`: its
 * content as it last arrived, with its outcome, the same for every viewer who sees it, the holder's
 * and the raiser's own Companies included. Its Status as other Companies read it, its Documents and
 * Links as of the last arrival (never one added since), no Linked from, no internal Step, no
 * Internal Note, no person and no in-progress answers, for anyone (visibility.md scenario RP-409-2).
 * Nothing before the first Submit. Read only: nothing on it can be changed.
 */
export default async function WorkItemPrintPage({ params }: { params: Promise<{ locale: Locale; workItemId: string }> }) {
  const { locale, workItemId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("workItems");
  const tViews = await getTranslations("workItemViews");
  const [me, item, form, optionLists] = await Promise.all([getMe(), getSharedWorkItem(workItemId), getWorkItemForm(workItemId), getOptionLists()]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!item || !form) notFound();
  const date = (iso: string) => formatDayMonthYear(new Date(iso), locale, { month: "short" });
  // Read only: nothing is uploaded here, so no limits apply.
  const readOnly = { documents: item.documents, canChange: false, limits: { maxBytes: 1, contentTypes: [] } };
  const links = { links: item.links.map((l) => ({ ...l, workItemId: null })), canChange: false };
  // The Built-in Fields name the item's own values, as on any item read only.
  const choices = readingChoices({ trade: item.trade, location: item.location, scopes: item.scopes } as WorkItemDetail, locale);

  return (
    <WorkItemFormProvider
      workItemId={item.id}
      projectId={item.projectId}
      linkTargets={linkTargetNames(links.links)}
      schema={form.schema}
      choices={choices}
      // No person is named on the shared item.
      people={{ members: [], participants: [] }}
      optionLists={optionLists}
      answers={item.answers}
      named={item.namedAnswers}
      editable={false}
      editableSections={[]}
      filledBy={form.filledBy}
      fieldTimes={{}}
      autosave={false}
    >
      {/* When printed, only this sheet: the app's frame around it is left out, and the page is the sheet's white to the bottom of every page. */}
      <style>{"@media print { html, body { background: var(--color-surface) !important; } body * { visibility: hidden; } [data-print-sheet], [data-print-sheet] * { visibility: visible; } [data-print-sheet] { position: absolute; inset: 0; padding: 0; } [data-print-hide] { display: none; } }"}</style>
      <article data-print-sheet="" className="mx-auto max-w-3xl space-y-6 bg-surface p-6">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div className="space-y-1">
            <p className="text-sm text-muted">
              {item.documentNumber ? (
                <DocNo value={item.documentNumber} />
              ) : item.revisionNo > 0 ? (
                tViews("list.revisionNoNumber", { revision: formatNumber(item.revisionNo, locale) })
              ) : (
                t("noNumber")
              )}
            </p>
            <h1 className="text-h4 font-semibold">
              <bdi>{item.title}</bdi>
            </h1>
          </div>
          <PrintNow label={tViews("list.rowMenu.download")} />
        </header>

        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted">{t("fields.type")}</dt>
          <dd>
            {item.type.name[locale]}{" "}
            <bdi dir="ltr" className="text-muted">
              {item.type.code}
            </bdi>
          </dd>
          <dt className="text-muted">{tViews("list.columns.stage")}</dt>
          <dd>
            <StagePill stage={stageColour(item.stage)} label={item.stage.name[locale]} />
          </dd>
          {item.outcome && (
            <>
              <dt className="text-muted">{t("fields.issuedCode")}</dt>
              <dd>
                <bdi dir="ltr" className="font-semibold" data-testid="issued-code">
                  {item.outcome}
                </bdi>
                {item.outcomeName && <span className="ms-2 text-muted">{item.outcomeName[locale]}</span>}
              </dd>
            </>
          )}
          <dt className="text-muted">{t("fields.raisedBy")}</dt>
          <dd>{item.raisedBy.companyName[locale]}</dd>
          <dt className="text-muted">{tViews("list.submissionDate")}</dt>
          <dd>{date(item.submissionDate)}</dd>
        </dl>

        <WorkItemAnswers locale={locale} workItemId={item.id} documents={readOnly} />
        <WorkItemAttachments workItemId={item.id} list={readOnly} locale={locale} />
        <WorkItemLinks
          workItemId={item.id}
          projectId={item.projectId}
          list={links}
          locale={locale}
          questionLabels={Object.fromEntries(answerFields(form.schema).map((f) => [f.key, f.label[locale]]))}
        />

        {/* The shared moves only, each by its Company: no Step, no person, no Internal Note. */}
        <section className="space-y-3">
          <h2 className="text-h6 font-semibold">{t("history.title")}</h2>
          <ol className="divide-y divide-border border-y border-border">
            {item.history.map((e, i) => {
              const label = e.transition?.[locale] ?? null;
              // One Code: a Code Transition's label already names it ("Approve · A").
              const code = codeAfterLabel(label, e.outcome);
              return (
              <li key={i} className="flex flex-col gap-0.5 py-2 text-sm">
                <span className="font-semibold">
                  {label ?? t("history.other")}
                  {code && (
                    <bdi dir="ltr" className="ms-2">
                      {code}
                    </bdi>
                  )}
                </span>
                <span className="text-muted">{[e.companyName?.[locale], date(e.at)].filter(Boolean).join(" · ")}</span>
                {e.remarks && <p className="whitespace-pre-wrap">{e.remarks}</p>}
              </li>
              );
            })}
          </ol>
        </section>
      </article>
    </WorkItemFormProvider>
  );
}
