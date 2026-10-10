"use client";

import {
  formFields,
  formVisibility,
  offeredChoices,
  validateAnswers,
  type BilingualText,
  type FieldError,
  type FormChoices,
  type FormSchema,
  type FormValue,
  type Locale,
  type NamedAnswers,
  type DocumentList,
  type FieldTime,
  type SavedAnswers,
  type OptionList,
} from "@rabaed/domain";
import { Button, FormRenderer, SaveStatus, type BuiltInChoices, type LinkTargetNames } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { useFormRendererLabels } from "@/lib/form-labels";
import { linkSearch } from "@/lib/link-search";
import { saveButton } from "@/lib/save-button";
import { useDocuments, useImageUrls } from "./use-documents";

// A Work Item's Form on its page: the answers being edited, their errors, and
// Save draft. The Transition buttons share it, so leaving Draft first saves what
// was typed, and a refusal for an incomplete Form marks the fields it lists.

type FieldTimes = Readonly<Record<string, FieldTime>>;

/** The times a save is based on: each field's `at`. */
const basedOnOf = (times: FieldTimes): Record<string, string> => Object.fromEntries(Object.entries(times).map(([k, v]) => [k, v.at]));

/** When the answers last changed: the latest field time, or null when none has one. */
const latestTime = (times: FieldTimes): string | null =>
  Object.values(times).reduce<string | null>((latest, v) => (latest === null || v.at > latest ? v.at : latest), null);

type WorkItemFormState = {
  schema: FormSchema;
  /** What the Built-in Fields offer, or name in the read view. */
  choices: BuiltInChoices;
  answers: Record<string, unknown>;
  /** Its `member` and `participant` answers as the API named them for the viewer (V14). */
  named: NamedAnswers;
  /** Who and which Companies those fields offer the viewer (V15). */
  people: FormChoices;
  /** The Option Lists its `option_list` fields offer and read from. */
  optionLists: readonly OptionList[];
  /** Its Project, which a link question's Link search searches. */
  projectId: string;
  /** The item's Document Number; none while it is a Draft (a Revision Draft included). */
  documentNumber: string | null;
  /** The number and Subject of each item its link questions chose that the viewer sees. */
  linkTargets: LinkTargetNames;
  /** Where each chosen item the viewer can't see opens, by its Document Number: its Link's page (RP-521). */
  hiddenLinks: Readonly<Record<string, string>>;
  errors: readonly FieldError[];
  editable: boolean;
  /** The Form Sections the viewer may change now; the others read (form-engine.md §4). */
  editableSections: readonly string[];
  /** The Form Sections another Participant fills, by its Project Role. */
  filledBy: Readonly<Record<string, BilingualText>>;
  /** Typed since the last save. */
  dirty: boolean;
  /** When the item was last saved, if this page saved it or knows (ISO). */
  savedAt: string | null;
  /** Fields another Member changed that the last save kept as theirs, by field key, with their name. */
  changedByOthers: Readonly<Record<string, string>>;
  pending: boolean;
  message: string | null;
  change(changes: Readonly<Record<string, FormValue | undefined>>): void;
  /** Saves the answers if they changed; false when the save was refused. */
  save(auto?: boolean): Promise<boolean>;
  /** Shows the API's per-field errors on the Form. */
  showErrors(errors: readonly FieldError[], message: string): void;
};

/** How long after the last change a Draft saves itself. */
const AUTOSAVE_MS = 3000;

const WorkItemFormContext = createContext<WorkItemFormState | null>(null);

/** The item's Form, if its page has one. */
export function useWorkItemForm(): WorkItemFormState | null {
  return useContext(WorkItemFormContext);
}

