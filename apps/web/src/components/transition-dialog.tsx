"use client";

import {
  formFields,
  isAnnotatedCopy,
  isScreenFileField,
  checklistsPropose,
  validateAnswers,
  type BilingualText,
  type DocumentList,
  type FieldError,
  type FormSchema,
  type Locale,
  type ReplyChecklistRead,
  type WorkItemActions,
} from "@rabaed/domain";
import { ActionForm, Badge, Button, Field, Select, type FormFiles } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ReplyChecklistsRead } from "@/components/reply-checklists";
import { useDocuments, useImageUrls } from "@/components/use-documents";
import { useWorkItemForm } from "@/components/work-item-form";
import { useRouter } from "@/i18n/navigation";
import { useActionFormLabels } from "@/lib/form-labels";

/**
 * A Transition as the pop-up needs it: the item's page and the Kanban's moves both
 * have one. `assignTo`: the Members it offers as the next holder (WF-8), the
 * taker's own Company's only; absent when it offers none. `recommendCode`: the
 * outcomes it may recommend to the next reviewer of the taker's own Company
 * (RP-433); absent when it offers none. `participants`: the Participants covering
 * the item, one of whom the taker must pick to hold the next Step (RP-658), by
 * Company name only; absent when it goes to one.
 */
export type TransitionChoice = {
  key: string;
  label: BilingualText;
  actionForm: FormSchema | null;
  assignTo?: { memberId: string; name: BilingualText }[];
  recommendCode?: { code: string; name: BilingualText }[];
  participants?: { participantId: string; companyName: BilingualText }[];
  /** The answers the pop-up starts from: the reply that brought the item here, inside the taker's own Company (RP-437). */
  prefill?: Record<string, unknown>;
  /** The checklists its Screen takes, as the taker's own Company answered them (RP-86): read-only here. */
  checklists?: ReplyChecklistRead[];
  /** The code its checklists propose (ADR 0025): this Transition issues it. */
  proposed?: true;
};

/** The "Assign to" choice that leaves the next Step to its Step Pool. */
const TO_POOL = "pool";
/** The Recommended Code choice that recommends none. */
const NO_RECOMMENDED_CODE = "none";

/** Why a call was refused, as the API said: its code and, for a Form, the fields to fix. */
type Refusal = { code: string | undefined; fields?: FieldError[] };

/**
 * Pick up, Return to pool and take-Transition calls on one Work Item, the same on its
 * page and on the Kanban: one answer per refusal code (the "Refusals of a
 * Transition" channel: never why a Step can't be taken), the page refreshed
 * when the item moved or went away under us, and each Transition's idempotency
 * key kept until it succeeds, so a double click or a retry moves the item once.
 */
export function useWorkItemCalls(workItemId: string) {
  const t = useTranslations("workItems.actions");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());

  const errors: Record<string, string> = {
    not_holder: t("notHolder"),
    already_picked_up: t("alreadyPickedUp"),
    invalid_action_form: t("actionFormInvalid"),
    forbidden: t("forbidden"),
    no_step_pool: t("noStepPool"),
    next_step_unavailable: t("nextStepUnavailable"),
    no_route: t("noRoute"),
    assignee_not_offered: t("assigneeNotOffered"),
    action_not_allowed: t("actionNotAllowed"),
    recommended_code_not_offered: t("recommendedCodeNotOffered"),
    participant_not_picked: t("participantNotPicked"),
    participant_not_offered: t("participantNotOffered"),
    transition_not_available: t("notAvailable"),
    item_closed: t("notAvailable"),
    project_closed: t("projectClosed"),
    form_incomplete: t("formIncomplete"),
    form_not_checked: t("tryAgain"),
    not_confirmed: t("tryAgain"),
    no_signature: t("noSignature"),
    no_stamp: t("noStamp"),
  };

  /** POSTs to the item's `path`: true when done, else the refusal, its message shown as `error`. */
  async function send(path: string, body?: unknown): Promise<true | Refusal> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/work-items/${workItemId}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (res.ok) {
        router.refresh();
        return true;
      }
      const { error: code, fields, message } = (await res.json().catch(() => ({}))) as {
        error?: string;
        fields?: FieldError[];
        message?: BilingualText;
      };
      // A Validate rule (WF-7) says why in its own words, in the viewer's language.
      setError(code === "validation_failed" && message ? message[locale] : (errors[code ?? ""] ?? t("unavailable")));
      // The item moved or went away under us: show what is true now.
      if (res.status === 404 || res.status === 409) router.refresh();
      return { code, fields };
    } catch {
      setError(t("unavailable"));
      return { code: undefined };
    } finally {
      setPending(false);
    }
  }

  /**
   * Takes `transition` with its checked answers, Internal Note and, if picked, the
   * next holder, the Recommended Code and the next Step's Participant. Called only from the pop-up's confirm
   * button, so the Transition goes as confirmed (ADR 0017).
   */
  async function take(
    transition: string,
    answers: Record<string, unknown>,
    internalNote: string,
    assignTo: string | null = null,
    recommendedCode: string | null = null,
    participant: string | null = null,
  ): Promise<true | Refusal> {
    let idempotencyKey = keys.current.get(transition);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      keys.current.set(transition, idempotencyKey);
    }
    const result = await send("transitions", {
      transition,
      answers,
      internalNote: internalNote.trim(),
      assignTo,
      recommendedCode,
      participant,
      confirmed: true,
      idempotencyKey,
    });
    if (result === true) keys.current.delete(transition);
    return result;
  }

  return { workItemId, pending, error, setError, send, take };
}

