import { levelSeparator, listSeparator, type FormSchema, type Locale } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { Button } from "../button/button.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { TradeChip } from "../views/kanban-card.tsx";
import {
  SubmittalPanelFields,
  SubmittalPanelItems,
  SubmittalPanelLinks,
  SubmittalPanelPath,
  SubmittalPanelSections,
  SubmittalPanelTags,
  type SubmittalPanelLinkItem,
  type SubmittalPanelSectionItem,
} from "./panel-sections.tsx";
import { submittalPanelSectionKeys, submittalPanelSupplier, submittalPanelTab, type SubmittalPanelSectionKey } from "./panel-sections-model.ts";
import { SubmittalPanelTabs } from "./panel-tabs.tsx";
import { SubmittalPanel, SubmittalPanelIdentity, useSubmittalPanelIds } from "./submittal-panel.tsx";

type Bi = Record<Locale, string>;
const bi = (en: string, ar: string): Bi => ({ en, ar });

const copy = {
  module: bi("Submittals", "التقديمات"),
  previous: bi("Previous submittal", "التقديم السابق"),
  next: bi("Next submittal", "التقديم التالي"),
  close: bi("Close", "إغلاق"),
  hint: bi("Esc to close · ↑ ↓ to move through the list", "Esc للإغلاق · ↑ ↓ للتنقل في القائمة"),
  tabs: bi("Submittal", "التقديم"),
  details: bi("Details", "التفاصيل"),
  internal: bi("Internal Communication", "التواصل الداخلي"),
  internalOnly: bi("Only your Company sees this.", "لا تراه إلا شركتك."),
  collapseAll: bi("Collapse all", "طي الكل"),
  expandAll: bi("Expand all", "فتح الكل"),
  subject: bi("Subject", "الموضوع"),
  type: bi("Work Item Type", "نوع العنصر"),
  scope: bi("Scope", "النطاق"),
  trade: bi("Trade", "التخصص"),
  scopes: bi("Scopes within the Trade", "النطاقات ضمن التخصص"),
  location: bi("Location", "الموقع"),
  supplier: bi("Supplier & items", "المورد والبنود"),
  approvedSupplier: bi("Approved Supplier", "المورد المعتمد"),
  links: bi("Links", "الروابط"),
  noLinks: bi("No Links", "لا روابط"),
  none: bi("None yet", "لا شيء بعد"),
};
const sectionsCount = (n: string, locale: Locale) => (locale === "ar" ? `${n} أقسام` : `${n} sections`);
const linksCount = (n: number, locale: Locale) => (locale === "ar" ? `${n} روابط` : `${n} links`);
const itemsCount = (n: number, locale: Locale) => (locale === "ar" ? `${n} بنود` : `${n} items`);

const classification = {
  key: "classification",
  title: bi("Classification", "التصنيف"),
  fields: [
    { key: "trade", type: "trade", label: bi("Trade", "التخصص"), required: true },
    { key: "location", type: "location", label: bi("Location", "الموقع"), required: true },
    { key: "scopes", type: "scopes", label: bi("Scopes", "النطاقات"), required: false },
  ],
};
const marForm = {
  sections: [
    { key: "material", title: bi("Material", "المادة"), fields: [{ key: "supplier", type: "approved_supplier", label: bi("Approved supplier", "المورّد المعتمد"), required: true }] },
    {
      key: "quantities",
      title: bi("Items", "البنود"),
      fields: [
        {
          key: "items",
          type: "table",
          label: bi("Items", "البنود"),
          required: true,
          columns: [
            { key: "fixture_type", type: "text", label: bi("Fixture type", "نوع الوحدة"), required: true },
            { key: "quantity", type: "number", label: bi("Quantity", "الكمية"), required: true, decimals: 0 },
          ],
        },
      ],
    },
    classification,
  ],
} as unknown as FormSchema;
/** A drawing request: no supplier, no items. */
const darForm = { sections: [classification] } as unknown as FormSchema;

const suppliers = [{ id: "s-1", tradeId: "t-el", status: "approved" as const, name: bi("Gulf Lighting Co.", "الخليج للإنارة") }];

type Row = {
  id: string;
  number: string;
  subject: string;
  type: Bi;
  form: FormSchema;
  answers: Record<string, unknown>;
  trade: { code: string; name: Bi };
  scopes: Bi[];
  place: Bi[];
  links: SubmittalPanelLinkItem[];
  /** Internal events the viewer's own Participant has on it: 0 offers no Internal Communication tab. */
  internal: number;
};

