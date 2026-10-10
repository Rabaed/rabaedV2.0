import { answerFields, formatNumber, isOpenStageCategory, stepAgeLabel, watchOutcomeNames, type Locale } from "@rabaed/domain";
import { AgeDots, DocNo, Outcome, outcomesOfType, StagePill, stageColour } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { WorkItemActions } from "@/components/work-item-actions";
import { WorkItemAttachments } from "@/components/work-item-attachments";
import { WorkItemAnswers, WorkItemFormProvider } from "@/components/work-item-form";
import { WorkItemHistory } from "@/components/work-item-history";
import { WorkItemLinkedFrom } from "@/components/work-item-linked-from";
import { WorkItemLinks } from "@/components/work-item-links";
import { WorkItemReplacement } from "@/components/work-item-replacement";
import { WorkItemRevision } from "@/components/work-item-revision";
import { WorkItemRevisionPicker } from "@/components/work-item-revision-picker";
import { WorkItemWatch } from "@/components/work-item-watch";
import { WorkItemWorkflow } from "@/components/work-item-workflow";
import { Link, redirect } from "@/i18n/navigation";
import { fillingChoices, readingChoices } from "@/lib/built-in-choices";
import { hiddenLinkHrefs, linkTargetNames } from "@/lib/link-search";
import {
  getLinkedFrom,
  getMe,
  getMyVisibility,
  getOptionLists,
  getProjectScopes,
  getRevisionChain,
  getTypeOutcomes,
  getWatchState,
  getWorkItem,
  getWorkItemDocuments,
  getWorkItemForm,
  getWorkItemFormChoices,
  getWorkItemHistory,
  getWorkItemLinks,
  getWorkItemWorkflow,
} from "@/lib/session";

/**
 * One Work Item, in the frame every item has (form-engine.md §1): the System
 * Fields Subject and Document Number above its Form, Attachments and Links below it. One
 * the Member can't see is not found, exactly like one that doesn't exist.
 */