export type WorkItemCalls = ReturnType<typeof useWorkItemCalls>;

/** Until the item's Documents are read, nothing may be uploaded. */
const noLimits: DocumentList["limits"] = { maxBytes: 0, contentTypes: [] };

/**
 * The files of a reply Screen's `photos` and `attachments` fields (ADR 0024), for the
 * pop-up of a Transition whose Action Form has any: the ones the viewer's Participant added
 * that no Transition took yet, read when it opens and again after each change. `counts`
 * gives the validator each field's files; `files` is null while they are read, and for a
 * Transition with no such field.
 */
function useReplyFiles(workItemId: string, actionForm: FormSchema | null) {
  const hasFiles = actionForm !== null && formFields(actionForm).some(isScreenFileField);
  const [list, setList] = useState<DocumentList | null>(null);
  const reload = useCallback(async () => {
    const res = await fetch(`/api/v1/work-items/${workItemId}/documents`).catch(() => null);
    if (res?.ok) setList((await res.json()) as DocumentList);
  }, [workItemId]);
  useEffect(() => {
    if (hasFiles) void reload();
  }, [hasFiles, reload]);
  const documents = useDocuments(workItemId, list?.limits ?? noLimits, { reply: true, onChanged: () => void reload() });
  const waiting = (list?.documents ?? []).filter((d) => d.reply && !d.reply.taken);
  const imageUrls = useImageUrls(workItemId, waiting);
  const counts: Record<string, number> = {};
  for (const d of waiting) if (!isAnnotatedCopy(d) && d.fieldKey !== null) counts[d.fieldKey] = (counts[d.fieldKey] ?? 0) + 1;
  const files: FormFiles | null =
    hasFiles && list
      ? {
          documents: waiting,
          canChange: list.canChangeReplies,
          pending: documents.pending,
          imageUrls,
          onUpload: (fieldKey, picked) => void documents.upload(picked, fieldKey),
          onOpen: (documentId) => void documents.open(documentId),
          onRemove: (fieldKey, documentId) => void documents.remove(documentId, fieldKey),
        }
      : null;
  return { files, counts, message: documents.message };
}

/**
 * A Transition's pop-up, on the item's page and for a Kanban move (RP-350): its
 * Action Form, drawn from the Transition's schema and checked with the shared
 * validator before sending (a Return asks for its reason), then an optional
 * Internal Note that only the viewer's own Company sees, even when the
 * Transition goes to another (visibility.md V5). Opens when mounted; closing it
 * calls `onClose`.
 *
 * On the item's page, what was typed in the item's Form is saved first, and a
 * Draft whose Form isn't complete closes the pop-up with each field to fix
 * marked on the Form. Elsewhere there is no Form to mark: the pop-up says so,
 * and the Draft is finished on its page.
 */