const rows: Row[] = [
  {
    id: "r1",
    number: "TWR-TMC-EL-MAR-042",
    subject: "Linear LED fixtures",
    type: bi("MAR Material approval", "MAR اعتماد مواد"),
    form: marForm,
    answers: {
      supplier: "s-1",
      items: [
        { fixture_type: "Linear LED 1200", quantity: 240 },
        { fixture_type: "Downlight 150", quantity: 1200 },
      ],
    },
    trade: { code: "EL", name: bi("Electrical", "كهرباء") },
    scopes: [bi("Lighting", "الإنارة"), bi("Emergency lighting", "إنارة الطوارئ")],
    place: [bi("Zone A", "المنطقة A"), bi("Building 1", "المبنى 1"), bi("Floor 3", "الطابق 3")],
    links: [
      // A linked item the viewer sees: it opens on its own page (the positive control).
      { id: "link-1", documentNumber: "TWR-TMC-EL-DAR-031", subject: "Lighting layout, level 3", href: "/work-items/target-seen" },
      // One they can't see: its number and Subject only, opening on the Link's own page (Links row, RP-521).
      { id: "link-2", documentNumber: "TWR-DCL-EL-QST-007", subject: "Emergency lux levels", href: "/work-items/r1/links/link-2" },
    ],
    internal: 3,
  },
  {
    id: "r2",
    number: "TWR-TMC-CV-DAR-281",
    subject: "Drainage System",
    type: bi("DAR Drawing approval", "DAR اعتماد مخططات"),
    form: darForm,
    answers: {},
    trade: { code: "CV", name: bi("Civil", "مدني") },
    scopes: [bi("Drainage", "الصرف")],
    place: [bi("Zone B", "المنطقة B")],
    links: [],
    internal: 0,
  },
];

function sectionsOf(row: Row, locale: Locale): SubmittalPanelSectionItem[] {
  const supplier = submittalPanelSupplier(row.form, row.answers, suppliers, locale);
  const scopes = row.scopes.map((s) => s[locale]);
  const place = row.place.map((p) => p[locale]);
  const all: Record<SubmittalPanelSectionKey, SubmittalPanelSectionItem> = {
    subject: {
      key: "subject",
      icon: "file-text",
      title: copy.subject[locale],
      summary: row.subject,
      children: (
        <SubmittalPanelFields
          fields={[
            { key: "subject", label: copy.subject[locale], value: row.subject, full: true },
            { key: "type", label: copy.type[locale], value: row.type[locale] },
          ]}
        />
      ),
    },
    scope: {
      key: "scope",
      icon: "category",
      title: copy.scope[locale],
      summary: [row.trade.name[locale], scopes.join(listSeparator[locale])].filter(Boolean).join(" · "),
      children: (
        <SubmittalPanelFields
          fields={[
            { key: "trade", label: copy.trade[locale], value: <TradeChip code={row.trade.code} name={row.trade.name[locale]} /> },
            { key: "scopes", label: copy.scopes[locale], value: <SubmittalPanelTags tags={scopes} />, full: true },
          ]}
        />
      ),
    },
    location: {
      key: "location",
      icon: "map-pin",
      title: copy.location[locale],
      summary: place.join(levelSeparator[locale]),
      children: <SubmittalPanelPath locale={locale} label={copy.location[locale]} levels={place} />,
    },
    supplier: {
      key: "supplier",
      icon: "buildings",
      title: copy.supplier[locale],
      summary: [supplier.suppliers.join(listSeparator[locale]), itemsCount(supplier.itemCount, locale)].filter(Boolean).join(" · "),
      children: (
        <div className="flex flex-col gap-3">
          <SubmittalPanelFields fields={[{ key: "supplier", label: copy.approvedSupplier[locale], value: supplier.suppliers.join(listSeparator[locale]) || "—" }]} />
          {supplier.tables.map((table) => (
            <SubmittalPanelItems key={table.key} table={table} none={copy.none[locale]} />
          ))}
        </div>
      ),
    },
    links: {
      key: "links",
      icon: "link",
      title: copy.links[locale],
      summary: linksCount(row.links.length, locale),
      children: <SubmittalPanelLinks links={row.links} none={copy.noLinks[locale]} />,
    },
  };
  return submittalPanelSectionKeys(row.form).map((key) => all[key]);
}

