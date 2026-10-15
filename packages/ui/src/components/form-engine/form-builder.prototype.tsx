"use client";
/* eslint-disable rabaed/no-avoid-terms, rabaed/no-ui-translations, rabaed/locale-through-helpers -- PROTOTYPE, throwaway (RP-19); the real builder takes its words from apps/web messages. */

// PROTOTYPE, throwaway (RP-19, branch prototype/puck-form-builder). Not production
// code: no tests, no error handling. It answers one question: does Puck
// (@puckeditor/core, MIT) work as Rabaed's Form builder in Arabic (RTL) with our
// own field components, dragging fields within and between sections, and saving
// back to a formSchema that passes formSchema.parse and publishProblems?
//
// Shape: a Puck config whose blocks are a Section (with a `fields` slot) and one
// block per field type (text, select, checklist, and the Built-in Trade and
// Location). Each field block renders our FormRenderer for that one field, so
// the canvas is what Members see. `toFormSchema` / `fromFormSchema` are the
// adapter: only formSchema would be stored, never Puck's data.

import { Puck, useGetPuck, type Config, type CustomField, type Data, type Slot } from "@puckeditor/core";
import "@puckeditor/core/puck.css";
import {
  directionOf,
  formSchema,
  publishProblems,
  type BilingualText,
  type FormField,
  type FormSchema,
  type Locale,
} from "@rabaed/domain";
import { useMemo, useState } from "react";
import { formRendererLabels } from "../../storybook/form-engine.ts";
import { DirectionProvider } from "../form/direction.tsx";
import { FormRenderer } from "./form-renderer.tsx";

// ---------------------------------------------------------------- Puck data shape

type Bilingual = { en: string; ar: string };
type Required = "yes" | "no";

type TextProps = { fieldKey: string; label: Bilingual; required: Required; maxLength?: number };
type SelectProps = { fieldKey: string; label: Bilingual; required: Required; options: { value: string; label: Bilingual }[] };
type ChecklistProps = {
  fieldKey: string;
  label: Bilingual;
  required: Required;
  items: { key: string; text: Bilingual; answers: "yes_no_na" | "pass_fail_na"; comment: Evidence; photo: Evidence }[];
};
type Evidence = "off" | "optional" | "required_on_negative";
type BuiltInProps = { label: Bilingual };
type SectionProps = { sectionKey: string; title: Bilingual; fields: Slot };
type RootProps = { sections: Slot };

type Components = {
  Section: SectionProps;
  TextField: TextProps;
  SelectField: SelectProps;
  ChecklistField: ChecklistProps;
  Trade: BuiltInProps;
  Location: BuiltInProps;
  Scopes: BuiltInProps;
};

export type BuilderData = Data<Components, RootProps>;
type Metadata = { locale: Locale };

const fieldBlocks = ["TextField", "SelectField", "ChecklistField", "Trade", "Location", "Scopes"];

// ---------------------------------------------------------------- the adapter

type AnyItem = { type: string; props: Record<string, unknown> & { id: string } };

/** Puck data → our formSchema (unparsed: formSchema.parse is the check). */
export function toFormSchema(data: BuilderData): unknown {
  const sections = ((data.root.props as unknown as { sections?: AnyItem[] }).sections ?? []) as AnyItem[];
  return {
    sections: sections.map((s) => ({
      key: s.props.sectionKey,
      title: s.props.title,
      fields: ((s.props.fields as AnyItem[] | undefined) ?? []).map(toField),
    })),
  };
}

function toField(item: AnyItem): unknown {
  const p = item.props;
  const required = p.required === "yes";
  switch (item.type) {
    case "TextField":
      return { key: p.fieldKey, type: "text", label: p.label, required, ...(p.maxLength ? { maxLength: p.maxLength } : {}) };
    case "SelectField":
      return { key: p.fieldKey, type: "select", label: p.label, required, options: p.options };
    case "ChecklistField":
      return { key: p.fieldKey, type: "checklist", label: p.label, required, items: p.items };
    case "Trade":
      return { key: "trade", type: "trade", label: p.label, required: true };
    case "Location":
      return { key: "location", type: "location", label: p.label, required: true };
    case "Scopes":
      return { key: "scopes", type: "scopes", label: p.label, required: false };
    default:
      return { key: "unsupported", type: item.type };
  }
}