export default async function WorkItemPage({ params }: { params: Promise<{ locale: Locale; workItemId: string }> }) {
  const { locale, workItemId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("workItems");
  const tViews = await getTranslations("workItemViews");
  const [me, item, form, people, documents, links, linkedFrom, history, optionLists, chain, watch, workflowMap] = await Promise.all([
    getMe(),
    getWorkItem(workItemId),
    getWorkItemForm(workItemId),
    getWorkItemFormChoices(workItemId),
    getWorkItemDocuments(workItemId),
    getWorkItemLinks(workItemId),
    getLinkedFrom(workItemId),
    getWorkItemHistory(workItemId),
    getOptionLists(),
    getRevisionChain(workItemId),
    getWatchState(workItemId),
    getWorkItemWorkflow(workItemId),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!item || !form || !people || !documents || !links || !linkedFrom) notFound();
  // Editable: the Built-in Fields offer what a new item's do. Otherwise they only name the item's own values.
  // The closed item's Issued Code: the same badge as the List and the Kanban, from its Type's outcome set (RP-429, RP-522).
  const typeOutcomes = item.outcome ? await getTypeOutcomes(item.projectId, item.type.code) : null;
  const editable = item.actions.saveAnswers;
  const [mine, scopes] = editable
    ? await Promise.all([getMyVisibility(item.projectId), getProjectScopes(item.projectId)])
    : [null, null];
  const choices =
    mine && scopes ? fillingChoices(mine, scopes.scopes, locale, item) : readingChoices(item, locale);

  return (
    <WorkItemFormProvider
      workItemId={item.id}
      projectId={item.projectId}
      documentNumber={item.documentNumber}
      linkTargets={linkTargetNames(links.links)}
      hiddenLinks={hiddenLinkHrefs(item.id, links.links)}
      schema={form.schema}
      choices={choices}
      people={people}
      optionLists={optionLists}
      answers={item.answers}
      named={item.namedAnswers}
      editable={editable && !!mine && !!scopes}
      editableSections={form.editableSections}
      filledBy={form.filledBy}
      fieldTimes={item.fieldTimes}
      autosave={item.autosave}
    >
      <div className="max-w-3xl space-y-6">
        <div className="space-y-2">
          <Link href={`/projects/${item.projectId}/work-items`} className="text-sm text-primary underline underline-offset-4">
            {t("title")}
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-h4 font-semibold">{item.title}</h1>
            {/* The viewer's own Watch only: no list or count of watchers anywhere. */}
            {watch && <WorkItemWatch workItemId={item.id} watching={watch.watching} />}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StagePill stage={stageColour(item.stage)} label={item.stage.name[locale]} />
            {/* Step Age only while it waits at a Step; a closed item doesn't age. */}
            {isOpenStageCategory(item.stage.category) && item.stepAgeWeeks !== null && (
              <>
                {/* The dots already carry the label for screen readers; the text repeats it for sighted readers. */}
                <AgeDots weeks={item.stepAgeWeeks} locale={locale} />
                <span aria-hidden="true" className="text-sm text-muted">
                  {stepAgeLabel(item.stepAgeWeeks, locale)}
                </span>
              </>
            )}
          </div>
          {/* The Workflow and Version it runs, for everyone who sees it (V20); its map as they may know it (V14). */}
          {workflowMap && (
            <WorkItemWorkflow
              map={workflowMap}
              locale={locale}
              documentNumber={item.documentNumber}
              stepAgeWeeks={isOpenStageCategory(item.stage.category) ? item.stepAgeWeeks : null}
            />
          )}
        </div>

        <WorkItemActions workItemId={item.id} actions={item.actions} locale={locale} />
        <WorkItemRevision
          workItemId={item.id}
          projectId={item.projectId}
          canCreate={item.actions.createRevision}
          canDiscard={item.actions.discardRevision}
        />
        <WorkItemReplacement workItemId={item.id} canCreate={item.actions.createReplacement} />
        {item.versionsChanged && (
          <div role="note" className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 text-sm text-muted">
            <p>{t("versionsChanged")}</p>
            {item.droppedFields.length > 0 && (
              <>
                <p>{t("droppedFields")}</p>
                <ul className="list-disc ps-5">
                  {item.droppedFields.map((f) => (
                    <li key={f.key}>{f.label[locale]}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {/* The System Fields above the Form, the same on every Work Item. */}
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 rounded-md border border-border p-4">
          <dt className="text-muted">{t("fields.subject")}</dt>
          <dd>
            <bdi>{item.title}</bdi>
          </dd>
          <dt className="text-muted">{t("fields.documentNumber")}</dt>
          <dd className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {/* A Revision's number carries its " Rev n", and reads left to right whole. */}
            <span>
              {item.documentNumber ? (
                <DocNo value={item.documentNumber} />
              ) : item.revisionNo > 0 ? (
                tViews("list.revisionNoNumber", { revision: formatNumber(item.revisionNo, locale) })
              ) : (
                t("noNumber")
              )}
            </span>
            {/* The Revision drop-down: only the Revisions of the chain the viewer may see (V1 each). */}
            {chain && <WorkItemRevisionPicker chain={chain} workItemId={item.id} locale={locale} />}
          </dd>
        </dl>

        <WorkItemAnswers locale={locale} workItemId={item.id} documents={documents} />

        {/* The System Fields below the Form. */}
        <WorkItemAttachments workItemId={item.id} list={documents} locale={locale} />
        <WorkItemLinks
          workItemId={item.id}
          projectId={item.projectId}
          list={links}
          locale={locale}
          questionLabels={Object.fromEntries(answerFields(form.schema).map((f) => [f.key, f.label[locale]]))}
        >
          <WorkItemLinkedFrom items={linkedFrom.items} />
        </WorkItemLinks>

        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
          <dt className="text-muted">{t("fields.type")}</dt>
          <dd>
            {item.type.name[locale]}{" "}
            <bdi dir="ltr" className="text-sm text-muted">
              {item.type.code}
            </bdi>
          </dd>
          <dt className="text-muted">{t("fields.step")}</dt>
          <dd>{item.step.name[locale]}</dd>
          {item.outcome && (
            <>
              <dt className="text-muted">{t("fields.issuedCode")}</dt>
              <dd>
                <span data-testid="issued-code">
                  <Outcome
                    outcome={item.outcome}
                    typeCode={item.type.code}
                    outcomes={outcomesOfType(item.type.code, typeOutcomes?.outcomes ?? [])}
                    locale={locale}
                    cancelled={watchOutcomeNames.cancelled[locale]}
                  />
                </span>
              </dd>
            </>
          )}
          {item.heldBy && (
            <>
              {/* "With": another Company by its name only, a person only within the viewer's own (V14). */}
              <dt className="text-muted">{t("fields.with")}</dt>
              <dd data-testid="with-line">
                {item.heldBy.memberName
                  ? `${item.heldBy.memberName[locale]} · ${item.heldBy.companyName[locale]}`
                  : item.heldBy.pool && item.heldBy.pool.names.length > 0
                    ? // Pooled at the viewer's own Participant: who it waits on (§3.4).
                      t("fields.notPickedUpYet", {
                        company: item.heldBy.companyName[locale],
                        names: item.heldBy.pool.names.map((n) => n[locale]).join(locale === "ar" ? "، " : ", "),
                        more: item.heldBy.pool.more,
                      })
                    : item.heldBy.companyName[locale]}
              </dd>
            </>
          )}
          <dt className="text-muted">{t("fields.raisedBy")}</dt>
          <dd>{item.raisedBy.companyName[locale]}</dd>
          {/* Its Comments in the Snag List (Code B's), counting only those the viewer sees. */}
          {item.comments.open + item.comments.closed > 0 && (
            <>
              <dt className="text-muted">{t("fields.comments")}</dt>
              <dd data-testid="comment-counts">
                {t("fields.commentCounts", { open: formatNumber(item.comments.open, locale), closed: formatNumber(item.comments.closed, locale) })}
              </dd>
            </>
          )}
        </dl>

        {history && <WorkItemHistory events={history.events} schema={form.schema} optionLists={optionLists} locale={locale} />}
      </div>
    </WorkItemFormProvider>
  );
}
