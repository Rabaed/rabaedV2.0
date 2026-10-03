"use client";

import { validateAnswers, type FieldError, type FormValue, type FormVersion, type Locale } from "@rabaed/domain";
import { Button, Field, FormRenderer, Input, type BuiltInChoices } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * Creates a MAR in Draft, then opens it: its Subject, then its Form (the latest
 * published Version), with Trade, Location and Scopes where the Form places
 * them. Required fields may stay empty in a Draft, except the Trade; the rest
 * are checked when it leaves Draft.
 */
export function CreateWorkItemForm({
  projectId,
  form,
  choices,
  locale,
}: {
  projectId: string;
  form: FormVersion;
  choices: BuiltInChoices;
  locale: Locale;
}) {
  const t = useTranslations("workItems");
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<readonly FieldError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function change(changes: Readonly<Record<string, FormValue | undefined>>) {
    const next = { ...answers, ...changes };
    setAnswers(next);
    // Instant feedback with the same checks the server runs (draft mode). A missing
    // Trade is reported when the Draft is saved, not while the Form is being filled.
    const checked = validateAnswers(form.schema, next, "draft", { scopes: choices.scopes });
    setFieldErrors(checked.ok ? [] : checked.errors.filter((e) => e.code !== "required"));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/work-items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "MAR", title: data.get("title"), answers }),
      });
      if (res.status === 201) {
        const { id } = (await res.json()) as { id: string };
        router.push(`/work-items/${id}`);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: FieldError[] };
      if (body.error === "invalid_answers" && body.fields) setFieldErrors(body.fields);
      const errors: Record<string, string> = {
        invalid_request: t("invalid"),
        invalid_answers: t("form.invalid"),
        forbidden: t("notContractor"),
        outside_visibility: t("outsideVisibility"),
        // A Trade, Location or Scope removed meanwhile.
        value_not_found: t("form.valueNotFound"),
        project_closed: t("projectClosed"),
        form_version_not_latest: t("form.newVersion"),
      };
      setError(errors[body.error ?? ""] ?? t("unavailable"));
      // A newer Form Version, or other choices, arrived meanwhile: show them.
      if (body.error === "form_version_not_latest" || body.error === "value_not_found") router.refresh();
    } catch {
      setError(t("unavailable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <Field label={t("fields.subject")} id="title" required>
        <Input name="title" maxLength={200} dir="auto" />
      </Field>
      <FormRenderer
        schema={form.schema}
        answers={answers}
        errors={fieldErrors}
        mode="edit"
        locale={locale}
        choices={choices}
        onChange={change}
        idPrefix="answer"
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {t("saveDraft")}
      </Button>
    </form>
  );
}