/** Our formSchema → Puck data. Field types the prototype has no block for are dropped (and say so). */
export function fromFormSchema(schema: FormSchema): BuilderData {
  return {
    root: {
      props: {
        sections: schema.sections.map((s) => ({
          type: "Section",
          props: { id: `Section-${s.key}`, sectionKey: s.key, title: s.title, fields: s.fields.flatMap(fromField) },
        })),
      },
    },
    content: [],
  } as unknown as BuilderData;
}

function fromField(f: FormField): AnyItem[] {
  const id = `${f.type}-${f.key}`;
  switch (f.type) {
    case "text":
      return [{ type: "TextField", props: { id, fieldKey: f.key, label: f.label, required: f.required === true ? "yes" : "no", maxLength: f.maxLength } }];
    case "select":
      return [{ type: "SelectField", props: { id, fieldKey: f.key, label: f.label, required: f.required === true ? "yes" : "no", options: f.options } }];
    case "checklist":
      return [{ type: "ChecklistField", props: { id, fieldKey: f.key, label: f.label, required: f.required === true ? "yes" : "no", items: f.items } }];
    case "trade":
      return [{ type: "Trade", props: { id, label: f.label } }];
    case "location":
      return [{ type: "Location", props: { id, label: f.label } }];
    case "scopes":
      return [{ type: "Scopes", props: { id, label: f.label } }];
    default:
      return [];
  }
}

// ---------------------------------------------------------------- the builder's own words

const words = {
  en: {
    section: "Section",
    text: "Text",
    select: "Select",
    checklist: "Checklist",
    trade: "Trade (Built-in)",
    location: "Location (Built-in)",
    scopes: "Scopes (Built-in)",
    save: "Save",
    key: "Key",
    title: "Title",
    label: "Label",
    required: "Required",
    yes: "Yes",
    no: "No",
    maxLength: "Most characters",
    options: "Options",
    value: "Value",
    items: "Items",
    itemText: "Item",
    answers: "Answers",
    comment: "Comment",
    photo: "Photo",
    off: "Off",
    optional: "Optional",
    onNegative: "Required on a negative answer",
    english: "English",
    arabic: "Arabic",
    catLayout: "Layout",
    catFields: "Fields",
    catBuiltIn: "Built-in Fields",
    preview: "Preview",
    emptySection: "Drop fields here",
    newField: { en: "New field", ar: "حقل جديد" },
    newSection: { en: "New section", ar: "قسم جديد" },
    newOption: { en: "Option", ar: "خيار" },
    newItem: { en: "Check item", ar: "بند فحص" },
  },
  ar: {
    section: "قسم",
    text: "نص",
    select: "قائمة اختيار",
    checklist: "قائمة فحص",
    trade: "التخصص (حقل مدمج)",
    location: "الموقع (حقل مدمج)",
    scopes: "النطاقات (حقل مدمج)",
    save: "حفظ",
    key: "المفتاح",
    title: "العنوان",
    label: "التسمية",
    required: "مطلوب",
    yes: "نعم",
    no: "لا",
    maxLength: "أقصى عدد من الأحرف",
    options: "الخيارات",
    value: "القيمة",
    items: "البنود",
    itemText: "البند",
    answers: "الإجابات",
    comment: "التعليق",
    photo: "الصورة",
    off: "لا يُطلب",
    optional: "اختياري",
    onNegative: "مطلوب عند الإجابة السلبية",
    english: "الإنجليزية",
    arabic: "العربية",
    catLayout: "التخطيط",
    catFields: "الحقول",
    catBuiltIn: "الحقول المدمجة",
    preview: "المعاينة",
    emptySection: "أفلت الحقول هنا",
    newField: { en: "New field", ar: "حقل جديد" },
    newSection: { en: "New section", ar: "قسم جديد" },
    newOption: { en: "Option", ar: "خيار" },
    newItem: { en: "Check item", ar: "بند فحص" },
  },
} as const;

