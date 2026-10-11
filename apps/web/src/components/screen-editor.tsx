"use client";

import {
  formatNumber,
  itemsToCreate,
  itemsToCreateKey,
  type BilingualText,
  type FormField,
  type FormSchema,
  type Locale,
  type Outcome,
  type ScreenPins,
  type ScreenProblem,
  type ScreenRead,
} from "@rabaed/domain";
import { Badge, Button, Field, Icon, IconButton, Input, Popover, PopoverContent, PopoverTrigger, SegmentedControl, SettingsSection, Switch, Select } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { addField, changeField, fieldKinds, hasNamed, moveField, newField, removeField, startingSchema, withInternal, type FieldKind } from "@/lib/screen-editor";
import { refusalMessage, setupCall } from "@/lib/setup-call";

type Props = {
  projectId: string;
  screen: ScreenRead;
  pins: ScreenPins["pins"];
  /** The words a new field starts with, in each language whichever the author reads: a field is labelled in both. */
  words: Record<"en" | "ar", { section: string; field: string; option: string; column: string; kinds: Record<FieldKind, string> }>;
  /** The outcomes of the Project's Types that turn the "items to create" table's rows into items, each with the Type it creates. */
  itemsOutcomes: ItemsOutcome[];
  /** The Work Item Types the rows may become, by code and name in the viewer's language. */
  typeChoices: { code: string; name: string }[];
};

/** An outcome of Type `typeCode`'s set on the Project whose follow-up action creates items from the table's rows. */
export type ItemsOutcome = { typeCode: string; typeName: string; outcome: Outcome };

const fieldTypeLabelKey: Record<string, string> = {
  text: "text",
  textarea: "textarea",
  select: "select",
  multi_select: "select",
  date: "date",
  number: "number",
  checklist: "checklist",
  table: "table",
  yes_no: "yesNo",
};

/**
 * Project → Settings → Screens → one Screen (RP-441; ADR 0019, "the editor that used to be
 * RP-439's Action Form editor"): an ordered list of fields, each shared or internal to the
 * acting Participant and required or not; Save draft keeps the next Version, Publish makes
 * it the Version Workflow Versions pin from then on. Anyone else on the Project reads the
 * published Version (V20). The server's checks decide what may be published.
 */
