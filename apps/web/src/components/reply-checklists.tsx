"use client";

import {
  checklistItemFilesKey,
  checklistOfRead,
  isAnnotatedCopy,
  type ChecklistAnswers,
  type DocumentList,
  type DocumentSummary,
  type FieldError,
  type Locale,
  type ReplyChecklistRead,
} from "@rabaed/domain";
import { ChecklistField } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDocuments, useImageUrls } from "@/components/use-documents";
import { useWorkItemForm } from "@/components/work-item-form";
import { useFormRendererLabels } from "@/lib/form-labels";

// A reply Screen's checklist (RP-86; ADR 0024 amended 2026-10-19; form-engine.md §3.3): the
// Participant holding the item answers it at the Steps on its way to the Transition that takes it,
// item by item, with comments and photos, saved as it goes; the code pop-up reads it. Only that
// Participant reads it until the code shares it (V19), which the API alone decides.

/** How long after the last change the answers save themselves. */
const SAVE_MS = 800;

/** The checklist's photos that no Transition took yet: its items' reply Documents. */
const photosOf = (checklist: ReplyChecklistRead, documents: readonly DocumentSummary[]) =>
  documents.filter((d) => d.reply && !d.reply.taken && d.fieldKey === checklist.fieldKey && d.itemKey !== null && !isAnnotatedCopy(d));

/**
 * The item page's reply checklists, for the Participant holding the item (RP-86): each one's items
 * to answer, with comment and photos as each asks, saved a moment after each change. A Send to
 * Manager refused for a missing answer, comment or photo marks the item (the Form's errors by
 * this field's key).
 */
export function ReplyChecklists({
  workItemId,
  checklists,
  documents,
  locale,
}: {
  workItemId: string;
  checklists: readonly ReplyChecklistRead[];
  documents: DocumentList;
  locale: Locale;
}) {
  if (checklists.length === 0) return null;
  return (
    <>
      {checklists.map((c) => (
        <ReplyChecklist key={c.fieldKey} workItemId={workItemId} checklist={c} documents={documents} locale={locale} />
      ))}
    </>
  );
}

function ReplyChecklist({ workItemId, checklist, documents, locale }: { workItemId: string; checklist: ReplyChecklistRead; documents: DocumentList; locale: Locale }) {
  const t = useTranslations("workItems.replyChecklist");
  const labels = useFormRendererLabels().checklist;
  const itemForm = useWorkItemForm();
  const files = useDocuments(workItemId, documents.limits, { reply: true });
  const photos = photosOf(checklist, documents.documents);
  const imageUrls = useImageUrls(workItemId, photos);
  const [answers, setAnswers] = useState<ChecklistAnswers>(checklist.answers);
  const [status, setStatus] = useState<"saving" | "saved" | "notSaved" | null>(null);
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const latest = useRef(answers);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A refused Send to Manager names this checklist's items among the Form's errors.
  const shown = [...errors, ...(itemForm?.errors ?? []).filter((e) => e.key === checklist.fieldKey && e.item !== undefined)];

  const save = useCallback(async () => {
    setStatus("saving");
    const res = await fetch(`/api/v1/work-items/${workItemId}/reply-checklists/${checklist.fieldKey}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: latest.current }),
    }).catch(() => null);
    if (res?.ok) {
      setErrors([]);
      return setStatus("saved");
    }
    const body = res ? ((await res.json().catch(() => ({}))) as { fields?: FieldError[] }) : {};
    setErrors(body.fields ?? []);
    setStatus("notSaved");
  }, [workItemId, checklist.fieldKey]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function change(next: ChecklistAnswers | undefined) {
    const value = next ?? {};
    setAnswers(value);
    latest.current = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_MS);
  }

  return (
    <section aria-labelledby={`reply-checklist-${checklist.fieldKey}`} className="flex flex-col gap-3 rounded-md border border-border p-4">
      <h2 id={`reply-checklist-${checklist.fieldKey}`} className="font-display text-h6 font-semibold">
        {checklist.label[locale]} · <bdi>{checklist.name[locale]}</bdi>
      </h2>
      {checklist.canChange && <p className="text-sm text-muted">{t("intro")}</p>}
      <ChecklistField
        field={checklistOfRead(checklist)}
        value={answers}
        mode={checklist.canChange ? "edit" : "read"}
        locale={locale}
        labels={labels}
        errors={shown}
        files={{
          documents: photos,
          canChange: checklist.canChange && documents.canChangeReplies,
          pendingItems: new Set(checklist.items.filter((i) => files.pending.has(checklistItemFilesKey(checklist.fieldKey, i.key))).map((i) => i.key)),
          imageUrls,
        }}
        onChange={change}
        onUpload={(itemKey, picked) => void files.upload(picked, checklist.fieldKey, itemKey)}
        onOpen={(documentId) => void files.open(documentId)}
        onRemove={(itemKey, documentId) => void files.remove(documentId, checklist.fieldKey, itemKey)}
      />
      {(status || files.message) && (
        <p role={status === "notSaved" ? "alert" : "status"} className={status === "notSaved" ? "text-sm text-danger-fg" : "text-sm text-muted"}>
          {status ? t(status) : files.message}
        </p>
      )}
    </section>
  );
}

/**
 * The code pop-up's reading of the checklists its Screen takes (RP-86): each one's summary and its
 * items read-only, with the photos the viewer's own Participant added, which the Transition shares.
 */
export function ReplyChecklistsRead({ workItemId, checklists, locale }: { workItemId: string; checklists: readonly ReplyChecklistRead[]; locale: Locale }) {
  const labels = useFormRendererLabels().checklist;
  const [list, setList] = useState<DocumentList | null>(null);
  useEffect(() => {
    void fetch(`/api/v1/work-items/${workItemId}/documents`)
      .then((res) => (res.ok ? (res.json() as Promise<DocumentList>) : null))
      .then(setList)
      .catch(() => null);
  }, [workItemId]);
  const files = useDocuments(workItemId, list?.limits ?? { maxBytes: 0, contentTypes: [] }, { reply: true });
  const photos = checklists.flatMap((c) => photosOf(c, list?.documents ?? []));
  const imageUrls = useImageUrls(workItemId, photos);
  return (
    <>
      {checklists.map((c) => (
        <section key={c.fieldKey} aria-label={c.label[locale]} className="flex flex-col gap-2">
          <h3 className="text-body font-semibold">
            {c.label[locale]} · <bdi>{c.name[locale]}</bdi>
          </h3>
          <ChecklistField
            field={checklistOfRead(c)}
            value={c.answers}
            mode="read"
            locale={locale}
            labels={labels}
            files={{ documents: photosOf(c, list?.documents ?? []), canChange: false, imageUrls }}
            onOpen={(documentId) => void files.open(documentId)}
          />
        </section>
      ))}
    </>
  );
}