function DetailsDemo({ context, start, startCollapsed = {} }: { context: StoryContext; start: string; startCollapsed?: Record<string, boolean> }) {
  const locale = storyLocale(context);
  const ids = useSubmittalPanelIds();
  const [open, setOpen] = useState(start);
  // Kept across submittals, as `panel-preferences` keeps them in the browser.
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const [kept, setKept] = useState("details");
  const row = rows.find((r) => r.id === open)!;
  const offered = row.internal > 0 ? ["details", "internal"] : ["details"];
  const sections = (
    <SubmittalPanelSections
      locale={locale}
      labels={{ count: (n) => sectionsCount(n, locale), collapseAll: copy.collapseAll[locale], expandAll: copy.expandAll[locale] }}
      sections={sectionsOf(row, locale)}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
    />
  );
  return (
    <div className="space-y-2 p-4">
      {rows.map((r) => (
        <Button key={r.id} variant="secondary" data-row={r.id} onClick={() => setOpen(r.id)}>
          {r.subject}
        </Button>
      ))}
      <SubmittalPanel
        locale={locale}
        labels={{
          module: copy.module[locale],
          position: (n, total) => `${n} / ${total}`,
          previous: copy.previous[locale],
          next: copy.next[locale],
          close: copy.close[locale],
          hint: copy.hint[locale],
        }}
        crumb={<DocNo value={row.number} />}
        onClose={() => undefined}
        labelledBy={ids.labelledBy}
        identity={
          <SubmittalPanelIdentity
            locale={locale}
            number={{ number: row.number, revisionNo: null }}
            noNumber=""
            subject={row.subject}
            numberId={ids.numberId}
            subjectId={ids.subjectId}
          />
        }
        tabs={
          <SubmittalPanelTabs
            locale={locale}
            label={copy.tabs[locale]}
            value={submittalPanelTab(kept, offered)}
            onValueChange={setKept}
            tabs={[
              { key: "details", label: copy.details[locale], content: sections },
              ...(row.internal > 0
                ? [
                    {
                      key: "internal",
                      label: copy.internal[locale],
                      icon: "lock" as const,
                      count: row.internal,
                      content: <p className="px-5 py-4 text-sm text-muted">{copy.internalOnly[locale]}</p>,
                    },
                  ]
                : []),
            ]}
          />
        }
      />
    </div>
  );
}