/** Puck's own editor strings in Arabic (its v0.23 Dictionary API). English keeps Puck's defaults. */
const puckArabic = {
  "header-publish": "حفظ",
  "header-undo": "تراجع",
  "header-redo": "إعادة",
  "header-toggle-leftsidebar": "إظهار الشريط الجانبي الأيسر أو إخفاؤه",
  "header-toggle-rightsidebar": "إظهار الشريط الجانبي الأيمن أو إخفاؤه",
  "header-toggle-menubar": "إظهار القائمة أو إخفاؤها",
  "action-selectparent": "تحديد الأصل",
  "action-duplicate": "تكرار",
  "action-delete": "حذف",
  "label-page": "النموذج",
  "label-component": "العنصر",
  "outline-empty": "لا توجد عناصر",
  "outline-item-collapse": "طي",
  "outline-item-expand": "توسيع",
  "outline-header-title": "المخطط",
  "outline-header-collapseall": "طي الكل",
  "outline-item-duplicate": "تكرار",
  "outline-item-delete": "حذف",
  "drawer-category-collapse": "طي {title}",
  "drawer-category-expand": "توسيع {title}",
  "drawer-category-other": "أخرى",
  "field-readonly": "للقراءة فقط",
  "field-arrayitem-summary": "عنصر رقم {index}",
  "field-arrayitem-duplicate": "تكرار",
  "field-arrayitem-delete": "حذف",
  "viewport-zoom-in": "تكبير",
  "viewport-zoom-out": "تصغير",
  "viewport-zoom-auto": "{zoom}% (تلقائي)",
  "viewport-switch": "التبديل إلى {label}",
  "plugin-blocks": "العناصر",
  "plugin-outline": "المخطط",
  "plugin-fields": "الخصائص",
  "plugin-components": "العناصر",
  "loader-loading": "جارٍ التحميل",
};

// ---------------------------------------------------------------- property editors (our own, as Puck custom fields)

/** Our bilingual text editor: English left to right, Arabic right to left, both required to publish. */
function bilingualField(label: string, w: (typeof words)[Locale]): CustomField<Bilingual> {
  return {
    type: "custom",
    label,
    render: ({ value, onChange, id }) => (
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{label}</span>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-muted">{w.english}</span>
          <input
            id={`${id}-en`}
            dir="ltr"
            lang="en"
            className="rounded-sm border border-border px-2 py-1"
            value={value?.en ?? ""}
            onChange={(e) => onChange({ en: e.target.value, ar: value?.ar ?? "" })}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-muted">{w.arabic}</span>
          <input
            id={`${id}-ar`}
            dir="rtl"
            lang="ar"
            className="rounded-sm border border-border px-2 py-1"
            value={value?.ar ?? ""}
            onChange={(e) => onChange({ en: value?.en ?? "", ar: e.target.value })}
          />
        </label>
      </div>
    ),
  };
}

/** A key: Latin, lower case, left to right even in Arabic. */
function keyField(label: string): CustomField<string> {
  return {
    type: "custom",
    label,
    render: ({ value, onChange, id }) => (
      <label className="flex flex-col gap-0.5 text-sm">
        <span className="font-medium">{label}</span>
        <input id={id} dir="ltr" className="rounded-sm border border-border px-2 py-1 font-mono" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      </label>
    ),
  };
}

/** A new block's key, made from Puck's id so it starts unique and valid (formKey). */
const keyFromId = (prefix: string, id: string) => `${prefix}_${id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-6)}`;

// ---------------------------------------------------------------- the field blocks: our FormRenderer, one field each

