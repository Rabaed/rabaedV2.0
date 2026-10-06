"use client";

import { backwardKinds, validateAnswers, type FieldError, type Locale, type WorkItemActions as Actions } from "@rabaed/domain";
import { ActionForm, Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { useWorkItemForm } from "@/components/work-item-form";
import { useRouter } from "@/i18n/navigation";

type Transition = Actions["transitions"][number];

/**
 * Exactly the buttons the viewer may press on a Work Item, as the API lists them.
 * Each Transition opens its pop-up first: its Action Form, drawn from the
 * Transition's schema and checked with the shared validator (a Return asks for
 * its reason), then an optional Internal Note that only the viewer's own Company
 * sees, even when the Transition goes to another (visibility.md V5). Each Transition
 * carries an idempotency key, kept until it succeeds, so a double click or a
 * retry moves the item once.
 */
export function WorkItemActions({
  workItemId,
  actions,
  locale,
}: {
  workItemId: string;
  actions: Actions;
  locale: Locale;
}) {
  const t = useTranslations("workItems.actions");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<Transition | null>(null);
  // The pop-up's answers, Internal Note and per-field errors, for the Transition asking.
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [internalNote, setInternalNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const keys = useRef(new Map<string, string>());
  const itemForm = useWorkItemForm();

  const errors: Record<string, string> = {
    not_holder: t("notHolder"),
    already_claimed: t("alreadyClaimed"),
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

  async function send(path: string, body?: unknown): Promise<boolean> {
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
      const { error: code, fields } = (await res.json().catch(() => ({}))) as { error?: string; fields?: FieldError[] };
      // Leaving Draft with an incomplete Form: the Form marks each field to fix.
      if (code === "form_incomplete" && fields) {
        itemForm?.showErrors(fields, t("formIncomplete"));
        dialog.current?.close();
      }
      // The Action Form's own answers: the pop-up marks each field to fix.
      if (code === "invalid_action_form" && fields) setFieldErrors(fields);
      setError(errors[code ?? ""] ?? t("unavailable"));
      // The item moved or went away under us: show what is true now.
      if (res.status === 404 || res.status === 409) router.refresh();
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
    return false;
  }

  async function take(transition: Transition, checkedAnswers: Record<string, unknown>, note: string) {
    // What was typed in the Form goes with it: save it first.
    if (itemForm?.dirty && !(await itemForm.save())) {
      setError(t("saveFirst"));
      return false;
    }
    let idempotencyKey = keys.current.get(transition.key);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      keys.current.set(transition.key, idempotencyKey);
    }
    const done = await send("transitions", { transition: transition.key, answers: checkedAnswers, internalNote: note.trim(), idempotencyKey });
    if (done) keys.current.delete(transition.key);
    return done;
  }

  function press(transition: Transition) {
    // What was written for one Transition never carries over to another.
    setAsking(transition);
    setAnswers({});
    setInternalNote("");
    setFieldErrors([]);
    setError(null);
    dialog.current?.showModal();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!asking) return;
    // The API's own checks, before sending.
    const checked = asking.actionForm ? validateAnswers(asking.actionForm, answers, "complete") : { ok: true as const, answers: {} };
    if (!checked.ok) {
      setFieldErrors(checked.errors);
      return setError(t("actionFormInvalid"));
    }
    setFieldErrors([]);
    if (await take(asking, checked.answers, internalNote)) dialog.current?.close();
  }

  const none = !actions.claim && !actions.release && actions.transitions.length === 0;
  if (none) return null;

  return (
    <section className="space-y-3" aria-label={t("title")}>
      <div className="flex flex-wrap gap-3">
        {actions.transitions.map((tr) => (
          <Button
            key={tr.key}
            variant={backwardKinds.includes(tr.kind) ? "secondary" : "primary"}
            disabled={pending}
            onClick={() => press(tr)}
          >
            {tr.label[locale]}
          </Button>
        ))}
        {actions.claim && (
          <Button disabled={pending} onClick={() => void send("claim")}>
            {t("claim")}
          </Button>
        )}
        {actions.release && (
          <Button variant="ghost" disabled={pending} onClick={() => void send("release")}>
            {t("release")}
          </Button>
        )}
      </div>
      {error && !asking && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <dialog
        ref={dialog}
        onClose={() => setAsking(null)}
        className="m-auto w-full max-w-md rounded-md border border-border bg-surface p-6 text-text backdrop:bg-text/40"
      >
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <h2 className="text-h6 font-semibold">{asking?.label[locale]}</h2>
          {asking && (
            <ActionForm
              key={asking.key}
              schema={asking.actionForm}
              answers={answers}
              errors={fieldErrors}
              internalNote={internalNote}
              locale={locale}
              onChange={(changes) => setAnswers((current) => ({ ...current, ...changes }))}
              onInternalNoteChange={setInternalNote}
              idPrefix="transition"
            />
          )}
          {error && asking && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {asking?.label[locale]}
            </Button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