const meta = {
  title: "Views/Submittal Panel/Details",
  parameters: overlay,
  render: (_args, context) => <DetailsDemo context={context} start="r1" />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const panelOf = (context: PlayContext) => within(context.canvasElement).getByRole("dialog");
const headOf = (context: PlayContext, key: string) => panelOf(context).querySelector<HTMLButtonElement>(`[data-section="${key}"] .sdp-section-head`)!;
const heads = (context: PlayContext) => [...panelOf(context).querySelectorAll<HTMLButtonElement>(".sdp-section-head")];

/**
 * A material request, every section open (README §4.6–4.8): the tabs (Details, and Internal
 * Communication with its count for a viewer whose Participant has internal history on it), "5
 * sections", each header a full-width button saying it is expanded. The Links follow the Links
 * row: a linked item the viewer sees opens on its own page (the positive control); one they can't
 * see shows its number and Subject only and opens on the Link's own page, never by its id.
 */
export const Details: Story = {
  play: async (context) => {
    const panel = panelOf(context);
    const tablist = within(panel).getByRole("tablist", { name: storyText(context, copy.tabs) });
    const tabs = within(tablist).getAllByRole("tab");
    await expect(tabs.map((t) => t.getAttribute("data-tab"))).toEqual(["details", "internal"]);
    await expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    await expect(tabs[1]).toHaveAccessibleName(`${storyText(context, copy.internal)} 3`);

    await expect(within(panel).getByText(sectionsCount("5", storyLocale(context)))).toBeVisible();
    await expect(heads(context).map((h) => h.closest("section")!.dataset.section)).toEqual(["subject", "scope", "location", "supplier", "links"]);
    for (const head of heads(context)) {
      await expect(head).toHaveAttribute("aria-expanded", "true");
      // The whole width is the button.
      await expect(head.getBoundingClientRect().width).toBe(head.closest("section")!.getBoundingClientRect().width);
    }

    const links = panel.querySelector<HTMLElement>('[data-section="links"]')!;
    const seen = links.querySelector<HTMLAnchorElement>('[data-link="link-1"]')!;
    const hidden = links.querySelector<HTMLAnchorElement>('[data-link="link-2"]')!;
    await expect(seen).toHaveAttribute("href", "/work-items/target-seen");
    await expect(hidden).toHaveAttribute("href", "/work-items/r1/links/link-2");
    await expect(hidden).toHaveTextContent(/^TWR-DCL-EL-QST-007Emergency lux levels$/);
    // Document Numbers read left to right, in Arabic too.
    await expect(getComputedStyle(within(hidden).getByText("TWR-DCL-EL-QST-007")).direction).toBe("ltr");

    // The tabs stay at the top of the scrolling body.
    const body = panel.querySelector<HTMLElement>(".sdp-body")!;
    body.scrollTop = body.scrollHeight;
    await expect(Math.round(tablist.getBoundingClientRect().top)).toBe(Math.round(body.getBoundingClientRect().top));
    body.scrollTop = 0;
  },
};

/**
 * Collapse all folds every section to its header and one-line summary, and the button then
 * offers Expand all; a header folds or opens its own section.
 */
export const Collapsed: Story = {
  play: async (context) => {
    const panel = panelOf(context);
    const locale = storyLocale(context);
    await userEvent.click(within(panel).getByRole("button", { name: storyText(context, copy.collapseAll) }));
    for (const head of heads(context)) await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(panel.querySelector(".sdp-section-body")).toBeNull();
    const summary = (key: string) => headOf(context, key).querySelector(".sdp-section-summary");
    await expect(summary("subject")).toHaveTextContent("Linear LED fixtures");
    await expect(summary("scope")).toHaveTextContent(locale === "ar" ? "كهرباء · الإنارة، إنارة الطوارئ" : "Electrical · Lighting, Emergency lighting");
    await expect(summary("location")).toHaveTextContent(locale === "ar" ? "المنطقة A ‹ المبنى 1 ‹ الطابق 3" : "Zone A › Building 1 › Floor 3");
    await expect(summary("supplier")).toHaveTextContent(locale === "ar" ? "الخليج للإنارة · 2 بنود" : "Gulf Lighting Co. · 2 items");
    await expect(summary("links")).toHaveTextContent(locale === "ar" ? "2 روابط" : "2 links");
    await expect(summary("links")).toBeVisible();

    await userEvent.click(headOf(context, "links"));
    await expect(headOf(context, "links")).toHaveAttribute("aria-expanded", "true");
    await expect(summary("links")).not.toBeVisible();
    // Not every section is folded now: the button offers Collapse all again.
    await userEvent.click(within(panel).getByRole("button", { name: storyText(context, copy.collapseAll) }));
    await expect(headOf(context, "links")).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(within(panel).getByRole("button", { name: storyText(context, copy.expandAll) }));
    for (const head of heads(context)) await expect(head).toHaveAttribute("aria-expanded", "true");
  },
};

/**
 * The folds are remembered across submittals. A drawing request has no supplier, so Supplier &
 * items is hidden and "4 sections" counts only those shown; it has no Internal Communication for
 * this viewer, so the kept tab falls back to Details there.
 */
export const AcrossSubmittals: Story = {
  play: async (context) => {
    const panel = panelOf(context);
    await userEvent.click(headOf(context, "supplier"));
    await userEvent.click(within(panel).getByRole("tab", { name: new RegExp(storyText(context, copy.internal)) }));
    await expect(within(panel).getByText(storyText(context, copy.internalOnly))).toBeVisible();

    await userEvent.click(context.canvasElement.querySelector<HTMLElement>('[data-row="r2"]')!);
    await expect(panel.querySelector('[data-section="supplier"]')).toBeNull();
    await expect(within(panel).getByText(sectionsCount("4", storyLocale(context)))).toBeVisible();
    await expect(within(panel).getAllByRole("tab").map((t) => t.getAttribute("data-tab"))).toEqual(["details"]);
    await expect(within(panel).getByRole("tab")).toHaveAttribute("aria-selected", "true");
    await expect(within(panel).getByText(storyText(context, copy.noLinks))).toBeVisible();
    await userEvent.click(headOf(context, "subject"));

    await userEvent.click(context.canvasElement.querySelector<HTMLElement>('[data-row="r1"]')!);
    // The kept tab is Internal Communication again where it is offered.
    await expect(within(panel).getByRole("tab", { name: new RegExp(storyText(context, copy.internal)) })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(within(panel).getByRole("tab", { name: storyText(context, copy.details) }));
    await expect(headOf(context, "supplier")).toHaveAttribute("aria-expanded", "false");
    await expect(headOf(context, "subject")).toHaveAttribute("aria-expanded", "false");
    await expect(headOf(context, "scope")).toHaveAttribute("aria-expanded", "true");
  },
};

/** The arrow keys move along the tabs in the reading direction (flipped in Arabic); the panel's ↑ ↓ don't fire there. */
export const TabsKeyboard: Story = {
  play: async (context) => {
    const panel = panelOf(context);
    const [details, internal] = within(panel).getAllByRole("tab");
    details!.focus();
    await userEvent.keyboard(storyLocale(context) === "ar" ? "{ArrowLeft}" : "{ArrowRight}");
    await expect(internal).toHaveFocus();
    await expect(internal).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Home}");
    await expect(details).toHaveFocus();
  },
};

/** Every section folded, as the screenshot shows the summaries. */
export const AllFolded: Story = {
  render: (_args, context) => (
    <DetailsDemo context={context} start="r1" startCollapsed={{ subject: true, scope: true, location: true, supplier: true, links: true }} />
  ),
  play: async (context) => {
    await expect(within(panelOf(context)).getByRole("button", { name: storyText(context, copy.expandAll) })).toBeVisible();
  },
};