function FieldPreview({ field, locale }: { field: unknown; locale: Locale }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const schema = { sections: [{ key: "preview", title: { en: "Preview", ar: "معاينة" }, fields: [field] }] } as unknown as FormSchema;
  return (
    <div className="py-2" lang={locale} dir={directionOf(locale)}>
      <FormRenderer
        schema={schema}
        answers={answers}
        mode="edit"
        locale={locale}
        labels={formRendererLabels[locale]}
        sectionTitles="hidden"
        idPrefix={`preview-${(field as { key?: string }).key ?? "x"}`}
        onChange={(changes) => setAnswers((a) => ({ ...a, ...changes }))}
        choices={{
          trades: [
            { id: "civil", label: locale === "ar" ? "الأعمال المدنية" : "Civil" },
            { id: "mep", label: locale === "ar" ? "الأعمال الكهروميكانيكية" : "MEP" },
          ],
          locations: [{ id: "tower_a", label: locale === "ar" ? "البرج أ" : "Tower A" }],
          scopes: [],
        } as never}
      />
    </div>
  );
}

const localeOf = (puck: { metadata: Record<string, unknown> }): Locale => ((puck.metadata as Metadata).locale ?? "en");

const choiceOptions = (w: (typeof words)[Locale]) => [
  { label: w.yes, value: "yes" },
  { label: w.no, value: "no" },
];

const evidenceOptions = (w: (typeof words)[Locale]) => [
  { label: w.off, value: "off" },
  { label: w.optional, value: "optional" },
  { label: w.onNegative, value: "required_on_negative" },
];

