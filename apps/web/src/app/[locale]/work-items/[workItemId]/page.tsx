import { isOpenStageCategory, stepAgeLabel, type Locale } from "@rabaed/domain";
import { AgeDots, DocNo, StagePill } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { WorkItemActions } from "@/components/work-item-actions";
import { WorkItemAttachments } from "@/components/work-item-attachments";
import { WorkItemAnswers, WorkItemFormProvider } from "@/components/work-item-form";
import { WorkItemHistory } from "@/components/work-item-history";
import { Link, redirect } from "@/i18n/navigation";
import {
  getMe,
  getWorkItem,
  getWorkItemDocuments,
  getWorkItemForm,
  getWorkItemFormChoices,
  getWorkItemHistory,
} from "@/lib/session";
import { stageColour } from "@/lib/stage-colour";

/**
 * One Work Item, in the frame every item has (form-engine.md §1): the System
 * Fields Subject and Document Number above its Form, Attachments below it. One
 * the Member can't see is not found, exactly like one that doesn't exist.
 */
export default async function WorkItemPage({ params }: { params: Promise<{ locale: Locale; workItemId: string }> }) {
  const { locale, workItemId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("workItems");
  const [me, item, form, choices, documents, history] = await Promise.all([
    getMe(),
    getWorkItem(workItemId),
    getWorkItemForm(workItemId),
    getWorkItemFormChoices(workItemId),
    getWorkItemDocuments(workItemId),
    getWorkItemHistory(workItemId),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!item || !form || !choices || !documents) notFound();

  return (
    <WorkItemFormProvider
      workItemId={item.id}
      schema={form.schema}
      answers={item.answers}
      named={item.namedAnswers}
      choices={choices}
      editable={item.actions.saveAnswers}
    >
      <div className="max-w-3xl space-y-6">
        <div className="space-y-2">
          <Link href={`/projects/${item.projectId}/work-items`} className="text-sm text-primary underline underline-offset-4">
            {t("title")}
          </Link>
          <h1 className="text-h4 font-semibold">{item.title}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <StagePill stage={stageColour(item.stage)} label={item.stage.name[locale]} />
            {/* Step Age only while it waits at a Step; a closed item doesn't age. */}
            {isOpenStageCategory(item.stage.category) && (
              <>
                {/* The dots already carry the label for screen readers; the text repeats it for sighted readers. */}
                <AgeDots weeks={item.stepAgeWeeks} locale={locale} />
                <span aria-hidden="true" className="text-sm text-muted">
                  {stepAgeLabel(item.stepAgeWeeks, locale)}
                </span>
              </>
            )}
          </div>
        </div>

        <WorkItemActions workItemId={item.id} actions={item.actions} locale={locale} />

        {/* The System Fields above the Form, the same on every Work Item. */}
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 rounded-md border border-border p-4">
          <dt className="text-muted">{t("fields.subject")}</dt>
          <dd>
            <bdi>{item.title}</bdi>
          </dd>
          <dt className="text-muted">{t("fields.documentNumber")}</dt>
          <dd>{item.documentNumber ? <DocNo value={item.documentNumber} /> : t("noNumber")}</dd>
        </dl>

        <WorkItemAnswers locale={locale} />

        {/* The System Field below the Form. */}
        <WorkItemAttachments workItemId={item.id} list={documents} locale={locale} />

        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
          <dt className="text-muted">{t("fields.type")}</dt>
          <dd>
            {item.type.name[locale]}{" "}
            <bdi dir="ltr" className="text-sm text-muted">
              {item.type.code}
            </bdi>
          </dd>
          <dt className="text-muted">{t("fields.trade")}</dt>
          <dd>{item.trade.name[locale]}</dd>
          <dt className="text-muted">{t("fields.location")}</dt>
          <dd>{item.location ? item.location.name[locale] : t("noLocation")}</dd>
          <dt className="text-muted">{t("fields.step")}</dt>
          <dd>{item.step.name[locale]}</dd>
          {item.outcome && (
            <>
              <dt className="text-muted">{t("fields.issuedCode")}</dt>
              <dd>
                <bdi dir="ltr" className="font-semibold" data-testid="issued-code">
                  {item.outcome}
                </bdi>
              </dd>
            </>
          )}
          {item.heldBy && (
            <>
              {/* "With": another Company by its name only, a person only within the viewer's own (V14). */}
              <dt className="text-muted">{t("fields.with")}</dt>
              <dd>
                {item.heldBy.memberName
                  ? `${item.heldBy.memberName[locale]} · ${item.heldBy.companyName[locale]}`
                  : item.heldBy.companyName[locale]}
              </dd>
            </>
          )}
          <dt className="text-muted">{t("fields.raisedBy")}</dt>
          <dd>{item.raisedBy.companyName[locale]}</dd>
        </dl>

        {history && <WorkItemHistory events={history.events} locale={locale} />}
      </div>
    </WorkItemFormProvider>
  );
}
