"use client";

import {
  checklistItemFilesKey,
  checklistOfRead,
  formatDate,
  type ChecklistAnswers,
  type DocumentList,
  type DocumentSummary,
  type FieldError,
  type Locale,
  type ReplyChecklistRead,
} from "@rabaed/domain";
import { Button, ChecklistField, Icon } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { InspectionChips, useInspection } from "@/components/inspection-context";
import { useDocuments, useImageUrls } from "@/components/use-documents";
import { useWorkItemForm } from "@/components/work-item-form";
import { useFormRendererLabels } from "@/lib/form-labels";
import { changedItems, itemsShown, type ItemFilter } from "@/lib/inspection";

// A reply Screen's checklist (RP-86; ADR 0024 amended 2026-10-19; form-engine.md §3.3): the
// Participant holding the item answers it at the Steps on its way to the Transition that takes it,
// item by item, with comments and photos, saved as it goes; the code pop-up reads it. Only that
// Participant reads it until the code shares it (V19), which the API alone decides.
//
// On a WIR's page (RP-655) it is the Consultant Engineer's on-site checklist: whose the answers
// stay until sent, the filter chips, each item's own "Saved" or "Not saved" with Retry, and its
// answers as typed for the summary bar and Send to Manager.

/** How long after the last change the answers save themselves. */
const SAVE_MS = 800;

/**
 * The checklist's photos: its items' reply Documents, each annotated copy beside its original
 * (RP-981); those no Transition took yet, or with `taken` those the code took (read after it).
 */
const photosOf = (checklist: Pick<ReplyChecklistRead, "fieldKey">, documents: readonly DocumentSummary[], taken = false) =>
  documents.filter((d) => d.reply && d.reply.taken === taken && d.fieldKey === checklist.fieldKey && d.itemKey !== null);

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

/** How the last save went: under way, done (when), refused (the API named what to fix), or not reached (the signal dropped). */
type SaveState = { status: "saving" } | { status: "saved"; at: Date } | { status: "refused" } | { status: "offline" } | null;