/** The Puck config, in the builder's language `ui` (the editor chrome's). The canvas follows `metadata.locale`. */
export function builderConfig(ui: Locale): Config<Components, RootProps> {
  const w = words[ui];
  return {
    categories: {
      layout: { title: w.catLayout, components: ["Section"] },
      fields: { title: w.catFields, components: ["TextField", "SelectField", "ChecklistField"] },
      builtIn: { title: w.catBuiltIn, components: ["Trade", "Location", "Scopes"] },
    },
    root: {
      fields: { sections: { type: "slot", allow: ["Section"] } },
      render: ({ sections: Sections, puck }) => {
        const locale = localeOf(puck);
        return (
          <DirectionProvider dir={directionOf(locale)}>
            <div lang={locale} dir={directionOf(locale)} className="mx-auto flex max-w-2xl flex-col gap-4 bg-surface p-6 text-text">
              <Sections minEmptyHeight={120} />
            </div>
          </DirectionProvider>
        );
      },
    },
    components: {
      Section: {
        label: w.section,
        fields: { sectionKey: keyField(w.key), title: bilingualField(w.title, w), fields: { type: "slot", allow: fieldBlocks } },
        defaultProps: { sectionKey: "", title: w.newSection, fields: [] },
        resolveData: (data, { trigger }) =>
          trigger === "insert" ? { ...data, props: { ...data.props, sectionKey: keyFromId("section", data.props.id) } } : data,
        render: ({ title, fields: Fields, puck }) => {
          const locale = localeOf(puck);
          return (
            <section className="flex flex-col gap-2 rounded-md border border-border p-4">
              <h3 className="font-display text-h6 font-semibold">{title?.[locale]}</h3>
              <Fields minEmptyHeight={64} />
            </section>
          );
        },
      },
      TextField: {
        label: w.text,
        fields: {
          fieldKey: keyField(w.key),
          label: bilingualField(w.label, w),
          required: { type: "radio", label: w.required, options: choiceOptions(w) },
          maxLength: { type: "number", label: w.maxLength, min: 1, max: 2000 },
        },
        defaultProps: { fieldKey: "", label: w.newField, required: "no" },
        resolveData: (data, { trigger }) => (trigger === "insert" ? { ...data, props: { ...data.props, fieldKey: keyFromId("text", data.props.id) } } : data),
        render: ({ puck, id: _id, ...props }) => <FieldPreview locale={localeOf(puck)} field={toField({ type: "TextField", props: props as never })} />,
      },
      SelectField: {
        label: w.select,
        fields: {
          fieldKey: keyField(w.key),
          label: bilingualField(w.label, w),
          required: { type: "radio", label: w.required, options: choiceOptions(w) },
          options: {
            type: "array",
            label: w.options,
            arrayFields: { value: keyField(w.value), label: bilingualField(w.label, w) },
            defaultItemProps: { value: "option", label: w.newOption },
            getItemSummary: (item) => item.label?.[ui] || item.value,
          },
        },
        defaultProps: { fieldKey: "", label: w.newField, required: "no", options: [{ value: "option_1", label: w.newOption }] },
        resolveData: (data, { trigger }) => (trigger === "insert" ? { ...data, props: { ...data.props, fieldKey: keyFromId("select", data.props.id) } } : data),
        render: ({ puck, id: _id, ...props }) => <FieldPreview locale={localeOf(puck)} field={toField({ type: "SelectField", props: props as never })} />,
      },
      ChecklistField: {
        label: w.checklist,
        fields: {
          fieldKey: keyField(w.key),
          label: bilingualField(w.label, w),
          required: { type: "radio", label: w.required, options: choiceOptions(w) },
          items: {
            type: "array",
            label: w.items,
            arrayFields: {
              key: keyField(w.key),
              text: bilingualField(w.itemText, w),
              answers: {
                type: "select",
                label: w.answers,
                options: [
                  { label: ui === "ar" ? "مقبول / مرفوض / لا ينطبق" : "Pass / Fail / N/A", value: "pass_fail_na" },
                  { label: ui === "ar" ? "نعم / لا / لا ينطبق" : "Yes / No / N/A", value: "yes_no_na" },
                ],
              },
              comment: { type: "select", label: w.comment, options: evidenceOptions(w) },
              photo: { type: "select", label: w.photo, options: evidenceOptions(w) },
            },
            defaultItemProps: { key: "item", text: w.newItem, answers: "pass_fail_na", comment: "optional", photo: "off" },
            getItemSummary: (item) => item.text?.[ui] || item.key,
          },
        },
        defaultProps: {
          fieldKey: "",
          label: w.newField,
          required: "no",
          items: [{ key: "item_1", text: w.newItem, answers: "pass_fail_na", comment: "optional", photo: "off" }],
        },
        resolveData: (data, { trigger }) => (trigger === "insert" ? { ...data, props: { ...data.props, fieldKey: keyFromId("checklist", data.props.id) } } : data),
        render: ({ puck, id: _id, ...props }) => <FieldPreview locale={localeOf(puck)} field={toField({ type: "ChecklistField", props: props as never })} />,
      },
      // Built-in Fields: in every Form exactly once, so never inserted, duplicated or deleted; only moved and relabelled.
      Trade: {
        label: w.trade,
        fields: { label: bilingualField(w.label, w) },
        defaultProps: { label: { en: "Trade", ar: "التخصص" } },
        permissions: { delete: false, duplicate: false, insert: false },
        render: ({ puck, id: _id, ...props }) => <FieldPreview locale={localeOf(puck)} field={toField({ type: "Trade", props: props as never })} />,
      },
      Location: {
        label: w.location,
        fields: { label: bilingualField(w.label, w) },
        defaultProps: { label: { en: "Location", ar: "الموقع" } },
        permissions: { delete: false, duplicate: false, insert: false },
        render: ({ puck, id: _id, ...props }) => <FieldPreview locale={localeOf(puck)} field={toField({ type: "Location", props: props as never })} />,
      },
      Scopes: {
        label: w.scopes,
        fields: { label: bilingualField(w.label, w) },
        defaultProps: { label: { en: "Scopes", ar: "النطاقات" } },
        permissions: { delete: false, duplicate: false, insert: false },
        render: ({ puck, id: _id, ...props }) => <FieldPreview locale={localeOf(puck)} field={toField({ type: "Scopes", props: props as never })} />,
      },
    },
  };
}

// ---------------------------------------------------------------- the builder, with its state surfaced

export type SaveResult = { at: string; parsed: boolean; parseIssues: string[]; problems: { key: string; code: string }[]; schema: unknown };

