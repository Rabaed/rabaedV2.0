"use client";

import {
  formVisibility,
  offeredChoices,
  validateAnswers,
  type FieldError,
  type FormChoices,
  type FormValue,
  type FormToFill,
  type Locale,
  type OptionList,
  type SupplierChoice,
  type ChecklistTemplateChoice,
} from "@rabaed/domain";
import { Button, Field, FormRenderer, Input, type BuiltInChoices } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { useCreateRefusal } from "@/lib/create-refusal";
import { useFormRendererLabels } from "@/lib/form-labels";
import { linkSearch } from "@/lib/link-search";

/**
 * Creates a Submittal of `typeCode` in Draft, then opens it: its Subject, then its Form (the latest
 * published Version), with Trade, Location and Scopes where the Form places
 * them. Required fields may stay empty in a Draft, except the Trade; the rest
 * are checked when it leaves Draft.
 */
export function CreateWorkItemForm({
  projectId,
  typeCode,
  form,
  choices,
  people,
  optionLists,
  suppliers,
  checklistTemplates,
  locale,
}: {
  projectId: string;
  /** The Type being raised: the Form is its own. */
  typeCode: string;
  form: FormToFill;
  choices: BuiltInChoices;
  /** Who and which Companies its `member` and `participant` fields offer. */
  people: FormChoices;
  /** The Option Lists its `option_list` fields offer. */
  optionLists: readonly OptionList[];
  /** The Project's Approved Supplier List: its `approved_supplier` fields offer the Trade's approved ones. */
  suppliers: readonly SupplierChoice[];
  /** The Project's Checklist Templates: its `checklist_template` fields offer the Trade's active ones (RP-651). */
  checklistTemplates: readonly ChecklistTemplateChoice[];
  locale: Locale;
}) {
  const t = useTranslations("workItems");
  const formLabels = useFormRendererLabels();
  const router = useRouter();
  const refusal = useCreateRefusal();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<readonly FieldError[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function change(changes: Readonly<Record<string, FormValue | undefined>>) {
    const next = { ...answers, ...changes };
    setAnswers(next);
    // Instant feedback with the same checks the server runs (draft mode). A missing
    // Trade is reported when the Draft is saved, not while the Form is being filled.
    const checked = validateAnswers(form.schema, next, "draft", {
      scopes: choices.scopes,
      offered: offeredChoices(people),
      // Lists that didn't load (empty) aren't checked here: the server is the authority.
      optionLists: optionLists.length > 0 ? optionLists : undefined,
      suppliers: suppliers.length > 0 ? suppliers : undefined,
      checklistTemplates: checklistTemplates.length > 0 ? checklistTemplates : undefined,
    });
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
        body: JSON.stringify({
          type: typeCode,
          title: data.get("title"),
          // Hidden fields' answers are cleared on save, here as on the server. Trade and Location are among them.
          answers: formVisibility(form.schema, answers).answers,
        }),
      });
      if (res.status === 201) {
        const { id } = (await res.json()) as { id: string };
        router.push(`/work-items/${id}`);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: FieldError[] };
      if (body.error === "invalid_answers" && body.fields) setFieldErrors(body.fields);
      setError(refusal(body.error));
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
        editableSections={form.editableSections}
        locale={locale}
        labels={formLabels}
        choices={choices}
        people={people}
        optionLists={optionLists}
        suppliers={suppliers}
        checklistTemplates={checklistTemplates}
        onChange={change}
        idPrefix="answer"
        links={{ targets: {}, search: linkSearch(projectId), hrefFor: (choice) => (typeof choice === "string" ? `/work-items/${choice}` : null), linkAs: Link }}
      />
      {error && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {t("saveDraft")}
      </Button>
    </form>
  );
}