export function ScreenEditor({ projectId, screen, pins, words, itemsOutcomes, typeChoices }: Props) {
  const t = useTranslations("projectSettings.screens");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const source = screen.draft ?? screen.published;
  const [schema, setSchema] = useState<FormSchema>(() => startingSchema(source?.schema, { section: { en: words.en.section, ar: words.ar.section }, field: { en: words.en.field, ar: words.ar.field } }));
  const [internal, setInternal] = useState<string[]>(source?.internalFields ?? []);
  const [state, setState] = useState<"clean" | "dirty" | "saving">(screen.draft ? "clean" : "clean");
  const [problems, setProblems] = useState<ScreenProblem[]>([]);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const editable = screen.canAuthor;
  const nextNo = (screen.publishedVersions.at(-1) ?? 0) + 1;
  const bothWords = (pick: (w: Props["words"]["en"]) => string): BilingualText => ({ en: pick(words.en), ar: pick(words.ar) });

  const edit = (next: FormSchema, nextInternal: string[] = internal) => {
    setSchema(next);
    setInternal(nextInternal);
    setState("dirty");
    setNotice(null);
  };

  const refusal = (error: string) =>
    refusalMessage(t, { no_draft: "noDraft", invalid_screen: "invalid", screen_problems: "problems" }, error);

  async function save(): Promise<boolean> {
    setState("saving");
    const res = await setupCall("PUT", `/screens/${screen.id}/draft`, { schema, internalFields: internal });
    setState(res.ok ? "clean" : "dirty");
    if (!res.ok) {
      setNotice({ tone: "error", text: refusal(res.error) });
      return false;
    }
    return true;
  }

  async function publish() {
    if (state !== "clean" && !(await save())) return;
    setState("saving");
    const res = await setupCall("POST", `/screens/${screen.id}/publish`);
    setState("clean");
    if (res.ok) {
      setProblems([]);
      setNotice({ tone: "ok", text: t("published", { n: formatNumber(nextNo, locale) }) });
      router.refresh();
      return;
    }
    const body = res.body as { problems?: ScreenProblem[] } | null;
    setProblems(body?.problems ?? []);
    setNotice({ tone: "error", text: refusal(res.error) });
  }

  const labelOf = (key: string) => {
    const field = schema.sections.flatMap((s) => s.fields).find((f) => f.key === key);
    return field && "label" in field ? field.label[locale] : key;
  };
  const pinsOf = (n: number) => pins.filter((p) => p.screenVersionNo === n);

  return (
    <>
      <SettingsSection
        title={t("versionsTitle")}
        description={t("versionsIntro")}
        data-testid="screen-versions"
      >
        <ul className="flex flex-col gap-2.5">
          {screen.publishedVersions.length === 0 && <li className="text-sm text-muted">{t("noPublished")}</li>}
          {[...screen.publishedVersions].reverse().map((n) => (
            <li key={n} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <Badge tone="success">{t("version", { n: formatNumber(n, locale) })}</Badge>
              {pinsOf(n).length === 0 ? (
                <span className="text-muted">{t("pinnedByNone")}</span>
              ) : (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-muted">{t("pinnedBy")}</span>
                  {pinsOf(n).map((p) => (
                    <Link
                      key={`${p.workflowId}-${p.workflowVersionNo}`}
                      href={`/projects/${projectId}/settings/workflows/${p.workflowId}/versions/${p.workflowVersionNo}`}
                      className="font-semibold text-brand-fg hover:underline"
                    >
                      {t("workflowVersion", { name: p.workflowName[locale], n: formatNumber(p.workflowVersionNo, locale) })}
                    </Link>
                  ))}
                </span>
              )}
            </li>
          ))}
          {editable && (
            <li className="flex items-center gap-3 text-sm">
              <Badge tone="warning">{t("draftVersion", { n: formatNumber(nextNo, locale) })}</Badge>
              <span className="text-muted">{state === "dirty" ? t("unsaved") : screen.draft ? t("draftSaved") : t("noDraftYet")}</span>
            </li>
          )}
        </ul>
      </SettingsSection>

      <SettingsSection
        title={t("fieldsTitle")}
        description={editable ? t("fieldsIntro") : t("fieldsReadOnly", { n: formatNumber(screen.published?.versionNo ?? 0, locale) })}
        actions={
          editable ? (
            <>
              <Button variant="secondary" size="sm" disabled={state !== "dirty"} onClick={() => void save()}>
                {t("saveDraft")}
              </Button>
              <Button size="sm" disabled={state === "saving" || (state === "clean" && !screen.draft)} onClick={() => void publish()}>
                {t("publish", { n: formatNumber(nextNo, locale) })}
              </Button>
            </>
          ) : undefined
        }
        data-testid="screen-fields"
      >
        {notice && (
          <p role={notice.tone === "error" ? "alert" : "status"} className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${notice.tone === "error" ? "bg-danger-tint text-danger-fg" : "bg-success-tint text-success-fg"}`}>
            <Icon name={notice.tone === "error" ? "alert-circle" : "circle-check"} size={16} />
            {notice.text}
          </p>
        )}
        {problems.length > 0 && (
          <ul className="list-disc ps-9 text-sm text-danger-fg" aria-label={t("problemsTitle")}>
            {problems.map((p, i) => (
              <li key={`${p.key}-${p.code}-${i}`}>{t("problem", { field: labelOf(p.key), code: t(`problemCodes.${p.code}` as never) })}</li>
            ))}
          </ul>
        )}

        {schema.sections.map((section) => (
          <div key={section.key} className="flex flex-col gap-3">
            <h3 className="text-sm font-bold text-text">{section.title[locale]}</h3>
            <ol className="flex flex-col gap-3" aria-label={t("fieldsOf", { section: section.title[locale] })}>
              {section.fields.map((field, index) => (
                <li key={field.key}>
                  <FieldCard
                    field={field}
                    first={index === 0}
                    last={index === section.fields.length - 1}
                    editable={editable}
                    internal={internal.includes(field.key)}
                    itemsTarget={<ItemsTargetPicker projectId={projectId} editable={editable} itemsOutcomes={itemsOutcomes} typeChoices={typeChoices} t={t} />}
                    onChange={(change) => edit(changeField(schema, field.key, change))}
                    onInternal={(isInternal) => edit(schema, withInternal(schema, internal, field.key, isInternal))}
                    onMove={(delta) => edit(moveField(schema, field.key, delta))}
                    onRemove={() => edit(removeField(schema, field.key), withInternal(removeField(schema, field.key), internal, field.key, false))}
                    t={t}
                    locale={locale}
                  />
                </li>
              ))}
              {section.fields.length === 0 && <li className="text-sm text-muted">{t("noFields")}</li>}
            </ol>
            {editable && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="secondary" size="sm" className="w-fit">
                    <Icon name="plus" size={15} />
                    {t("addField")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto min-w-56 p-1.5">
                  <ul aria-label={t("addField")}>
                    {fieldKinds
                      .filter((kind) => !hasNamed(schema, kind))
                      .map((kind) => (
                        <li key={kind}>
                          <button
                            type="button"
                            className="flex w-full items-center rounded-sm px-2.5 py-2 text-start text-[13.5px] font-medium text-text-secondary hover:bg-canvas focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:min-h-11"
                            onClick={() =>
                              edit(
                                addField(schema, section.key, newField(schema, kind, { label: bothWords((w) => w.kinds[kind]), option: bothWords((w) => w.option), column: bothWords((w) => w.column) })),
                              )
                            }
                          >
                            {t(`kinds.${kind}` as never)}
                          </button>
                        </li>
                      ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
          </div>
        ))}
        <p className="flex items-center gap-1.5 text-caption text-muted">
          <Icon name="info-circle" size={14} />
          {t("fixedElements")}
        </p>
      </SettingsSection>
    </>
  );
}

type Translate = ReturnType<typeof useTranslations<"projectSettings.screens">>;

/** One field of the Screen: its labels, whether it is required, shared or internal, and what its type adds. */
function FieldCard({
  field,
  first,
  last,
  editable,
  internal,
  itemsTarget,
  onChange,
  onInternal,
  onMove,
  onRemove,
  t,
  locale,
}: {
  field: FormField;
  first: boolean;
  last: boolean;
  editable: boolean;
  internal: boolean;
  /** What the "items to create" table shows under it: the Type its rows become. */
  itemsTarget: ReactNode;
  onChange: (change: (field: FormField) => FormField) => void;
  onInternal: (internal: boolean) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  t: Translate;
  locale: Locale;
}) {
  const key = field.key;
  const labelled = "label" in field;
  const typeKey = fieldTypeLabelKey[field.type] ?? "other";
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4" data-testid="screen-field">
      <div className="flex items-center gap-2">
        <Badge tone="neutral">{t(`types.${typeKey}` as never)}</Badge>
        <bdi dir="ltr" translate="no" className="text-caption text-muted">
          {key}
        </bdi>
        <span className="ms-auto flex items-center gap-0.5">
          {editable && (
            <>
              <IconButton label={t("moveUp", { field: labelled ? field.label[locale] : key })} size="sm" disabled={first} onClick={() => onMove(-1)}>
                <Icon name="arrow-up" size={16} />
              </IconButton>
              <IconButton label={t("moveDown", { field: labelled ? field.label[locale] : key })} size="sm" disabled={last} onClick={() => onMove(1)}>
                <Icon name="arrow-down" size={16} />
              </IconButton>
              <IconButton label={t("remove", { field: labelled ? field.label[locale] : key })} size="sm" onClick={onRemove}>
                <Icon name="trash" size={16} />
              </IconButton>
            </>
          )}
        </span>
      </div>
      {labelled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("labelEn")}>
            <Input
              value={field.label.en}
              dir="ltr"
              readOnly={!editable}
              onChange={(e) => onChange((f) => ("label" in f ? { ...f, label: { ...f.label, en: e.target.value } } : f))}
            />
          </Field>
          <Field label={t("labelAr")}>
            <Input
              value={field.label.ar}
              dir="rtl"
              readOnly={!editable}
              onChange={(e) => onChange((f) => ("label" in f ? { ...f, label: { ...f.label, ar: e.target.value } } : f))}
            />
          </Field>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {"required" in field && (
          <Field label={t("required")} layout="inline">
            <Switch
              checked={field.required === true}
              disabled={!editable}
              onCheckedChange={(checked) => onChange((f) => ("required" in f ? { ...f, required: checked } : f))}
            />
          </Field>
        )}
        {labelled && (
          <Field label={t("audience")} group>
            <SegmentedControl
              value={internal ? "internal" : "shared"}
              readOnly={!editable}
              onValueChange={(v) => onInternal(v === "internal")}
              options={[
                { value: "shared", label: t("shared") },
                { value: "internal", label: t("internal") },
              ]}
            />
          </Field>
        )}
      </div>
      {field.type === "select" && <OptionsEditor field={field} editable={editable} onChange={onChange} t={t} locale={locale} />}
      {field.type === "checklist" && <ChecklistEditor field={field} editable={editable} onChange={onChange} t={t} />}
      {field.type === "table" && field.key === itemsToCreateKey && itemsTarget}
    </div>
  );
}

/**
 * The "items to create" table's target Type (RP-441; decided 2026-10-11): for each outcome of
 * the Project's Types that creates items from the rows, the Type they become, which a Project
 * Admin picks here. The choice is the outcome's follow-up action on the Project's own copy of
 * the set (`PATCH …/outcomes/:code`, audited as any outcome change), so the Outcomes page and
 * item creation (WF-11) read the same Type.
 */
function ItemsTargetPicker({
  projectId,
  editable,
  itemsOutcomes,
  typeChoices,
  t,
}: {
  projectId: string;
  editable: boolean;
  itemsOutcomes: ItemsOutcome[];
  typeChoices: { code: string; name: string }[];
  t: Translate;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (itemsOutcomes.length === 0) {
    return (
      <p className="flex items-start gap-1.5 text-sm text-muted">
        <Icon name="info-circle" size={15} className="mt-0.5 shrink-0" />
        {t("itemsNoTarget")}
      </p>
    );
  }
  async function pick({ typeCode, outcome }: ItemsOutcome, target: string) {
    setError(null);
    const actions = outcome.actions.map((a) => (a.kind === "create_items" ? { ...a, type: target } : a));
    const res = await setupCall("PATCH", `/projects/${projectId}/work-item-types/${encodeURIComponent(typeCode)}/outcomes/${encodeURIComponent(outcome.code)}`, {
      name: outcome.name,
      actions,
    });
    if (res.ok) router.refresh();
    else setError(refusalMessage(t, {}, res.error));
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-text">{t("itemsTargetTitle")}</legend>
      <p className="text-sm text-muted">{t("itemsTargetHelp")}</p>
      {itemsOutcomes.map((entry) => (
        <Field key={`${entry.typeCode}-${entry.outcome.code}`} label={t("itemsTargetFor", { type: entry.typeCode, outcome: entry.outcome.code })}>
          <Select
            value={itemsToCreate(entry.outcome) ?? ""}
            disabled={!editable}
            onValueChange={(target) => void pick(entry, target)}
            options={typeChoices.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
          />
        </Field>
      ))}
      {error && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** The choices of a `select` field: a value never changes once made, the labels do. */
function OptionsEditor({
  field,
  editable,
  onChange,
  t,
}: {
  field: Extract<FormField, { type: "select" }>;
  editable: boolean;
  onChange: (change: (field: FormField) => FormField) => void;
  t: Translate;
  locale: Locale;
}) {
  const set = (options: typeof field.options) => onChange((f) => (f.type === "select" ? { ...f, options } : f));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-text">{t("options")}</legend>
      {field.options.map((option, i) => (
        <div key={option.value} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={t("optionEn", { n: i + 1 })}
            value={option.label.en}
            dir="ltr"
            readOnly={!editable}
            className="min-w-40 flex-1"
            onChange={(e) => set(field.options.map((o, j) => (j === i ? { ...o, label: { ...o.label, en: e.target.value } } : o)))}
          />
          <Input
            aria-label={t("optionAr", { n: i + 1 })}
            value={option.label.ar}
            dir="rtl"
            readOnly={!editable}
            className="min-w-40 flex-1"
            onChange={(e) => set(field.options.map((o, j) => (j === i ? { ...o, label: { ...o.label, ar: e.target.value } } : o)))}
          />
          {editable && field.options.length > 1 && (
            <IconButton label={t("removeOption", { n: i + 1 })} size="sm" onClick={() => set(field.options.filter((_, j) => j !== i))}>
              <Icon name="x" size={16} />
            </IconButton>
          )}
        </div>
      ))}
      {editable && (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => {
            let n = field.options.length + 1;
            while (field.options.some((o) => o.value === `option_${n}`)) n += 1;
            set([...field.options, { value: `option_${n}`, label: { en: "", ar: "" } }]);
          }}
        >
          <Icon name="plus" size={15} />
          {t("addOption")}
        </Button>
      )}
    </fieldset>
  );
}

/** The checks of a `checklist` field: their texts and the answers each takes. A Screen's checklist takes no photos (an Action Form holds no files). */
function ChecklistEditor({
  field,
  editable,
  onChange,
  t,
}: {
  field: Extract<FormField, { type: "checklist" }>;
  editable: boolean;
  onChange: (change: (field: FormField) => FormField) => void;
  t: Translate;
}) {
  const set = (items: typeof field.items) => onChange((f) => (f.type === "checklist" ? { ...f, items } : f));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-text">{t("checks")}</legend>
      {field.items.map((item, i) => (
        <div key={item.key} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={t("checkEn", { n: i + 1 })}
            value={item.text.en}
            dir="ltr"
            readOnly={!editable}
            className="min-w-40 flex-1"
            onChange={(e) => set(field.items.map((c, j) => (j === i ? { ...c, text: { ...c.text, en: e.target.value } } : c)))}
          />
          <Input
            aria-label={t("checkAr", { n: i + 1 })}
            value={item.text.ar}
            dir="rtl"
            readOnly={!editable}
            className="min-w-40 flex-1"
            onChange={(e) => set(field.items.map((c, j) => (j === i ? { ...c, text: { ...c.text, ar: e.target.value } } : c)))}
          />
          <Select
            aria-label={t("checkAnswers", { n: i + 1 })}
            value={item.answers}
            disabled={!editable}
            onValueChange={(answers) => set(field.items.map((c, j) => (j === i ? { ...c, answers: answers === "yes_no_na" ? "yes_no_na" : "pass_fail_na" } : c)))}
            options={[
              { value: "pass_fail_na", label: t("passFail") },
              { value: "yes_no_na", label: t("yesNo") },
            ]}
          />
          {editable && field.items.length > 1 && (
            <IconButton label={t("removeCheck", { n: i + 1 })} size="sm" onClick={() => set(field.items.filter((_, j) => j !== i))}>
              <Icon name="x" size={16} />
            </IconButton>
          )}
        </div>
      ))}
      {editable && (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => {
            let n = field.items.length + 1;
            while (field.items.some((c) => c.key === `item_${n}`)) n += 1;
            set([...field.items, { key: `item_${n}`, text: { en: "", ar: "" }, answers: "pass_fail_na", comment: "optional", photo: "off" }]);
          }}
        >
          <Icon name="plus" size={15} />
          {t("addCheck")}
        </Button>
      )}
    </fieldset>
  );
}
