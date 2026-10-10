import { answerFields, formatDate, formatNumber, type Locale } from "@rabaed/domain";
import { DocNo, StagePill, stageColour } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PrintNow } from "@/components/print-now";
import { WorkItemAttachments } from "@/components/work-item-attachments";
import { WorkItemAnswers, WorkItemFormProvider } from "@/components/work-item-form";
import { WorkItemHistory } from "@/components/work-item-history";
import { WorkItemLinkedFrom } from "@/components/work-item-linked-from";
import { WorkItemLinks } from "@/components/work-item-links";
import { redirect } from "@/i18n/navigation";
import { readingChoices } from "@/lib/built-in-choices";
import { linkTargetNames } from "@/lib/link-search";
import {
  getLinkedFrom,
  getMe,
  getOptionLists,
  getWorkItem,
  getWorkItemDocuments,
  getWorkItemForm,
  getWorkItemFormChoices,
  getWorkItemHistory,
  getWorkItemLinks,
} from "@/lib/session";

/**
 * Download (RP-409, the List's row menu): one Work Item as the viewer reads it, laid out to print,
 * which the browser saves as a PDF. Built from the same reads as the item page (its answers, Documents,
 * Links and history through the same API calls), so it holds nothing the item page wouldn't show
 * this viewer: another Company's Internal Notes, in-progress answers and people stay out (V5, V14,
 * V19; visibility.md scenario RP-409-2). Read only: nothing on it can be changed.
 */
export default async function WorkItemPrintPage({ params }: { params: Promise<{ locale: Locale; workItemId: string }> }) {
  const { locale, workItemId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("workItems");
  const tViews = await getTranslations("workItemViews");
  const [me, item, form, people, documents, links, linkedFrom, history, optionLists] = await Promise.all([
    getMe(),
    getWorkItem(workItemId),
    getWorkItemForm(workItemId),
    getWorkItemFormChoices(workItemId),
    getWorkItemDocuments(workItemId),
    getWorkItemLinks(workItemId),
    getLinkedFrom(workItemId),
    getWorkItemHistory(workItemId),
    getOptionLists(),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!item || !form || !people || !documents || !links || !linkedFrom) notFound();
  const date = (iso: string | null) => (iso === null ? null : formatDate(new Date(iso), locale));
  const readOnly = { ...documents, canChange: false };

  return (
    <WorkItemFormProvider
      workItemId={item.id}
      projectId={item.projectId}
      linkTargets={linkTargetNames(links.links)}
      schema={form.schema}
      choices={readingChoices(item, locale)}
      people={people}
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
          <dt className="text-muted">{t("fields.step")}</dt>
          <dd>{item.step.name[locale]}</dd>
          {item.outcome && (
            <>
              <dt className="text-muted">{t("fields.issuedCode")}</dt>
              <dd>
                <bdi dir="ltr" className="font-semibold">
                  {item.outcome}
                </bdi>
              </dd>
            </>
          )}
          {item.heldBy && (
            <>
              {/* Another Company by its name only, a person only within the viewer's own (V14). */}
              <dt className="text-muted">{t("fields.with")}</dt>
              <dd>{item.heldBy.memberName ? `${item.heldBy.memberName[locale]} · ${item.heldBy.companyName[locale]}` : item.heldBy.companyName[locale]}</dd>
            </>
          )}
          <dt className="text-muted">{t("fields.raisedBy")}</dt>
          <dd>{item.raisedBy.companyName[locale]}</dd>
          {/* The Creation Date only reaches the raiser's Participant; everyone who sees the item reads the Submission Date. */}
          {item.creationDate && (
            <>
              <dt className="text-muted">{tViews("list.creationDate")}</dt>
              <dd>{date(item.creationDate)}</dd>
            </>
          )}
          {item.submissionDate && (
            <>
              <dt className="text-muted">{tViews("list.submissionDate")}</dt>
              <dd>{date(item.submissionDate)}</dd>
            </>
          )}
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
        {history && <WorkItemHistory events={history.events} schema={form.schema} optionLists={optionLists} locale={locale} />}
      </article>
    </WorkItemFormProvider>
  );
}
