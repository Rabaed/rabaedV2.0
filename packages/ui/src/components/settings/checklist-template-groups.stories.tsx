import { checklistTemplateItems, type ChecklistTemplate, type Locale } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { ChecklistTemplateGroups, ChecklistTemplateScopeField, type ChecklistTemplateGroupsLabels, type ChecklistTemplateScope, type ChecklistTemplateScopeFieldLabels } from "./checklist-template-groups.tsx";
import { SettingsSection } from "./settings-layout.tsx";

// Project → Settings → Checklist Templates (RP-1315, ADR 0031): one Civil card, its templates grouped
// "Whole Trade" first, then by Scope in the Scopes' order, the Sub-scope Footings under its Scope
// Concrete; and the editor's Scope picker. Story data only: the API lists the templates and Scopes.
const civil = "00000000-0000-4000-8000-0000000000c1";
const scope = { concrete: "00000000-0000-4000-8000-0000000005c1", footings: "00000000-0000-4000-8000-0000000005c2", masonry: "00000000-0000-4000-8000-0000000005d1", old: "00000000-0000-4000-8000-0000000005e1" };
const scopes: ChecklistTemplateScope[] = [
  { id: scope.concrete, parentId: null, name: { en: "Concrete", ar: "الخرسانة" }, active: true },
  { id: scope.footings, parentId: scope.concrete, name: { en: "Footings", ar: "القواعد" }, active: true },
  { id: scope.masonry, parentId: null, name: { en: "Masonry", ar: "المباني" }, active: true },
  { id: scope.old, parentId: null, name: { en: "Precast", ar: "الخرسانة مسبقة الصب" }, active: false },
];
const items = checklistTemplateItems.parse([
  { key: "formwork", text: { en: "Formwork level and tight", ar: "القوالب مستوية ومحكمة" } },
  { key: "cover", text: { en: "Rebar cover as per drawing", ar: "غطاء حديد التسليح حسب المخطط" } },
]);
const template = (n: number, en: string, ar: string, scopeId: string | null, status: ChecklistTemplate["status"] = "active"): ChecklistTemplate => ({
  id: `00000000-0000-4000-8000-0000000000f${n}`,
  versionId: `00000000-0000-4000-8000-0000000000a${n}`,
  versionNo: n,
  name: { en, ar },
  tradeId: civil,
  scopeId,
  status,
  items: items.slice(0, (n % 2) + 1),
});
// In the API's order (by English name); the page groups them.
const templates = [
  template(1, "Blockwork", "أعمال البلوك", scope.masonry),
  template(2, "Concrete pour", "صب الخرسانة", null),
  template(3, "Concrete works", "أعمال الخرسانة", scope.concrete),
  template(4, "Footing pour", "صب القواعد", scope.footings),
  template(5, "Screed", "الأرضيات", null, "retired"),
];

const copy = {
  wholeTrade: { en: "Whole Trade", ar: "التخصص كله" },
  subScopeOf: { en: "Sub-scope of Concrete", ar: "نطاق فرعي من الخرسانة" },
  scope: { en: "Scope", ar: "النطاق" },
};
const labelsFor = (locale: Locale): ChecklistTemplateGroupsLabels =>
  locale === "ar"
    ? {
        wholeTrade: "التخصص كله",
        subScopeOf: (s) => `نطاق فرعي من ${s}`,
        tableLabel: (g) => `قوالب قوائم التحقق لتخصص مدني، ${g}`,
        name: "القالب",
        checks: "البنود",
        version: "الإصدار",
        status: "الحالة",
        open: "فتح",
        versionNo: (n) => `الإصدار ${n}`,
        statuses: { active: "نشط", retired: "متوقف" },
      }
    : {
        wholeTrade: "Whole Trade",
        subScopeOf: (s) => `Sub-scope of ${s}`,
        tableLabel: (g) => `Checklist Templates for Civil, ${g}`,
        name: "Checklist Template",
        checks: "Items",
        version: "Version",
        status: "Availability",
        open: "Open",
        versionNo: (n) => `Version ${n}`,
        statuses: { active: "Active", retired: "Retired" },
      };
const fieldLabelsFor = (locale: Locale): ChecklistTemplateScopeFieldLabels =>
  locale === "ar"
    ? { label: "النطاق", help: "اتركه للتخصص كله، أو حدّده بنطاق أو نطاق فرعي: يُعرض على طلب المعاينة الذي يحدده.", wholeTrade: "التخصص كله", archived: "مؤرشف" }
    : { label: "Scope", help: "Leave it for the whole Trade, or narrow it to one Scope or Sub-scope: a WIR ticking it is offered the template.", wholeTrade: "Whole Trade", archived: "Archived" };