export function WorkItemFormProvider({
  workItemId,
  projectId,
  documentNumber,
  linkTargets,
  hiddenLinks,
  schema,
  choices,
  answers: saved,
  named,
  people,
  optionLists,
  editable,
  editableSections,
  filledBy,
  fieldTimes,
  autosave,
  children,
}: {
  workItemId: string;
  projectId: string;
  documentNumber: string | null;
  linkTargets: LinkTargetNames;
  hiddenLinks: Readonly<Record<string, string>>;
  schema: FormSchema;
  choices: BuiltInChoices;
  answers: Record<string, unknown>;
  named: NamedAnswers;
  people: FormChoices;
  optionLists: readonly OptionList[];
  /** Save draft is offered (actions.saveAnswers). */
  editable: boolean;
  editableSections: readonly string[];
  filledBy: Readonly<Record<string, BilingualText>>;
  /** When each answer last changed (detail.fieldTimes); a save is based on these. */
  fieldTimes: FieldTimes;
  /** The first Draft: answers save themselves every few seconds. After it only the button saves. */
  autosave: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("workItems.form");
  const tItems = useTranslations("workItems");
  const router = useRouter();
  const [answers, setAnswers] = useState(saved);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const locale = useLocale() as Locale;
  // The times the next save is based on: what the page loaded with, then what each save answered.
  const based = useRef<Record<string, string>>(basedOnOf(fieldTimes));
  const [savedAt, setSavedAt] = useState<string | null>(latestTime(fieldTimes));
  const [changedByOthers, setChangedByOthers] = useState<Record<string, string>>({});

  function change(changes: Readonly<Record<string, FormValue | undefined>>) {
    const next = { ...answers, ...changes };
    setAnswers(next);
    setDirty(true);
    setMessage(null);
    if (Object.keys(changes).some((key) => key in changedByOthers)) {
      setChangedByOthers(Object.fromEntries(Object.entries(changedByOthers).filter(([key]) => !(key in changes))));
    }
    // Instant feedback with the same checks the server runs (draft mode: types, and the Trade).
    const checked = validateAnswers(schema, next, "draft", {
      scopes: choices.scopes,
      offered: offeredChoices(people, schema, saved),
      // A retired option the saved answers hold stays valid; choosing it anew is refused. Lists that
      // didn't load (empty) aren't checked here: the server is the authority.
      optionLists: optionLists.length > 0 ? optionLists : undefined,
      held: saved,
    });
    setErrors(checked.ok ? [] : checked.errors);
  }

  /** `auto`: a quiet save that nobody pressed, in Draft: no page refresh, no "Draft saved". */
  async function save(auto = false): Promise<boolean> {
    if (!dirty) return true;
    setPending(true);
    if (!auto) setMessage(null);
    const shownAnswers = formVisibility(schema, answers).answers;
    try {
      const res = await fetch(`/api/v1/work-items/${workItemId}/answers`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        // Hidden fields' answers are cleared on save, here as on the server.
        body: JSON.stringify({ answers: shownAnswers, basedOn: based.current }),
      });
      if (res.ok) {
        const saved = (await res.json()) as SavedAnswers;
        based.current = basedOnOf(saved.fieldTimes);
        setSavedAt(latestTime(saved.fieldTimes));
        // A field another Member changed since is kept as theirs: show their value and who.
        const theirs = Object.fromEntries(saved.keptFromOthers.map((k) => [k.field, k.value]));
        // Typed while this save was out stays as typed, and stays unsaved.
        const sent = answers;
        const typedMeanwhile = answersRef.current !== sent;
        setAnswers((cur) => {
          const merged = { ...(cur === sent ? shownAnswers : cur), ...theirs };
          for (const k of saved.keptFromOthers) if (k.value === null) delete merged[k.field];
          return merged;
        });
        setChangedByOthers(
          Object.fromEntries(saved.keptFromOthers.map((k) => [k.field, k.memberName?.[locale] ?? t("anotherMember")])),
        );
        // Typed while this save was out? Then it is still unsaved; the next save carries it.
        setDirty(typedMeanwhile);
        setErrors([]);
        setMessage(auto ? null : t("saved"));
        if (!auto) router.refresh();
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

  // Autosave: a few seconds after the last change, in the first Draft only.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!autosave || !editable || !dirty || pending) return;
    const timer = setTimeout(() => void saveRef.current(true), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [autosave, editable, dirty, pending, answers]);

  function showErrors(next: readonly FieldError[], text: string) {
    setErrors(next);
    setMessage(text);
  }

  return (
    <WorkItemFormContext.Provider
      value={{
        schema,
        choices,
        people,
        optionLists,
        projectId,
        documentNumber,
        linkTargets,
        hiddenLinks,
        answers,
        named,
        errors,
        editable,
        editableSections,
        filledBy,
        dirty,
        savedAt,
        changedByOthers,
        pending,
        message,
        change,
        save,
        showErrors,
      }}
    >
      {children}
    </WorkItemFormContext.Provider>
  );
}

/** The Form itself: to fill in while the viewer may edit it, otherwise to read. */
export function WorkItemAnswers({ locale, workItemId, documents }: { locale: Locale; workItemId: string; documents: DocumentList }) {
  const t = useTranslations("workItems.form");
  const formLabels = useFormRendererLabels();
  const form = useWorkItemForm();
  // The Form's `attachments`, `photos` and `checklist` fields upload as the Attachments System Field does (RP-281, RP-284, RP-285).
  const files = useDocuments(workItemId, documents.limits);
  const photoKeys = new Set(form ? formFields(form.schema).flatMap((f) => (f.type === "photos" || f.type === "checklist" ? [f.key] : [])) : []);
  const imageUrls = useImageUrls(
    workItemId,
    documents.documents.filter((d) => d.fieldKey !== null && photoKeys.has(d.fieldKey)),
  );
  const router = useRouter();
  if (!form) return null;
  const button = saveButton({ documentNumber: form.documentNumber, dirty: form.dirty, pending: form.pending });
  /** Saves anything pending (quietly: the page is left), then goes to the Project's Submittals list. A refused save stays. */
  async function saveAndClose() {
    if (form && (await form.save(true))) router.push(`/projects/${form.projectId}/work-items`);
  }
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
        optionLists={form.optionLists}
        errors={form.errors}
        mode={form.editable ? "edit" : "read"}
        editableSections={form.editableSections}
        filledBy={form.filledBy}
        locale={locale}
        labels={formLabels}
        onChange={form.change}
        idPrefix="answer"
        links={{
          targets: form.linkTargets,
          search: linkSearch(form.projectId),
          hrefFor: (choice) => (typeof choice === "string" ? `/work-items/${choice}` : (form.hiddenLinks[choice.documentNumber] ?? null)),
          linkAs: Link,
          workItemId,
        }}
        files={{
          documents: documents.documents,
          canChange: documents.canChange,
          pending: files.pending,
          imageUrls,
          onUpload: (fieldKey, picked, itemKey) => void files.upload(picked, fieldKey, itemKey),
          onOpen: (documentId) => void files.open(documentId),
          onRemove: (fieldKey, documentId, itemKey) => void files.remove(documentId, fieldKey, itemKey),
        }}
      />
      {form.message && (
        <p role="status" className="text-sm text-muted">
          {form.message}
        </p>
      )}
      <SaveStatus
        locale={locale}
        savedAt={form.editable ? form.savedAt : null}
        changedByOthers={Object.entries(form.changedByOthers).flatMap(([key, memberName]) => {
          const field = formFields(form.schema).find((f) => f.key === key);
          return [{ fieldLabel: field && "label" in field ? field.label[locale] : key, memberName }];
        })}
      />
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
        <div className="flex justify-end border-t border-border pt-4">
          <Button
            variant={button.closes ? "primary" : "secondary"}
            disabled={button.disabled}
            onClick={() => void (button.closes ? saveAndClose() : form.save(false))}
          >
            {t(button.label)}
          </Button>
        </div>
      )}
    </section>
  );
}