function check(data: BuilderData): SaveResult {
  const candidate = toFormSchema(data);
  const parsed = formSchema.safeParse(candidate);
  return {
    at: new Date().toLocaleTimeString("en-GB"),
    parsed: parsed.success,
    parseIssues: parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    problems: parsed.success ? publishProblems(parsed.data) : [],
    schema: parsed.success ? parsed.data : candidate,
  };
}

/** The header's buttons: the canvas's language, and Save (Puck's Publish), which runs the adapter and our checks. */
function HeaderActions({ ui, previewLocale, onPreview, onSave }: { ui: Locale; previewLocale: Locale; onPreview: () => void; onSave: (data: BuilderData) => void }) {
  const getPuck = useGetPuck();
  return (
    <div className="flex gap-2">
      <button type="button" data-testid="preview-locale" className="rounded-sm border border-border px-3 py-1 text-sm" onClick={onPreview}>
        {words[ui].preview}: {previewLocale === "ar" ? "العربية" : "English"}
      </button>
      <button
        type="button"
        data-testid="save"
        className="rounded-sm bg-primary px-3 py-1 text-sm text-on-primary"
        onClick={() => onSave(getPuck().appState.data as BuilderData)}
      >
        {words[ui].save}
      </button>
    </div>
  );
}

export function PuckFormBuilderPrototype({ initial, ui }: { initial: FormSchema; ui: Locale }) {
  const [previewLocale, setPreviewLocale] = useState<Locale>(ui);
  const config = useMemo(() => builderConfig(ui), [ui]);
  const data = useMemo(() => fromFormSchema(initial), [initial]);
  const [live, setLive] = useState<SaveResult>(() => check(data));
  const [saved, setSaved] = useState<SaveResult | null>(null);
  const roundTrip = useMemo(() => JSON.stringify(formSchema.parse(toFormSchema(fromFormSchema(initial)))) === JSON.stringify(initial), [initial]);
  const shown = saved ?? live;
  return (
    <div className="flex flex-col gap-3">
      <Puck
        key={ui}
        config={config}
        data={data}
        metadata={{ locale: previewLocale }}
        dictionary={ui === "ar" ? puckArabic : undefined}
        headerTitle={ui === "ar" ? "منشئ النماذج (نموذج أولي)" : "Form builder (prototype)"}
        height="78vh"
        viewports={[
          { width: 720, label: ui === "ar" ? "النموذج" : "Form" },
          { width: 390, label: ui === "ar" ? "الجوال" : "Phone" },
        ]}
        onChange={(d) => setLive(check(d as BuilderData))}
        onPublish={(d) => setSaved(check(d as BuilderData))}
        renderHeaderActions={() => (
          <HeaderActions ui={ui} previewLocale={previewLocale} onPreview={() => setPreviewLocale((l) => (l === "ar" ? "en" : "ar"))} onSave={(d) => setSaved(check(d))} />
        )}
      />
      <aside data-testid="state" dir="ltr" lang="en" className="grid grid-cols-1 gap-3 rounded-md border border-border p-3 text-xs md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <strong>PROTOTYPE state</strong>
          <span>Round trip formSchema → Puck → formSchema equal: {roundTrip ? "yes" : "NO"}</span>
          <span>Showing: {saved ? `last Publish (${saved.at})` : "live (not saved yet)"}</span>
          <span data-testid="parse">formSchema.parse: {shown.parsed ? "passes" : "FAILS"}</span>
          {shown.parseIssues.map((i) => (
            <span key={i} className="text-danger-fg">
              {i}
            </span>
          ))}
          <span data-testid="problems">publishProblems: {shown.parsed ? (shown.problems.length === 0 ? "none" : JSON.stringify(shown.problems)) : "n/a"}</span>
          <span>Live: parse {live.parsed ? "passes" : "fails"}, {live.problems.length} problems</span>
        </div>
        <pre data-testid="schema" className="max-h-64 overflow-auto md:col-span-2">
          {JSON.stringify(shown.schema, null, 1)}
        </pre>
      </aside>
    </div>
  );
}

export type { BilingualText };