const meta = {
  title: "Settings/ChecklistTemplateGroups",
  component: ChecklistTemplateGroups,
  parameters: { layout: "padded" },
  args: { templates, scopes, locale: "en", labels: labelsFor("en"), open: () => null },
} satisfies Meta<typeof ChecklistTemplateGroups>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One Trade's card in the list (wide): "Whole Trade" first, then Concrete, its Sub-scope Footings, then Masonry. */
const Card = ({ locale }: { locale: Locale }) => (
  <SettingsSection title={locale === "ar" ? "مدني" : "Civil"} bodyClassName="px-5 pt-3 pb-5">
    <ChecklistTemplateGroups
      templates={templates}
      scopes={scopes}
      locale={locale}
      labels={labelsFor(locale)}
      open={(x) => (
        <a href={`#${x.id}`} className="inline-flex min-h-11 min-w-11 items-center justify-end text-sm font-semibold text-brand-fg hover:underline">
          {locale === "ar" ? "تعديل" : "Edit"}
        </a>
      )}
    />
  </SettingsSection>
);

const groupsShown = async (context: Parameters<NonNullable<Story["play"]>>[0]) => {
  const groups = context.canvas.getAllByTestId("template-group");
  const titles = groups.map((g) => within(g).getByRole("heading", { level: 3 }).querySelector("bdi")?.textContent);
  const locale = storyLocale(context);
  await expect(titles).toEqual(locale === "ar" ? ["التخصص كله", "الخرسانة", "القواعد", "المباني"] : ["Whole Trade", "Concrete", "Footings", "Masonry"]);
  await expect(within(groups[2]!).getByText(storyText(context, copy.subScopeOf))).toBeVisible();
  // The whole Trade's: the active one first, the retired one after it.
  await expect(within(groups[0]!).getAllByTestId("template-row").map((r) => r.querySelector("td")?.textContent)).toEqual(
    locale === "ar" ? ["صب الخرسانة", "الأرضيات"] : ["Concrete pour", "Screed"],
  );
};

export const Grouped: Story = {
  parameters: { wide: true },
  render: (_args, context) => <Card locale={storyLocale(context)} />,
  play: groupsShown,
};

export const GroupedOnAPhone: Story = {
  parameters: { phone: true },
  render: (_args, context) => <Card locale={storyLocale(context)} />,
  play: groupsShown,
};

/** The editor's Scope picker, starting at `start`, kept as the Project Admin picks. */
const Picker = ({ locale, start }: { locale: Locale; start: string | null }) => {
  const [value, setValue] = useState<string | null>(start);
  return (
    <div className="max-w-md">
      <ChecklistTemplateScopeField value={value} scopes={scopes} locale={locale} labels={fieldLabelsFor(locale)} onChange={setValue} />
    </div>
  );
};

/** The whole Trade, then the active Scopes, each Sub-scope indented under its Scope; a deactivated one isn't offered. Picking one names it. */
const pickerPlay = async (context: Parameters<NonNullable<Story["play"]>>[0]) => {
  const locale = storyLocale(context);
  await userEvent.click(context.canvas.getByRole("combobox", { name: storyText(context, copy.scope) }));
  const options = within(document.body).getAllByRole("option").map((o) => o.textContent);
  await expect(options).toEqual(locale === "ar" ? ["التخصص كله", "الخرسانة", "— القواعد", "المباني"] : ["Whole Trade", "Concrete", "— Footings", "Masonry"]);
  await userEvent.click(within(document.body).getByRole("option", { name: locale === "ar" ? "— القواعد" : "— Footings" }));
  await expect(context.canvas.getByRole("combobox", { name: storyText(context, copy.scope) })).toHaveTextContent(locale === "ar" ? "القواعد" : "Footings");
};

export const ScopePicker: Story = {
  parameters: { wide: true },
  render: (_args, context) => <Picker locale={storyLocale(context)} start={null} />,
  play: pickerPlay,
};

export const ScopePickerOnAPhone: Story = {
  parameters: { phone: true },
  render: (_args, context) => <Picker locale={storyLocale(context)} start={null} />,
  play: pickerPlay,
};

/** A template whose Scope was deactivated since keeps it offered, marked, so a save keeps it. */
export const ScopePickerKeepsItsOwn: Story = {
  parameters: { wide: true },
  render: (_args, context) => <Picker locale={storyLocale(context)} start={scope.old} />,
  play: async (context) => {
    await expect(context.canvas.getByRole("combobox", { name: storyText(context, copy.scope) })).toHaveTextContent(storyText(context, { en: "Precast (Archived)", ar: "الخرسانة مسبقة الصب (مؤرشف)" }));
  },
};
