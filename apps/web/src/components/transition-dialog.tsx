"use client";

import { validateAnswers, type BilingualText, type FieldError, type FormSchema, type Locale } from "@rabaed/domain";
import { ActionForm, Button } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useWorkItemForm } from "@/components/work-item-form";
import { useRouter } from "@/i18n/navigation";
import { useActionFormLabels } from "@/lib/form-labels";

/** A Transition as the pop-up needs it: the item's page and the Kanban's moves both have one. */
export type TransitionChoice = { key: string; label: BilingualText; actionForm: FormSchema | null };

/** Why a call was refused, as the API said: its code and, for a Form, the fields to fix. */
type Refusal = { code: string | undefined; fields?: FieldError[] };

/**
 * Claim, release and take-Transition calls on one Work Item, the same on its
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
    already_claimed: t("alreadyClaimed"),
    invalid_action_form: t("actionFormInvalid"),
    forbidden: t("forbidden"),
    no_step_pool: t("noStepPool"),
    next_step_unavailable: t("nextStepUnavailable"),
    no_route: t("noRoute"),
    transition_not_available: t("notAvailable"),
    item_closed: t("notAvailable"),
    project_closed: t("projectClosed"),
    form_incomplete: t("formIncomplete"),
    form_not_checked: t("tryAgain"),
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

  /** Takes `transition` with its checked answers and Internal Note. */
  async function take(transition: string, answers: Record<string, unknown>, internalNote: string): Promise<true | Refusal> {
    let idempotencyKey = keys.current.get(transition);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      keys.current.set(transition, idempotencyKey);
    }
    const result = await send("transitions", { transition, answers, internalNote: internalNote.trim(), idempotencyKey });
    if (result === true) keys.current.delete(transition);
    return result;
  }

  return { pending, error, setError, send, take };
}

export type WorkItemCalls = ReturnType<typeof useWorkItemCalls>;

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
  idPrefix,
  onClose,
}: {
  transition: TransitionChoice;
  calls: WorkItemCalls;
  locale: Locale;
  /** A line under the heading, e.g. the item's Subject on the Kanban. */
  description?: string;
  idPrefix: string;
  onClose: () => void;
}) {
  const t = useTranslations("workItems.actions");
  const actionFormLabels = useActionFormLabels();
  const itemForm = useWorkItemForm();
  const dialog = useRef<HTMLDialogElement>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [internalNote, setInternalNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const { pending, error, setError } = calls;

  useEffect(() => {
    setError(null);
    dialog.current?.showModal();
    // Opened once, when mounted.
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The API's own checks, before sending.
    const checked = transition.actionForm ? validateAnswers(transition.actionForm, answers, "complete") : { ok: true as const, answers: {} };
    if (!checked.ok) {
      setFieldErrors(checked.errors);
      return setError(t("actionFormInvalid"));
    }
    setFieldErrors([]);
    // What was typed in the item's Form goes with it: save it first.
    if (itemForm?.dirty && !(await itemForm.save())) return setError(t("saveFirst"));
    const result = await calls.take(transition.key, checked.answers, internalNote);
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
            {transition.label[locale]}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
