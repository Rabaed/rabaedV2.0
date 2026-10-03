"use client";

import {
  formVisibility,
  offeredChoices,
  validateAnswers,
  type FieldError,
  type FormChoices,
  type FormSchema,
  type FormValue,
  type Locale,
  type NamedAnswers,
  type DocumentList,
} from "@rabaed/domain";
import { Button, FormRenderer, type BuiltInChoices } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "@/i18n/navigation";
import { useDocuments } from "./use-documents";

// A Work Item's Form on its page: the answers being edited, their errors, and
// Save draft. The Transition buttons share it, so leaving Draft first saves what
// was typed, and a refusal for an incomplete Form marks the fields it lists.

type WorkItemFormState = {
  schema: FormSchema;
  /** What the Built-in Fields offer, or name in the read view. */
  choices: BuiltInChoices;
  answers: Record<string, unknown>;
  /** Its `member` and `participant` answers as the API named them for the viewer (V14). */
  named: NamedAnswers;
  /** Who and which Companies those fields offer the viewer (V15). */
  people: FormChoices;
  errors: readonly FieldError[];
  editable: boolean;
  /** Typed since the last save. */
  dirty: boolean;
  pending: boolean;
  message: string | null;
  change(changes: Readonly<Record<string, FormValue | undefined>>): void;
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
  choices,
  answers: saved,
  named,
  people,
  editable,
  children,
}: {
  workItemId: string;
  schema: FormSchema;
  choices: BuiltInChoices;
  answers: Record<string, unknown>;
  named: NamedAnswers;
  people: FormChoices;
  /** Save draft is offered (actions.saveAnswers). */
  editable: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("workItems.form");
  const tItems = useTranslations("workItems");
  const router = useRouter();
  const [answers, setAnswers] = useState(saved);
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function change(changes: Readonly<Record<string, FormValue | undefined>>) {
    const next = { ...answers, ...changes };
    setAnswers(next);
    setDirty(true);
    setMessage(null);
    // Instant feedback with the same checks the server runs (draft mode: types, and the Trade).
    const checked = validateAnswers(schema, next, "draft", {
      scopes: choices.scopes,
      offered: offeredChoices(people, schema, saved),
    });
    setErrors(checked.ok ? [] : checked.errors);
  }

  async function save(): Promise<boolean> {
    if (!dirty) return true;
    setPending(true);
    setMessage(null);
    const shownAnswers = formVisibility(schema, answers).answers;
    try {
      const res = await fetch(`/api/v1/work-items/${workItemId}/answers`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        // Hidden fields' answers are cleared on save, here as on the server.
        body: JSON.stringify({ answers: shownAnswers }),
      });
      if (res.ok) {
        setAnswers(shownAnswers);
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
        const messages: Record<string, string> = {
          not_editable: t("notEditable"),
          outside_visibility: tItems("outsideVisibility"),
          value_not_found: t("valueNotFound"),
        };
        setMessage(messages[body.error ?? ""] ?? t("unavailable"));
        if (res.status === 404 || res.status === 409 || body.error === "value_not_found") router.refresh();
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
      value={{ schema, choices, people, answers, named, errors, editable, dirty, pending, message, change, save, showErrors }}
    >
      {children}
    </WorkItemFormContext.Provider>
  );
}

/** The Form itself: to fill in while the viewer may edit it, otherwise to read. */
export function WorkItemAnswers({ locale, workItemId, documents }: { locale: Locale; workItemId: string; documents: DocumentList }) {
  const t = useTranslations("workItems.form");
  const tItems = useTranslations("workItems");
  const form = useWorkItemForm();
  // The Form's `attachments` fields upload as the Attachments System Field does (RP-281).
  const files = useDocuments(workItemId, documents.limits);
  if (!form) return null;
  // The fields the last check marked, by their labels in the viewer's language, in Form order.
  const marked = new Set(form.errors.map((e) => e.key));
  const toFix = form.schema.sections.flatMap((section) =>
    section.fields.flatMap((field) => (marked.has(field.key) && "label" in field ? [field.label[locale]] : [])),
  );
  return (
    <section className="space-y-4" aria-label={t("title")}>
      <FormRenderer
        schema={form.schema}
        choices={form.choices}
        answers={form.answers}
        named={form.named}
        people={form.people}
        errors={form.errors}
        mode={form.editable ? "edit" : "read"}
        locale={locale}
        onChange={form.change}
        idPrefix="answer"
        files={{
          documents: documents.documents,
          canChange: documents.canChange,
          pending: files.fieldsPending,
          onUpload: (fieldKey, file) => void files.upload(file, fieldKey),
          onOpen: (documentId) => void files.open(documentId),
          onRemove: (fieldKey, documentId) => void files.remove(documentId, fieldKey),
        }}
      />
      {form.message && (
        <p role="status" className="text-sm text-muted">
          {form.message}
        </p>
      )}
      {files.message && (
        <p role="status" className="text-sm text-muted">
          {files.message}
        </p>
      )}
      {toFix.length > 0 && (
        <div role="alert" className="text-sm">
          <p className="font-medium">{t("toFix")}</p>
          <ul className="list-disc ps-6">
            {toFix.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      )}
      {form.editable && (
        <Button variant="secondary" disabled={form.pending || !form.dirty} onClick={() => void form.save()}>
          {tItems("saveDraft")}
        </Button>
      )}
    </section>
  );
}
