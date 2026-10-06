"use client";

import { validateAnswers, type FieldError, type Locale, type WorkItemMove, type WorkItemRow } from "@rabaed/domain";
import { ActionForm, Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * The Action Form of the Transition a Kanban card was dropped on, or chosen
 * from its Move menu (RP-350): the same pop-up the item's page opens, then the
 * same take-Transition call with an idempotency key kept until it succeeds, so
 * a double click or a retry moves the item once. The card moves after the
 * refresh. Every refusal is the page's one answer (the "Refusals of a
 * Transition" channel): the form never says why a move can't be made.
 */
export function WorkItemBoardMove({
  card,
  move,
  locale,
  onClose,
}: {
  card: WorkItemRow;
  move: WorkItemMove;
  locale: Locale;
  onClose: () => void;
}) {
  const t = useTranslations("workItems.actions");
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [internalNote, setInternalNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const errors: Record<string, string> = {
    not_holder: t("notHolder"),
    invalid_action_form: t("actionFormInvalid"),
    forbidden: t("forbidden"),
    no_step_pool: t("noStepPool"),
    next_step_unavailable: t("nextStepUnavailable"),
    transition_not_available: t("notAvailable"),
    item_closed: t("notAvailable"),
    project_closed: t("projectClosed"),
    form_incomplete: t("formIncomplete"),
    form_not_checked: t("tryAgain"),
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The API's own checks, before sending.
    const checked = move.actionForm ? validateAnswers(move.actionForm, answers, "complete") : { ok: true as const, answers: {} };
    if (!checked.ok) {
      setFieldErrors(checked.errors);
      return setError(t("actionFormInvalid"));
    }
    setFieldErrors([]);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/work-items/${card.id}/transitions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transition: move.transition, answers: checked.answers, internalNote: internalNote.trim(), idempotencyKey: idempotencyKey.current }),
      });
      if (res.ok) {
        router.refresh();
        return dialog.current?.close();
      }
      const { error: code, fields } = (await res.json().catch(() => ({}))) as { error?: string; fields?: FieldError[] };
      if (code === "invalid_action_form" && fields) setFieldErrors(fields);
      // A Draft whose Form isn't complete is finished on its page, where the Form marks each field.
      setError(errors[code ?? ""] ?? t("unavailable"));
      // The item moved or went away under us: show what is true now.
      if (res.status === 404 || res.status === 409) router.refresh();
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-label={move.label[locale]}
      className="m-auto w-full max-w-md rounded-md border border-border bg-surface p-6 text-text backdrop:bg-text/40"
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <h2 className="text-h6 font-semibold">{move.label[locale]}</h2>
        <p className="text-caption text-muted">{card.title}</p>
        <ActionForm
          schema={move.actionForm}
          answers={answers}
          errors={fieldErrors}
          internalNote={internalNote}
          locale={locale}
          onChange={(changes) => setAnswers((current) => ({ ...current, ...changes }))}
          onInternalNoteChange={setInternalNote}
          idPrefix="board-transition"
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {move.label[locale]}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
