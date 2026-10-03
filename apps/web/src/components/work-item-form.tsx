"use client";

import { validateAnswers, type FieldError, type FormSchema, type Locale } from "@rabaed/domain";
import { Button, FormRenderer } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "@/i18n/navigation";

// A Work Item's Form on its page: the answers being edited, their errors, and
// Save draft. The Transition buttons share it, so leaving Draft first saves what
// was typed, and a refusal for an incomplete Form marks the fields it lists.

type WorkItemFormState = {
  schema: FormSchema;
  answers: Record<string, unknown>;
  errors: readonly FieldError[];
  editable: boolean;
  /** Typed since the last save. */
  dirty: boolean;
  pending: boolean;
  message: string | null;
  change(key: string, value: string): void;
  /** Saves the answers if they changed; false when the save was refused. */
  save(): Promise<boolean>;
  /** Shows the API's per-field errors on the Form. */
  showErrors(errors: readonly FieldError[], message: string): void;
};

const WorkItemFormContext = createContext<WorkItemFormState | null>(null);

/** The item's Form, if its page has one. */
export function useWorkItemForm(): WorkItemFormState | null {
  return useContext(WorkItemFormContext);
}

export function WorkItemFormProvider({
  workItemId,
  schema,
  answers: saved,
  editable,
  children,
}: {
  workItemId: string;
  schema: FormSchema;
  answers: Record<string, unknown>;
  /** Save draft is offered (actions.saveAnswers). */
  editable: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("workItems.form");
  const router = useRouter();
  const [answers, setAnswers] = useState(saved);
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function change(key: string, value: string) {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    setDirty(true);
    setMessage(null);
    // Instant feedback with the same checks the server runs (draft mode: types only).
    const checked = validateAnswers(schema, next, "draft");
    setErrors(checked.ok ? [] : checked.errors);
  }

  async function save(): Promise<boolean> {
    if (!dirty) return true;
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/work-items/${workItemId}/answers`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (res.ok) {
        setDirty(false);
        setErrors([]);
        setMessage(t("saved"));
        router.refresh();
        return true;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: FieldError[] };
      if (body.error === "invalid_answers" && body.fields) {
        setErrors(body.fields);
        setMessage(t("invalid"));
      } else {
        setMessage(body.error === "not_editable" ? t("notEditable") : t("unavailable"));
        if (res.status === 404 || res.status === 409) router.refresh();
      }
    } catch {
      setMessage(t("unavailable"));
    } finally {
      setPending(false);
    }
    return false;
  }

  function showErrors(next: readonly FieldError[], text: string) {
    setErrors(next);
    setMessage(text);
  }

  return (
    <WorkItemFormContext.Provider
      value={{ schema, answers, errors, editable, dirty, pending, message, change, save, showErrors }}
    >
      {children}
    </WorkItemFormContext.Provider>
  );
}

/** The Form itself: to fill in while the viewer may edit it, otherwise to read. */
export function WorkItemAnswers({ locale }: { locale: Locale }) {
  const t = useTranslations("workItems.form");
  const tItems = useTranslations("workItems");
  const form = useWorkItemForm();
  if (!form) return null;
  return (
    <section className="space-y-4" aria-label={t("title")}>
      <FormRenderer
        schema={form.schema}
        answers={form.answers}
        errors={form.errors}
        mode={form.editable ? "edit" : "read"}
        locale={locale}
        onChange={form.change}
        idPrefix="answer"
      />
      {form.message && (
        <p role="status" className="text-sm text-muted">
          {form.message}
        </p>
      )}
      {form.editable && (
        <Button variant="secondary" disabled={form.pending || !form.dirty} onClick={() => void form.save()}>
          {tItems("saveDraft")}
        </Button>
      )}
    </section>
  );
}
