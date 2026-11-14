"use client";

import {
  answerFields,
  checklistTemplateChoices,
  formFields,
  type ApprovedSuppliers,
  type ChecklistTemplates,
  type DimensionValues,
  type DocumentList,
  type FormChoices,
  type FormToFill,
  type LinkedFrom,
  type LinkedFromItem,
  type Locale,
  type OptionList,
  type RevisionChain,
  type Scopes,
  type WorkItemDetail,
  type WorkItemLinks,
} from "@rabaed/domain";
import { useEffect, useState, type ReactNode } from "react";
import { WorkItemFormProvider } from "@/components/work-item-form";
import { fillingChoices, readingChoices } from "@/lib/built-in-choices";
import { hiddenLinkHrefs, linkTargetNames } from "@/lib/link-search";

/**
 * What the Submittal Panel reads beside the item to show its whole Form and let its holder edit it
 * (RP-1237 rows 12, 28): the reads the Work Item page's server made, now made from the browser, so the
 * panel at Full is the item's page. Each is an existing API read (no new endpoint), and each gives only
 * what the viewer may see. The names an answer needs are read only when its Form asks them; what the
 * Built-in Fields offer (the viewer's own Visibility and the Project's Scopes) only while they may edit.
 */
export type SubmittalPanelReads = {
  id: string;
  form: FormToFill;
  people: FormChoices;
  documents: DocumentList;
  links: WorkItemLinks;
  /** The Submitted items linking here that the viewer sees (RP-1301); null when that read failed, so none is shown. */
  linkedFrom: readonly LinkedFromItem[] | null;
  optionLists: OptionList[];
  suppliers: { id: string; tradeId: string; status: ApprovedSuppliers["suppliers"][number]["status"]; name: ApprovedSuppliers["suppliers"][number]["name"] }[];
  checklistTemplates: ReturnType<typeof checklistTemplateChoices>;
  /** The Built-in Fields' offer while the viewer may edit; null otherwise (they then name the item's own values). */
  filling: { mine: DimensionValues; scopes: Scopes["scopes"] } | null;
  /** The Revisions of its chain the viewer may see; null when it can't be read. */
  chain: RevisionChain | null;
};

type Read = SubmittalPanelReads | { id: string; failed: true };

async function readJson<T>(path: string, signal: AbortSignal): Promise<T | null> {
  const res = await fetch(`/api/v1${path}`, { signal });
  return res.ok ? ((await res.json()) as T) : null;
}

/** The panel's reads for `item`, again whenever `refreshKey` changes; a read again that fails keeps what is shown. */
export function useSubmittalPanelReads(item: WorkItemDetail | null, refreshKey: unknown): { reads: SubmittalPanelReads | null; failed: boolean } {
  const [read, setRead] = useState<Read | null>(null);
  const id = item?.id ?? null;
  const projectId = item?.projectId ?? null;
  const editable = item?.actions.saveAnswers ?? false;
  // By value: a read again gives a new array with the same copies, which is no reason to read again.
  const copies = JSON.stringify(item?.checklistCopies ?? []);
  useEffect(() => {
    if (id === null || projectId === null) return;
    const controller = new AbortController();
    const { signal } = controller;
    const failed = () => setRead((shown) => (shown?.id === id && !("failed" in shown) ? shown : { id, failed: true }));
    void (async () => {
      const [form, people, documents, links, chain, linkedFrom] = await Promise.all([
        readJson<FormToFill>(`/work-items/${id}/form`, signal),
        readJson<FormChoices>(`/work-items/${id}/form-choices`, signal),
        readJson<DocumentList>(`/work-items/${id}/documents`, signal),
        readJson<WorkItemLinks>(`/work-items/${id}/links`, signal),
        readJson<RevisionChain>(`/work-items/${id}/revisions`, signal),
        // Linked from, as the Work Item page reads it: only the linking items the viewer sees (RP-1301).
        readJson<LinkedFrom>(`/work-items/${id}/linked-from`, signal),
      ]);
      if (!form || !people || !documents || !links) return failed();
      const types = new Set(formFields(form.schema).map((f) => f.type));
      const [suppliers, lists, templates, mine, scopes] = await Promise.all([
        types.has("approved_supplier") ? readJson<ApprovedSuppliers>(`/projects/${projectId}/approved-suppliers`, signal) : null,
        readJson<{ optionLists: OptionList[] }>("/option-lists", signal),
        types.has("checklist_template") ? readJson<ChecklistTemplates>(`/projects/${projectId}/checklist-templates`, signal) : null,
        editable ? readJson<DimensionValues>(`/projects/${projectId}/visibility`, signal) : null,
        editable ? readJson<Scopes>(`/projects/${projectId}/scopes`, signal) : null,
      ]);
      setRead({
        id,
        form,
        people,
        documents,
        links,
        linkedFrom: linkedFrom?.items ?? null,
        chain,
        optionLists: lists?.optionLists ?? [],
        suppliers: (suppliers?.suppliers ?? []).map((s) => ({ id: s.id, tradeId: s.tradeId, status: s.status, name: s.name })),
        checklistTemplates: checklistTemplateChoices(templates?.templates ?? [], JSON.parse(copies) as WorkItemDetail["checklistCopies"]),
        filling: mine && scopes ? { mine, scopes: scopes.scopes } : null,
      });
    })().catch(() => {
      if (!signal.aborted) failed();
    });
    return () => controller.abort();
  }, [id, projectId, editable, copies, refreshKey]);
  if (!read || read.id !== id) return { reads: null, failed: false };
  return "failed" in read ? { reads: null, failed: true } : { reads: read, failed: false };
}

/**
 * The item's Form around the panel (RP-1237 row 28), as the Work Item page's server gave it: to read,
 * or, while its holder has pressed Edit, to fill in, saved by the bar's Save Draft. Keyed by the item, so
 * what was typed never carries over to another one. Without its reads, the panel shows as it is.
 */
export function SubmittalPanelForm({
  item,
  reads,
  editing,
  locale,
  children,
}: {
  item: WorkItemDetail | null;
  reads: SubmittalPanelReads | null;
  editing: boolean;
  locale: Locale;
  children: ReactNode;
}) {
  if (!item || !reads || reads.id !== item.id) return <>{children}</>;
  const editable = editing && item.actions.saveAnswers && reads.filling !== null;
  const choices = editable && reads.filling ? fillingChoices(reads.filling.mine, reads.filling.scopes, locale, item) : readingChoices(item, locale);
  return (
    <WorkItemFormProvider
      key={item.id}
      workItemId={item.id}
      projectId={item.projectId}
      documentNumber={item.documentNumber}
      linkTargets={linkTargetNames(reads.links.links)}
      hiddenLinks={hiddenLinkHrefs(item.id, reads.links.links)}
      schema={reads.form.schema}
      choices={choices}
      people={reads.people}
      optionLists={reads.optionLists}
      suppliers={reads.suppliers}
      checklistTemplates={reads.checklistTemplates}
      answers={item.answers}
      named={item.namedAnswers}
      editable={editable}
      editableSections={reads.form.editableSections}
      fixedByNumber={item.fixedByNumber}
      canCancel={item.actions.transitions.some((tr) => tr.kind === "cancel")}
      fieldTimes={item.fieldTimes}
      autosave={item.autosave}
    >
      {children}
    </WorkItemFormProvider>
  );
}

/** The labels of the Form's questions, for the Links section's "asked by" (the Work Item page's own). */
export function questionLabelsOf(reads: SubmittalPanelReads, locale: Locale): Record<string, string> {
  return Object.fromEntries(answerFields(reads.form.schema).map((f) => [f.key, f.label[locale]]));
}
