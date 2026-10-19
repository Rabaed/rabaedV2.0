import { answerFields, formatNumber, isOpenStageCategory, sortedByName, stepAgeLabel, watchOutcomeNames, type Locale } from "@rabaed/domain";
import { AgeDots, DocNo, Outcome, outcomesOfType, PackageChip, SentBackNotice, StagePill, stageColour } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Fragment } from "react";
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
import { DownloadRecordButton } from "@/components/download-record-button";
import { WorkItemWorkflow } from "@/components/work-item-workflow";
import { Link, redirect } from "@/i18n/navigation";
import { fillingChoices, readingChoices } from "@/lib/built-in-choices";
import { hiddenLinkHrefs, linkTargetNames } from "@/lib/link-search";
import {
  getLinkedFrom,
  getMe,
  getMyVisibility,
  getOptionLists,
  getSupplierChoices,
  getChecklistTemplateChoices,
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
  const [suppliers, checklistTemplates] = await Promise.all([
    getSupplierChoices(item.projectId),
    getChecklistTemplateChoices(item.projectId, item.checklistCopies),
  ]);
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
      suppliers={suppliers}
      checklistTemplates={checklistTemplates}
      answers={item.answers}
      named={item.namedAnswers}
      editable={editable && !!mine && !!scopes}
      editableSections={form.editableSections}
      fixedByNumber={item.fixedByNumber}
      canCancel={item.actions.transitions.some((tr) => tr.kind === "cancel")}
      fieldTimes={item.fieldTimes}
      autosave={item.autosave}
    >
      <div className="max-w-3xl space-y-6">
        <div className="space-y-2">
          <Link href={`/projects/${item.projectId}/work-items`} className="text-sm text-brand-fg underline underline-offset-4">
            {t("title")}
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-h4 font-semibold">{item.title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              {/* A closed item's sealed Documental Record, for everyone who sees it (RP-620, V7). */}
              {item.outcome && <DownloadRecordButton workItemId={item.id} />}
              {/* The viewer's own Watch only: no list or count of watchers anywhere. */}
              {watch && <WorkItemWatch workItemId={item.id} watching={watch.watching} />}
            </div>
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
          {/* Where a Duplicate came from: the raiser's own Company only, and no time (RP-409). */}
          {item.duplicatedFrom && (
            <>
              <dt className="text-muted">{t("fields.duplicatedFrom")}</dt>
              <dd>
                <Link href={`/work-items/${item.duplicatedFrom.workItemId}`} className="text-brand-fg underline underline-offset-4">
                  {item.duplicatedFrom.documentNumber ? <DocNo value={item.duplicatedFrom.documentNumber} /> : <bdi>{item.duplicatedFrom.subject}</bdi>}
                </Link>
              </dd>
            </>
          )}
        </dl>

        {/* Sent Back to a "Comment only" Step (ADR 0021): why its Form is read-only, for the raiser's Members only. */}
        {item.sentBackForComment && <SentBackNotice>{t("sentBackForComment")}</SentBackNotice>}
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
                    ? // Pooled at the viewer's own Participant: who it waits on (§3.4), three
                      // names in the viewer's language's order, then how many more.
                      t("fields.notPickedUpYet", {
                        company: item.heldBy.companyName[locale],
                        names: sortedByName(item.heldBy.pool.names, (n) => n[locale], locale)
                          .slice(0, 3)
                          .map((n) => n[locale])
                          .join(locale === "ar" ? "، " : ", "),
                        more: Math.max(item.heldBy.pool.names.length - 3, 0),
                      })
                    : item.heldBy.companyName[locale]}
              </dd>
            </>
          )}
          <dt className="text-muted">{t("fields.raisedBy")}</dt>
          <dd>{item.raisedBy.companyName[locale]}</dd>
          {/* Its Package (RP-659): only where the API gives it, which is only where the viewer sees the Package. */}
          {item.package && (
            <>
              <dt className="text-muted">{t("fields.package")}</dt>
              <dd className="min-w-0">
                <PackageChip
                  number={item.package.number}
                  name={item.package.name[locale]}
                  href={`/packages/${item.package.id}`}
                  label={tViews("board.openPackage", { number: item.package.number, name: item.package.name[locale] })}
                  linkAs={Link}
                />
              </dd>
            </>
          )}
          {/* The items raised from it (its Comments, its Snags), one line per Type, counting only those the viewer sees. */}
          {item.raisedItems.map((f) => (
            <Fragment key={f.type.code}>
              <dt className="text-muted">{t.has(`fields.raisedItemTypes.${f.type.code}`) ? t(`fields.raisedItemTypes.${f.type.code}`) : f.type.name[locale]}</dt>
              <dd data-testid={`raised-item-counts-${f.type.code}`}>
                {t("fields.raisedItemCounts", { open: formatNumber(f.open, locale), closed: formatNumber(f.closed, locale) })}
              </dd>
            </Fragment>
          ))}
        </dl>

        {history && <WorkItemHistory events={history.events} schema={form.schema} optionLists={optionLists} locale={locale} />}
      </div>
    </WorkItemFormProvider>
  );
}
