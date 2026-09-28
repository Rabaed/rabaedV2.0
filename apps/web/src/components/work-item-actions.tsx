"use client";

import type { Locale, WorkItemActions as Actions } from "@rabaed/domain";
import { Button } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";

type Transition = Actions["transitions"][number];

/**
 * Exactly the buttons the viewer may press on a Work Item, as the API lists them.
 * A Transition that needs a reason (Return) asks for it in a dialog first. Each
 * Transition carries an idempotency key, kept until it succeeds, so a double
 * click or a retry moves the item once.
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
  const dialog = useRef<HTMLDialogElement>(null);
  const keys = useRef(new Map<string, string>());

  const errors: Record<string, string> = {
    not_holder: t("notHolder"),
    already_claimed: t("alreadyClaimed"),
    reason_required: t("reasonRequired"),
    forbidden: t("forbidden"),
    no_step_pool: t("noStepPool"),
    next_step_unavailable: t("nextStepUnavailable"),
    transition_not_available: t("notAvailable"),
    item_closed: t("notAvailable"),
    project_closed: t("projectClosed"),
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
      const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
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

  async function take(transition: Transition, reason = "") {
    let idempotencyKey = keys.current.get(transition.key);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      keys.current.set(transition.key, idempotencyKey);
    }
    const done = await send("transitions", { transition: transition.key, reason, idempotencyKey });
    if (done) keys.current.delete(transition.key);
    return done;
  }

  function press(transition: Transition) {
    if (!transition.needsReason) return void take(transition);
    setAsking(transition);
    setError(null);
    dialog.current?.showModal();
  }

  async function onReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!asking) return;
    const reason = String(new FormData(form).get("reason") ?? "").trim();
    if (!reason) return setError(t("reasonRequired"));
    if (await take(asking, reason)) {
      dialog.current?.close();
      form.reset();
    }
  }

  const none = !actions.claim && !actions.release && actions.transitions.length === 0;
  if (none) return null;

  return (
    <section className="space-y-3" aria-label={t("title")}>
      <div className="flex flex-wrap gap-3">
        {actions.transitions.map((tr) => (
          <Button
            key={tr.key}
            variant={tr.kind === "return" ? "secondary" : "primary"}
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
        <form onSubmit={onReason} className="space-y-4" noValidate>
          <h2 className="text-h6 font-semibold">{asking?.label[locale]}</h2>
          <div className="space-y-2">
            <Label htmlFor="transition-reason">{t("reason")}</Label>
            <textarea
              id="transition-reason"
              name="reason"
              rows={4}
              maxLength={2000}
              required
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm"
            />
            <p className="text-sm text-muted">{t("reasonHelp")}</p>
          </div>
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