function ReplyChecklist({ workItemId, checklist, documents, locale }: { workItemId: string; checklist: ReplyChecklistRead; documents: DocumentList; locale: Locale }) {
  const t = useTranslations("workItems.replyChecklist");
  const tInspection = useTranslations("workItems.inspection");
  const labels = useFormRendererLabels().checklist;
  const itemForm = useWorkItemForm();
  const inspection = useInspection();
  const files = useDocuments(workItemId, documents.limits, { reply: true });
  const photos = photosOf(checklist, documents.documents);
  const imageUrls = useImageUrls(workItemId, photos);
  const [answers, setAnswers] = useState<ChecklistAnswers>(checklist.answers);
  const [save, setSave] = useState<SaveState>(null);
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [filter, setFilter] = useState<ItemFilter>("all");
  const latest = useRef(answers);
  // What the API holds: the items changed since are the ones a failed save left unsaved.
  const saved = useRef(checklist.answers);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A refused Send to Manager names this checklist's items among the Form's errors.
  const shown = [...errors, ...(itemForm?.errors ?? []).filter((e) => e.key === checklist.fieldKey && e.item !== undefined)];

  const store = useCallback(async () => {
    setSave({ status: "saving" });
    const sending = latest.current;
    const res = await fetch(`/api/v1/work-items/${workItemId}/reply-checklists/${checklist.fieldKey}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: sending }),
    }).catch(() => null);
    if (res?.ok) {
      saved.current = sending;
      setErrors([]);
      return setSave({ status: "saved", at: new Date() });
    }
    // A refusal names what to fix; no answer at all (or a server error) means the signal dropped: the answers stay here to retry.
    if (res && res.status < 500) {
      const body = (await res.json().catch(() => ({}))) as { fields?: FieldError[] };
      setErrors(body.fields ?? []);
      return setSave({ status: "refused" });
    }
    setSave({ status: "offline" });
  }, [workItemId, checklist.fieldKey]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function change(next: ChecklistAnswers | undefined) {
    const value = next ?? {};
    setAnswers(value);
    latest.current = value;
    inspection?.setAnswers(checklist.fieldKey, value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void store(), SAVE_MS);
  }

  const status = save?.status;
  const unsaved = new Set(status === "saving" || status === "offline" || status === "refused" ? changedItems(saved.current, answers) : []);

  /** An item's own line on the WIR's page: Saved, Saving…, or Not saved with Retry. */
  const itemFooter = (key: string) => {
    if (status === "offline" && unsaved.has(key)) {
      return (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger-fg/40 bg-danger-tint p-3 text-sm text-danger-fg">
          <p className="flex items-start gap-2">
            <Icon name="alert-triangle" size={16} className="mt-0.5 shrink-0" />
            <span>{tInspection("save.offline")}</span>
          </p>
          <Button variant="secondary" size="sm" className="min-h-11 md:min-h-8" onClick={() => void store()}>
            <Icon name="refresh" size={16} />
            {tInspection("save.retry")}
          </Button>
        </div>
      );
    }
    if (unsaved.has(key) && status === "saving") return <p className="text-sm text-muted">{t("saving")}</p>;
    if (unsaved.has(key)) return <p className="text-sm text-danger-fg">{tInspection("save.notSaved")}</p>;
    if (answers[key] === undefined) return null;
    return (
      <p className="flex items-center gap-1 text-sm font-medium text-success-fg">
        <Icon name="check" size={14} />
        {tInspection("save.saved")}
      </p>
    );
  };

  const field = (
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
      onSaveAnnotated={files.annotatesIn(photos)}
      {...(inspection ? { shown: new Set(itemsShown(checklist.items, answers, filter)), itemFooter, summary: false } : {})}
    />
  );

  if (inspection) {
    return (
      <section aria-labelledby={`reply-checklist-${checklist.fieldKey}`} className="flex flex-col gap-3">
        <h2 id={`reply-checklist-${checklist.fieldKey}`} className="font-display text-h6 font-semibold">
          {checklist.label[locale]} · <bdi>{checklist.name[locale]}</bdi>
        </h2>
        <div className="flex flex-col gap-1 text-sm">
          {status === "saved" && save?.status === "saved" && (
            <p role="status" className="flex items-center gap-1 font-semibold text-success-fg">
              <Icon name="check" size={16} />
              {tInspection("save.savedAt", { time: formatDate(save.at, locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) })}
            </p>
          )}
          {inspection.holder && (
            <p className="flex items-start gap-1 text-muted">
              <Icon name="eye-off" size={16} className="mt-0.5 shrink-0" />
              {tInspection("privacy", { company: inspection.holder[locale] })}
            </p>
          )}
        </div>
        <InspectionChips items={checklist.items} answers={answers} filter={filter} locale={locale} onFilter={setFilter} />
        {field}
        {files.message && (
          <p role="status" className="text-sm text-muted">
            {files.message}
          </p>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby={`reply-checklist-${checklist.fieldKey}`} className="flex flex-col gap-3 rounded-md border border-border p-4">
      <h2 id={`reply-checklist-${checklist.fieldKey}`} className="font-display text-h6 font-semibold">
        {checklist.label[locale]} · <bdi>{checklist.name[locale]}</bdi>
      </h2>
      {checklist.canChange && <p className="text-sm text-muted">{t("intro")}</p>}
      {field}
      {(status || files.message) && (
        <p role={status === "offline" || status === "refused" ? "alert" : "status"} className={status === "offline" || status === "refused" ? "text-sm text-danger-fg" : "text-sm text-muted"}>
          {status ? t(status === "offline" || status === "refused" ? "notSaved" : status) : files.message}
        </p>
      )}
    </section>
  );
}

/**
 * The code pop-up's reading of the checklists its Screen takes (RP-86): each one's summary and its
 * items read-only, with the photos the viewer's own Participant added, which the Transition shares.
 * On a WIR's page (RP-655) also the Manager's read and, with `taken`, the checklist as the code
 * shared it, with the photos it took; `shown` filters the items, `heading` false leaves out its name.
 */
export function ReplyChecklistsRead({
  workItemId,
  checklists,
  locale,
  shown,
  heading = true,
  taken = false,
}: {
  workItemId: string;
  checklists: readonly ReplyChecklistRead[];
  locale: Locale;
  shown?: ReadonlySet<string>;
  heading?: boolean;
  taken?: boolean;
}) {
  const labels = useFormRendererLabels().checklist;
  const [list, setList] = useState<DocumentList | null>(null);
  useEffect(() => {
    void fetch(`/api/v1/work-items/${workItemId}/documents`)
      .then((res) => (res.ok ? (res.json() as Promise<DocumentList>) : null))
      .then(setList)
      .catch(() => null);
  }, [workItemId]);
  const files = useDocuments(workItemId, list?.limits ?? { maxBytes: 0, contentTypes: [] }, { reply: true });
  const photos = checklists.flatMap((c) => photosOf(c, list?.documents ?? [], taken));
  const imageUrls = useImageUrls(workItemId, photos);
  return (
    <>
      {checklists.map((c) => (
        <section key={c.fieldKey} aria-label={c.label[locale]} className="flex flex-col gap-2">
          {heading && (
            <h3 className="text-body font-semibold">
              {c.label[locale]} · <bdi>{c.name[locale]}</bdi>
            </h3>
          )}
          <ChecklistField
            field={checklistOfRead(c)}
            value={c.answers}
            mode="read"
            locale={locale}
            labels={labels}
            files={{ documents: photosOf(c, list?.documents ?? [], taken), canChange: false, imageUrls }}
            onOpen={(documentId) => void files.open(documentId)}
            {...(shown ? { shown, summary: false } : {})}
          />
        </section>
      ))}
    </>
  );
}