export function TransitionDialog({
  transition,
  calls,
  locale,
  description,
  recommendedCode: recommended,
  idPrefix,
  onClose,
}: {
  transition: TransitionChoice;
  calls: WorkItemCalls;
  locale: Locale;
  /** A line under the heading, e.g. the item's Subject on the Kanban. */
  description?: string;
  /** The Recommended Code the taker's own Company sent with the item (RP-433, RP-86): internal to it, shown with a code's checklist. */
  recommendedCode?: WorkItemActions["recommendedCode"];
  idPrefix: string;
  onClose: () => void;
}) {
  const t = useTranslations("workItems.actions");
  const actionFormLabels = useActionFormLabels();
  const itemForm = useWorkItemForm();
  const dialog = useRef<HTMLDialogElement>(null);
  // Pre-filled from the reply that brought the item here, inside the viewer's own Company (RP-437).
  const [answers, setAnswers] = useState<Record<string, unknown>>(transition.prefill ?? {});
  const [internalNote, setInternalNote] = useState("");
  const [assignTo, setAssignTo] = useState(TO_POOL);
  const [recommendedCode, setRecommendedCode] = useState(NO_RECOMMENDED_CODE);
  // The next Step's Participant (RP-658): none picked until the taker picks one.
  const [participant, setParticipant] = useState("");
  const [participantMissing, setParticipantMissing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const { pending, error, setError } = calls;
  const reply = useReplyFiles(calls.workItemId, transition.actionForm);

  useEffect(() => {
    setError(null);
    dialog.current?.showModal();
    // Opened once, when mounted.
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The API's own checks, before sending.
    const checked = transition.actionForm
      ? validateAnswers(transition.actionForm, answers, "complete", { files: reply.counts })
      : { ok: true as const, answers: {} };
    const unpicked = transition.participants !== undefined && participant === "";
    setParticipantMissing(unpicked);
    if (!checked.ok) {
      setFieldErrors(checked.errors);
      return setError(t("actionFormInvalid"));
    }
    setFieldErrors([]);
    if (unpicked) return setError(t("participantNotPicked"));
    // What was typed in the item's Form goes with it: save it first.
    if (itemForm?.dirty && !(await itemForm.save())) return setError(t("saveFirst"));
    const result = await calls.take(
      transition.key,
      checked.answers,
      internalNote,
      assignTo === TO_POOL ? null : assignTo,
      recommendedCode === NO_RECOMMENDED_CODE ? null : recommendedCode,
      participant === "" ? null : participant,
    );
    if (result === true) return dialog.current?.close();
    // The Action Form's own answers: the pop-up marks each field to fix.
    if (result.code === "invalid_action_form" && result.fields) setFieldErrors(result.fields);
    // Leaving Draft with an incomplete Form: the item's Form marks each field to fix.
    if (result.code === "form_incomplete" && result.fields && itemForm) {
      itemForm.showErrors(result.fields, t("formIncomplete"));
      dialog.current?.close();
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-label={transition.label[locale]}
      className="m-auto w-full max-w-md rounded-md border border-border bg-surface p-6 text-text backdrop:bg-text/40"
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <h2 className="text-h6 font-semibold">{transition.label[locale]}</h2>
        {description && <p className="text-caption text-muted">{description}</p>}
        {transition.checklists && (
          <>
            {/* The Engineer's Recommended Code: the taker's own Company's only (V5). */}
            {recommended && (
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span>{t("recommendedCodeIs", { code: `${recommended.name[locale]} (${recommended.code})` })}</span>
                <Badge>{t("internal")}</Badge>
              </p>
            )}
            {transition.proposed && (
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="brand">{t("proposed")}</Badge>
                <span>{t("proposedCode", { code: transition.label[locale], reason: t(checklistsPropose(transition.checklists) === "C" ? "proposedC" : "proposedA") })}</span>
              </p>
            )}
            <ReplyChecklistsRead workItemId={calls.workItemId} checklists={transition.checklists} locale={locale} />
          </>
        )}
        {transition.participants && (
          <Field
            label={t("participant")}
            help={t("participantHelp")}
            id={`${idPrefix}-participant`}
            required
            {...(participantMissing ? { error: t("participantRequired") } : {})}
          >
            <Select
              value={participant}
              placeholder={t("participantPlaceholder")}
              onValueChange={(value) => {
                setParticipant(value);
                setParticipantMissing(false);
              }}
              options={transition.participants.map((p) => ({ value: p.participantId, label: p.companyName[locale] }))}
            />
          </Field>
        )}
        <ActionForm
          schema={transition.actionForm}
          answers={answers}
          errors={fieldErrors}
          internalNote={internalNote}
          locale={locale}
          labels={actionFormLabels}
          onChange={(changes) => setAnswers((current) => ({ ...current, ...changes }))}
          onInternalNoteChange={setInternalNote}
          idPrefix={idPrefix}
          {...(reply.files ? { files: reply.files } : {})}
        />
        {reply.message && (
          <p role="status" className="text-sm text-muted">
            {reply.message}
          </p>
        )}
        {transition.recommendCode && (
          <Field label={t("recommendCode")} help={t("recommendCodeHelp")} id={`${idPrefix}-recommend-code`}>
            <Select
              value={recommendedCode}
              onValueChange={setRecommendedCode}
              options={[
                { value: NO_RECOMMENDED_CODE, label: t("recommendCodeNone") },
                ...transition.recommendCode.map((o) => ({ value: o.code, label: `${o.name[locale]} (${o.code})` })),
              ]}
            />
          </Field>
        )}
        {transition.assignTo && (
          <Field label={t("assignTo")} help={t("assignToHelp")} id={`${idPrefix}-assign-to`}>
            <Select
              value={assignTo}
              onValueChange={setAssignTo}
              options={[
                { value: TO_POOL, label: t("assignToPool") },
                ...transition.assignTo.map((m) => ({ value: m.memberId, label: m.name[locale] })),
              ]}
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger-fg">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {transition.label[locale]}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
