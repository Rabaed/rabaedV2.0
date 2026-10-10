import { answerFields, formatDayMonthYear, formatNumber, type Locale, type WorkItemDetail } from "@rabaed/domain";
import { DocNo, StagePill, stageColour } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PrintNow } from "@/components/print-now";
import { WorkItemAttachments } from "@/components/work-item-attachments";
import { WorkItemAnswers, WorkItemFormProvider } from "@/components/work-item-form";
import { WorkItemLinkedFrom } from "@/components/work-item-linked-from";
import { WorkItemLinks } from "@/components/work-item-links";
import { redirect } from "@/i18n/navigation";
import { readingChoices } from "@/lib/built-in-choices";
import { linkTargetNames } from "@/lib/link-search";
import { getLinkedFrom, getMe, getOptionLists, getSharedWorkItem, getWorkItemDocuments, getWorkItemForm, getWorkItemLinks } from "@/lib/session";

/**
 * Download (RP-409, owner decision 2026-10-10): the item's final output, laid out to print, which the
 * browser saves as a PDF. Its content as it was shared, with its outcome (`GET /work-items/:id/shared`):
 * the same for every viewer who sees it, the raiser's own Company included. No internal Step, no
 * Internal Note, no person and no in-progress answers, for anyone (visibility.md scenario RP-409-2).
 * Nothing before the first Submit. Read only: nothing on it can be changed.
 */
export default async function WorkItemPrintPage({ params }: { params: Promise<{ locale: Locale; workItemId: string }> }) {
  const { locale, workItemId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("workItems");
  const tViews = await getTranslations("workItemViews");
  const [me, item, form, documents, links, linkedFrom, optionLists] = await Promise.all([
    getMe(),
    getSharedWorkItem(workItemId),
    getWorkItemForm(workItemId),
    getWorkItemDocuments(workItemId),
    getWorkItemLinks(workItemId),
    getLinkedFrom(workItemId),
    getOptionLists(),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!item || !form || !documents || !links || !linkedFrom) notFound();
  const date = (iso: string) => formatDayMonthYear(new Date(iso), locale, { month: "short" });
  const readOnly = { ...documents, canChange: false };
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
      {/* When printed, only this sheet: the app's frame around it is left out. */}
      <style>{"@media print { body * { visibility: hidden; } [data-print-sheet], [data-print-sheet] * { visibility: visible; } [data-print-sheet] { position: absolute; inset: 0; padding: 0; } [data-print-hide] { display: none; } }"}</style>
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
          list={{ ...links, canChange: false }}
          locale={locale}
          questionLabels={Object.fromEntries(answerFields(form.schema).map((f) => [f.key, f.label[locale]]))}
        >
          <WorkItemLinkedFrom items={linkedFrom.items} />
        </WorkItemLinks>

        {/* The shared moves only, each by its Company: no Step, no person, no Internal Note. */}
        <section className="space-y-3">
          <h2 className="text-h6 font-semibold">{t("history.title")}</h2>
          <ol className="divide-y divide-border border-y border-border">
            {item.history.map((e, i) => (
              <li key={i} className="flex flex-col gap-0.5 py-2 text-sm">
                <span className="font-semibold">
                  {e.transition?.[locale] ?? t("history.other")}
                  {e.outcome && (
                    <bdi dir="ltr" className="ms-2">
                      {e.outcome}
                    </bdi>
                  )}
                </span>
                <span className="text-muted">{[e.companyName?.[locale], date(e.at)].filter(Boolean).join(" · ")}</span>
                {e.remarks && <p className="whitespace-pre-wrap">{e.remarks}</p>}
              </li>
            ))}
          </ol>
        </section>
      </article>
    </WorkItemFormProvider>
  );
}
