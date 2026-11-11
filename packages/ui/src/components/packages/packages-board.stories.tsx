import type { PackageSummary, PackagesFilter } from "@rabaed/domain";
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { expectFillsTheWindow } from "../../storybook/fills-window.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { expectTouchTarget, phone, tablet, wide } from "../../storybook/form.ts";
import { overlay } from "../../storybook/overlay.ts";
import { packagesBoardLabels } from "../../storybook/packages.ts";
import { StoryProjectPage } from "../../storybook/shell.tsx";
import { viewSwitchLabels } from "../../storybook/views.ts";
import { WorkItemViewSwitch } from "../views/work-item-board.tsx";
import { PackagesBoard } from "./packages-board.tsx";

// The Packages view of the Submittals (RP-660; spec RP-616 stories 24, 29–33; the RP-633
// reference's Package card, as corrected by design/prompts/packages.md): a Kanban of the
// Packages the viewer sees in Open, In Progress and Done, each card with its PKG number left
// to right beside its owning Company, its name, status and the viewer's counts. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const labelsOf = (context: { globals: Record<string, unknown> }) => packagesBoardLabels[storyLocale(context)];

const project = "00000000-0000-4000-8000-000000000100";
const alFuttaim = { participantId: "00000000-0000-4000-8000-0000000000a1", companyName: b("Al Futtaim Contracting", "شركة الفطيم للمقاولات") };
const nesma = { participantId: "00000000-0000-4000-8000-0000000000a2", companyName: b("Nesma & Partners", "نسما وشركاه") };
const electrical = { id: "00000000-0000-4000-8000-0000000000e1", code: "EL", sort: 3, name: b("Electrical", "الكهرباء") };
const mechanical = { id: "00000000-0000-4000-8000-0000000000e2", code: "ME", sort: 2, name: b("Mechanical", "الميكانيكا") };
const architectural = { id: "00000000-0000-4000-8000-0000000000e3", code: "AR", sort: 1, name: b("Architectural", "المعماري") };
const pkg = (n: number, rest: Partial<PackageSummary>): PackageSummary => ({
  id: `00000000-0000-4000-8000-0000000000f${n}`,
  projectId: project,
  number: `PKG-00${n}`,
  name: b(`Package ${n}`, `الحزمة ${n}`),
  status: "in_progress",
  owner: alFuttaim,
  trades: [],
  counts: { total: 0, open: 0, codes: {} },
  byType: [],
  waiting: 0,
  ...rest,
});

// A Type's submittals as the board API counts them (RP-1143): of the viewer's only.
const ofType = (code: "MAR" | "SAR", s: { done?: number; replace?: number; revise?: number; open?: number }) => {
  const c = { done: 0, replace: 0, revise: 0, open: 0, ...s };
  return { typeId: code === "MAR" ? "00000000-0000-4000-8000-0000000000d1" : "00000000-0000-4000-8000-0000000000d2", code, name: code === "MAR" ? b("Material Approval Request", "طلب اعتماد مواد") : b("Supplier Approval Request", "طلب اعتماد مورّد"), total: c.done + c.replace + c.revise + c.open, ...c };
};

const bathrooms = pkg(1, { name: b("Bathrooms – Tower 1", "الحمامات – البرج 1"), status: "open", trades: [mechanical], counts: { total: 3, open: 3, codes: {} }, byType: [ofType("MAR", { open: 3 })] });
const lighting = pkg(2, { name: b("Lighting – Podium", "الإنارة – المنصة"), trades: [electrical], counts: { total: 8, open: 5, codes: { A: 2, C: 1 } }, byType: [ofType("MAR", { done: 2, revise: 1, open: 3 }), ofType("SAR", { open: 2 })], waiting: 2 });
// Another Contractor's own PKG-001: numbers count per owning Participant, so its Company shows beside it.
const facade = pkg(3, { number: "PKG-001", name: b("Façade – Tower 2", "الواجهة – البرج 2"), owner: nesma, trades: [architectural], counts: { total: 4, open: 1, codes: { A: 1, B: 1, D: 1 } }, byType: [ofType("SAR", { done: 2, replace: 1, open: 1 })] });
const lifts = pkg(4, { name: b("Lifts", "المصاعد"), status: "done", trades: [electrical, mechanical], counts: { total: 2, open: 0, codes: { A: 1, B: 1 } }, byType: [ofType("MAR", { done: 2 })] });

const meta = {
  title: "Packages/PackagesBoard",
  component: PackagesBoard,
  args: {
    packages: [bathrooms, lighting, facade, lifts],
    locale: "en",
    labels: packagesBoardLabels.en,
    packageHref: (id: string) => `#${id}`,
  },
  render: (args, context) => <PackagesBoard {...args} locale={storyLocale(context)} labels={labelsOf(context)} />,
  // A full-screen story lays out the whole page itself (FillsTheWindow).
  decorators: [(Story, context) => (context.parameters.layout === "fullscreen" ? Story() : <div className="bg-canvas p-6">{Story()}</div>)],
} satisfies Meta<typeof PackagesBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

const columnOf = (context: { canvasElement: HTMLElement }, status: string) => context.canvasElement.querySelector<HTMLElement>(`[data-package-column="${status}"]`)!;
const cardOf = (context: { canvasElement: HTMLElement }, p: PackageSummary) => context.canvasElement.querySelector<HTMLElement>(`a[href="#${p.id}"]`)!;

/**
 * The Contractor PM's board: three columns, each counting its cards; every Package the viewer
 * sees once, in its status's column, opening its page. Two Companies' PKG-001 each show their
 * owning Company beside the number.
 */
export const Board: Story = {
  play: async (context) => {
    const locale = storyLocale(context);
    const l = labelsOf(context);
    await expect(context.canvas.getByRole("region", { name: l.board })).toBeVisible();
    const headings = context.canvas.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    await expect(headings).toEqual([`${l.status.open}1`, `${l.status.in_progress}2`, `${l.status.done}1`]);
    await expect(within(columnOf(context, "open")).getAllByRole("link")).toHaveLength(1);
    await expect(within(columnOf(context, "in_progress")).getAllByRole("link")).toHaveLength(2);
    await expect(within(columnOf(context, "done")).getAllByRole("link")).toHaveLength(1);

    for (const p of [lighting, facade]) {
      const card = cardOf(context, p);
      const number = card.querySelector<HTMLElement>("[data-package-number]")!;
      await expect(number).toHaveTextContent("PKG-00");
      await expect(number).toHaveAttribute("dir", "ltr");
      await expectLaidOutLeftToRight(number);
      // The kit's card head (RP-1143): the number at the start, the status pill on its row at the end.
      const status = card.querySelector<HTMLElement>("[data-package-status]")!;
      await expect(status).toHaveTextContent(l.status[p.status]);
      await expect(Math.abs(status.getBoundingClientRect().top - number.getBoundingClientRect().top)).toBeLessThan(12);
      await expect(within(card).getByText(p.name[locale])).toBeVisible();
      // Its owning Company on every card, in the footer (numbers repeat between Companies), by name only (V14).
      await expect(within(card).getByText(p.owner.companyName[locale])).toBeVisible();
    }
  },
};

/**
 * A card's ledger by Type (RP-1143, the kit's "D type ledger"): per Type of the submittals the
 * viewer sees, closed (Code A, B or D) of total and a segment per submittal by state; the card's
 * closed share counts a Code C as still to close. "Waiting for your action" when any wait on them.
 */
export const TypeLedger: Story = {
  play: async (context) => {
    const l = labelsOf(context);
    const card = cardOf(context, lighting);
    const ledger = within(card).getByRole("list", { name: l.byType });
    const rows = within(ledger).getAllByRole("listitem");
    await expect(rows.map((r) => r.getAttribute("data-type"))).toEqual(["MAR", "SAR"]);
    await expect(within(rows[0]!).getByText(l.closedOf("2", "6"))).toBeInTheDocument();
    await expect(within(rows[1]!).getByText(l.closedOf("0", "2"))).toBeInTheDocument();
    // One segment per submittal, coloured by its state.
    const segments = [...rows[0]!.querySelectorAll("[data-state]")].map((s) => s.getAttribute("data-state"));
    await expect(segments).toEqual(["done", "done", "revise", "open", "open", "open"]);
    await expect(within(card).getByRole("progressbar", { name: l.closedOf("2", "8") })).toHaveAttribute("aria-valuenow", "2");
    await expect(card.querySelector("[data-package-waiting]")).toHaveTextContent(l.waiting("2", 2));
    // A Code D counts as closed, in red.
    const facadeCard = cardOf(context, facade);
    await expect(within(facadeCard).getByRole("progressbar", { name: l.closedOf("3", "4") })).toHaveAttribute("aria-valuenow", "3");
    await expect(facadeCard.querySelectorAll('[data-state="replace"]')).toHaveLength(1);
    // Nothing waits on the viewer there: no pill.
    await expect(facadeCard.querySelector("[data-package-waiting]")).toBeNull();
  },
};

/** A Package with no submittal the viewer sees says so where its ledger would be. */
export const NoSubmittalsYet: Story = {
  args: { packages: [pkg(8, { status: "open" })] },
  play: async (context) => {
    const card = context.canvasElement.querySelector<HTMLElement>("[data-package-card]")!;
    await expect(within(card).getByText(labelsOf(context).noSubmittals)).toBeVisible();
    await expect(card.querySelector("[data-type-ledger]")).toBeNull();
  },
};

/**
 * A Consultant engineer narrowed to Electrical (RP-588-2): the same Package through the six
 * Electrical submittals they see, never a total of eight; its status is the one word everyone reads.
 */
export const NarrowedViewer: Story = {
  args: { packages: [pkg(7, { name: b("Bathrooms – Tower 1", "الحمامات – البرج 1"), counts: { total: 6, open: 6, codes: {} }, byType: [ofType("MAR", { open: 6 })] })] },
  play: async (context) => {
    const l = labelsOf(context);
    const card = context.canvasElement.querySelector<HTMLElement>("[data-package-card]")!;
    await expect(within(card).getAllByText(l.closedOf("0", "6")).length).toBeGreaterThan(0);
    await expect(card).not.toHaveTextContent(/\b8\b/);
    await expect(card.querySelector("[data-package-status]")).toHaveTextContent(l.status.in_progress);
  },
};

/** No Package the viewer sees: each column says so. */
export const Empty: Story = {
  args: { packages: [] },
  play: async (context) => {
    const l = labelsOf(context);
    await expect(context.canvas.getAllByText(l.noPackages)).toHaveLength(3);
    await expect(context.canvas.queryAllByRole("link")).toHaveLength(0);
  },
};

/** The toolbar: "+ New Package" for a Company that can build one, and the View switch with Packages beside List and Kanban. */
export const WithToolbar: Story = {
  args: { onCreate: fn(async () => ({ ok: true as const })) },
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <PackagesBoard
        {...args}
        locale={locale}
        labels={labelsOf(context)}
        viewSwitch={
          <WorkItemViewSwitch
            view="packages"
            views={["kanban", "list", "packages"]}
            labels={viewSwitchLabels[locale]}
            hrefFor={(v) => `?view=${v}`}
          />
        }
      />
    );
  },
  play: async (context) => {
    const locale = storyLocale(context);
    const views = context.canvas.getByRole("navigation", { name: viewSwitchLabels[locale].view });
    const links = within(views).getAllByRole("link");
    await expect(links.map((a) => a.textContent)).toEqual([viewSwitchLabels[locale].kanban, viewSwitchLabels[locale].list, viewSwitchLabels[locale].packages]);
    await expect(within(views).getByRole("link", { name: viewSwitchLabels[locale].packages })).toHaveAttribute("aria-current", "page");
    await expect(within(views).getByRole("link", { name: viewSwitchLabels[locale].packages })).toHaveAttribute("href", "?view=packages");
    await expect(within(context.canvas.getByRole("region", { name: labelsOf(context).toolbar })).getByRole("button", { name: labelsOf(context).create.trigger })).toBeVisible();
    // The line under the toolbar: when a Package is Done.
    await expect(context.canvas.getByRole("note")).toHaveTextContent(labelsOf(context).doneRule);
    // The Open column's "+" opens the same New Package dialog.
    const plus = columnOf(context, "open").querySelector<HTMLElement>("[data-column-new]")!;
    await expect(plus).toHaveAccessibleName(labelsOf(context).create.trigger);
    await expect(columnOf(context, "in_progress").querySelector("[data-column-new]")).toBeNull();
  },
};

// Twelve Packages in progress: a column taller than the window.
const manyInProgress = Array.from({ length: 12 }, (_, i) => ({ ...lighting, id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, number: `PKG-1${String(i).padStart(2, "0")}`, name: b(`Lighting – Level ${i + 1}`, `الإنارة – الطابق ${i + 1}`) }));

/**
 * On its page (RP-1135, as RP-1092's boards), the Packages board fills the window from under
 * its toolbar to the bottom edge, so its sideways scrollbar sits on that edge, not under the
 * tallest column. The board scrolls down inside itself, and the page doesn't scroll.
 */
export const FillsTheWindow: Story = {
  ...WithToolbar,
  parameters: { ...overlay, layout: "fullscreen" },
  args: { ...WithToolbar.args, packages: [bathrooms, lighting, facade, lifts, ...manyInProgress] },
  render: (args, context) => <StoryProjectPage context={context} current="submittals">{WithToolbar.render!(args, context)}</StoryProjectPage>,
  play: async (context) => {
    const labels = labelsOf(context);
    await expectFillsTheWindow(context.canvas.getByRole("region", { name: labels.board }), context.canvas.getByRole("region", { name: labels.toolbar }));
  },
};

/** No "+ New Package" without the call: a Company that builds none (e.g. the Consultant). */
export const WithoutNewPackage: Story = {
  play: async (context) => {
    await expect(context.canvas.queryByRole("button", { name: labelsOf(context).create.trigger })).toBeNull();
  },
};

/** "+ New Package": its name in English and Arabic, both needed; created, the call gets both. */
export const NewPackage: Story = {
  parameters: { overlay: true },
  args: { onCreate: fn(async () => ({ ok: true as const })) },
  play: async (context) => {
    const l = labelsOf(context).create;
    await userEvent.click(within(context.canvas.getByRole("region", { name: labelsOf(context).toolbar })).getByRole("button", { name: l.trigger }));
    const dialog = await screen.findByRole("dialog", { name: l.title });
    await userEvent.click(within(dialog).getByRole("button", { name: l.save }));
    await expect(within(dialog).getByRole("alert")).toHaveTextContent(l.required);
    await expect(context.args.onCreate).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(new RegExp(escaped(l.nameEn))), "Kitchens");
    await userEvent.type(within(dialog).getByLabelText(new RegExp(escaped(l.nameAr))), "المطابخ");
    await userEvent.click(within(dialog).getByRole("button", { name: l.save }));
    await waitFor(() => expect(context.args.onCreate).toHaveBeenCalledWith({ en: "Kitchens", ar: "المطابخ" }));
  },
};

/** A refused create says why, in the dialog. */
export const NewPackageRefused: Story = {
  parameters: { overlay: true },
  args: { onCreate: fn(async () => ({ ok: false as const, reason: "project_closed" })) },
  play: async (context) => {
    const labels = labelsOf(context);
    const l = labels.create;
    await userEvent.click(within(context.canvas.getByRole("region", { name: labelsOf(context).toolbar })).getByRole("button", { name: l.trigger }));
    const dialog = await screen.findByRole("dialog", { name: l.title });
    await userEvent.type(within(dialog).getByLabelText(new RegExp(escaped(l.nameEn))), "Kitchens");
    await userEvent.type(within(dialog).getByLabelText(new RegExp(escaped(l.nameAr))), "المطابخ");
    await userEvent.click(within(dialog).getByRole("button", { name: l.save }));
    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(labels.refusals.project_closed!);
  },
};

/** The board with its search and filters, kept as a page would keep them (its URL). */
function FilteredBoard(props: Parameters<typeof PackagesBoard>[0]) {
  const [filter, setFilter] = useState<PackagesFilter>(props.filter ?? { trade: [], company: [] });
  return <PackagesBoard {...props} filter={filter} onFilterChange={setFilter} />;
}
const filterOf = (context: { globals: Record<string, unknown> }) => labelsOf(context).filter;
const shownCards = (context: { canvasElement: HTMLElement }) =>
  [...context.canvasElement.querySelectorAll<HTMLElement>("[data-package-card]")].map((a) => a.getAttribute("href"));

/**
 * The search (RP-953): by the PKG number, whatever its case, or by the name in either
 * language; each column counts only the Packages it finds.
 */
export const Search: Story = {
  render: (args, context) => <FilteredBoard {...args} locale={storyLocale(context)} labels={labelsOf(context)} />,
  play: async (context) => {
    const f = filterOf(context);
    const search = () => context.canvas.getByRole("searchbox", { name: f.search });
    await userEvent.type(search(), "pkg-001{Enter}");
    await waitFor(() => expect(shownCards(context)).toEqual([`#${bathrooms.id}`, `#${facade.id}`]));
    // A new search is a new box (its key), showing its own words.
    await expect(search()).toHaveValue("pkg-001");
    await userEvent.clear(search());
    await userEvent.type(search(), "المنصة{Enter}");
    await waitFor(() => expect(shownCards(context)).toEqual([`#${lighting.id}`]));
    const l = labelsOf(context);
    await expect(context.canvas.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([`${l.status.open}0`, `${l.status.in_progress}1`, `${l.status.done}0`]);
  },
};

/**
 * The Filter panel: Trade and owning Company, their choices only those of the Packages given
 * (the viewer's), each once; a Trade keeps the Packages with a submittal of it.
 */
export const FilterByTradeAndCompany: Story = {
  parameters: { overlay: true },
  render: (args, context) => <FilteredBoard {...args} locale={storyLocale(context)} labels={labelsOf(context)} />,
  play: async (context) => {
    const locale = storyLocale(context);
    const f = filterOf(context);
    await userEvent.click(context.canvas.getByRole("button", { name: new RegExp(escaped(f.filters)) }));
    const trades = await screen.findByRole("group", { name: f.trade });
    const tradeNames = within(trades).getAllByRole("checkbox").map((c) => c.textContent);
    // In the Project's own order of Trades, not by code.
    await expect(tradeNames).toEqual([architectural, mechanical, electrical].map((t) => `${t.name[locale]} (${t.code})`));
    await userEvent.click(within(trades).getByRole("checkbox", { name: new RegExp(escaped(electrical.name[locale])) }));
    await waitFor(() => expect(shownCards(context)).toEqual([`#${lighting.id}`, `#${lifts.id}`]));
    await userEvent.click(await screen.findByRole("tab", { name: new RegExp(escaped(f.company)) }));
    const companies = await screen.findByRole("group", { name: f.company });
    await expect(within(companies).getAllByRole("checkbox")).toHaveLength(2);
    await userEvent.click(within(companies).getByRole("checkbox", { name: nesma.companyName[locale] }));
    await waitFor(() => expect(context.canvas.getByRole("heading", { name: f.noMatchesTitle })).toBeVisible());
  },
};

/** "Need my action" (RP-1143): only the Packages with a submittal waiting on the viewer; the × turns it off too. */
export const NeedMyAction: Story = {
  render: (args, context) => <FilteredBoard {...args} locale={storyLocale(context)} labels={labelsOf(context)} />,
  play: async (context) => {
    const f = filterOf(context);
    await userEvent.click(context.canvas.getByRole("switch", { name: f.mine }));
    await waitFor(() => expect(shownCards(context)).toEqual([`#${lighting.id}`]));
    await userEvent.click(context.canvas.getByRole("button", { name: f.clear }));
    await waitFor(() => expect(shownCards(context)).toHaveLength(4));
    await expect(context.canvas.getByRole("switch", { name: f.mine })).not.toBeChecked();
  },
};

/**
 * The List of Packages (RP-1143, the kit's List): a row per Package with its progress, its
 * submittals by Type and by state, what waits on the viewer and its owning Company; never a
 * Target, a creator or a receiver. The name opens its page; the choice is kept with the filters.
 */
export const ListOfPackages: Story = {
  render: (args, context) => <FilteredBoard {...args} locale={storyLocale(context)} labels={labelsOf(context)} />,
  play: async (context) => {
    const l = labelsOf(context);
    const locale = storyLocale(context);
    await userEvent.click(context.canvas.getByRole("radio", { name: l.show.list }));
    const table = within(await context.canvas.findByRole("region", { name: l.list.table }));
    const headers = table.getAllByRole("columnheader").map((h) => h.textContent);
    await expect(headers).toEqual(expect.arrayContaining([l.list.number, l.list.name, l.list.progress, l.list.state.done, l.list.state.replace, l.list.state.revise, l.list.state.open, l.list.waiting, l.list.owner]));
    await expect(context.canvas.queryByRole("region", { name: l.board })).toBeNull();
    const row = context.canvasElement.querySelector<HTMLElement>(`[data-package-row="${lighting.id}"]`)!;
    await expect(within(row).getByRole("link", { name: lighting.name[locale] })).toHaveAttribute("href", `#${lighting.id}`);
    await expect(row.querySelector('td[data-state="revise"]')).toHaveTextContent("1");
    // Its Types as chips in the Progress cell, each with its count (no column per Type, so the table fits 1366).
    await expect([...row.querySelectorAll("[data-type]")].map((c) => c.getAttribute("data-type"))).toEqual(["MAR", "SAR"]);
    await expect(row.querySelector("[data-package-waiting]")).toHaveTextContent("2");
    await expect(within(row).getByText(lighting.owner.companyName[locale])).toBeVisible();
    // Back to the board; Cards / Table never counts as a filter.
    await expect(context.canvas.queryByRole("button", { name: filterOf(context).clear })).toBeNull();
    await userEvent.click(context.canvas.getByRole("radio", { name: l.show.board }));
    await expect(await context.canvas.findByRole("region", { name: l.board })).toBeVisible();
  },
};

/** The Packages view as its page draws it (RP-1272's shell): "+ New Package", the search and filters, Cards / Table and the View switch. */
function OnItsPage({ args, context }: { args: Parameters<typeof PackagesBoard>[0]; context: Parameters<NonNullable<Story["render"]>>[1] }) {
  const locale = storyLocale(context);
  return (
    <StoryProjectPage context={context} current="submittals">
      <FilteredBoard
        {...args}
        locale={locale}
        labels={labelsOf(context)}
        onCreate={fn(async () => ({ ok: true as const }))}
        viewSwitch={<WorkItemViewSwitch view="packages" views={["kanban", "list", "packages"]} labels={viewSwitchLabels[locale]} hrefFor={(v) => `?view=${v}`} />}
      />
    </StoryProjectPage>
  );
}

const toolbarOf = (context: { canvas: ReturnType<typeof within>; globals: Record<string, unknown> }) => context.canvas.getByRole("region", { name: labelsOf(context).toolbar });
const actionBarOf = (context: { canvasElement: HTMLElement }) => context.canvasElement.querySelector<HTMLElement>("[data-action-bar]");
const topOf = (element: Element) => Math.round(element.getBoundingClientRect().top);
const middleOf = (element: Element) => Math.round(element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2);
const listShown = { trade: [], company: [], show: "list" as const };

/** The page never scrolls sideways: the board and the table scroll inside their own areas. */
async function expectNoSidewaysPage() {
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
}

/**
 * The toolbar on a phone (RP-1277, gap-table row 66, as the List's: RP-1273): Search and Filter
 * share the first row; Need My Action and Cards / Table the second; the View switch the third. Each
 * control 44 high. "+ New Package" is not in the toolbar but in the bottom action bar (RP-1272).
 */
async function expectPhoneToolbar(context: Parameters<NonNullable<Story["play"]>>[0]) {
  const l = labelsOf(context);
  const toolbar = within(toolbarOf(context));
  const search = toolbar.getByRole("search").querySelector("label")!;
  const filter = toolbar.getByRole("button", { name: new RegExp(`^${escaped(l.filter.filters)}`) });
  const mine = toolbar.getByRole("switch", { name: l.filter.mine }).closest("label")!;
  const show = toolbar.getByRole("radiogroup", { name: l.show.label });
  const views = toolbar.getByRole("navigation", { name: viewSwitchLabels[storyLocale(context)].view });
  await expect(topOf(filter)).toBe(topOf(search));
  await expect(Math.abs(middleOf(show) - middleOf(mine))).toBeLessThanOrEqual(1);
  await expect(topOf(mine)).toBeGreaterThan(topOf(filter));
  // The View switch on a row of its own, under Cards / Table: the toolbar's last control, wholly below the row above.
  await expect(views.getBoundingClientRect().top).toBeGreaterThanOrEqual(show.getBoundingClientRect().bottom);
  for (const control of [search, filter, mine]) await expect(control.getBoundingClientRect().height).toBe(44);
  for (const control of [show, views]) await expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await expectTouchTarget(toolbar.getByRole("switch", { name: l.filter.mine }));
  // In the window's width: nothing pushed past its edge.
  for (const control of [search, filter, mine, show, views]) {
    const box = control.getBoundingClientRect();
    await expect(box.left).toBeGreaterThanOrEqual(0);
    await expect(box.right).toBeLessThanOrEqual(innerWidth);
  }
  await expect(toolbar.queryByRole("button", { name: l.create.trigger })).toBeNull();
  const bar = await waitFor(() => {
    const element = actionBarOf(context);
    expect(element).not.toBeNull();
    return element!;
  });
  const create = await within(bar).findByRole("button", { name: l.create.trigger });
  // Full width in the bar, less its padding.
  await expect(create.getBoundingClientRect().width).toBeGreaterThan(innerWidth - 40);
}

/** On a tablet (and wider) "+ New Package" stays at the toolbar's start and there is no bottom action bar. */
async function expectTabletToolbar(context: Parameters<NonNullable<Story["play"]>>[0]) {
  const l = labelsOf(context);
  await expect(within(toolbarOf(context)).getByRole("button", { name: l.create.trigger })).toBeVisible();
  await expect(actionBarOf(context)).toBeNull();
}

/**
 * The Packages view on a phone (RP-1277; the Review's 402 frame, screenshot 32): the toolbar in three
 * short rows, "+ New Package" in the bottom action bar, and the board one column with the next peeking
 * (row 67); the page never scrolls sideways.
 */
export const OnAPhone: Story = {
  parameters: { ...phone, layout: "fullscreen" },
  render: (args, context) => <OnItsPage args={args} context={context} />,
  play: async (context) => {
    await expectPhoneToolbar(context);
    // Row 67: the first column on screen whole, the next one peeking in from the inline end.
    const first = columnOf(context, "open").getBoundingClientRect();
    const next = columnOf(context, "in_progress").getBoundingClientRect();
    await expect(first.left).toBeGreaterThanOrEqual(0);
    await expect(first.right).toBeLessThanOrEqual(innerWidth);
    const peek = storyLocale(context) === "ar" ? next.right : innerWidth - next.left;
    await expect(peek).toBeGreaterThan(0);
    await expect(peek).toBeLessThan(next.width);
    await expectNoSidewaysPage();
  },
};

/** The table of Packages on a phone: the same toolbar; the table scrolls sideways inside its own area. */
export const TableOnAPhone: Story = {
  parameters: { ...phone, layout: "fullscreen" },
  args: { filter: listShown },
  render: (args, context) => <OnItsPage args={args} context={context} />,
  play: async (context) => {
    await expectPhoneToolbar(context);
    const table = context.canvas.getByRole("region", { name: labelsOf(context).list.table });
    await expect(table).toBeVisible();
    // Wider than the phone: it scrolls inside its own area, inside the window.
    await expect(getComputedStyle(table).overflowX).toBe("auto");
    await expect(table.scrollWidth).toBeGreaterThan(table.clientWidth);
    await expect(table.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth);
    await expectNoSidewaysPage();
  },
};

/** The Packages view at 820 (the Tablet Flow's screenshot 16): the toolbar as on a desktop, "+ New Package" in it. */
export const OnATablet: Story = {
  parameters: { ...tablet, layout: "fullscreen" },
  render: (args, context) => <OnItsPage args={args} context={context} />,
  play: async (context) => {
    await expectTabletToolbar(context);
    await expectNoSidewaysPage();
  },
};

/** The table of Packages at 820. */
export const TableOnATablet: Story = {
  parameters: { ...tablet, layout: "fullscreen" },
  args: { filter: listShown },
  render: (args, context) => <OnItsPage args={args} context={context} />,
  play: async (context) => {
    await expectTabletToolbar(context);
    await expect(context.canvas.getByRole("region", { name: labelsOf(context).list.table })).toBeVisible();
    await expectNoSidewaysPage();
  },
};

/** At 1366 the toolbar is one row, as before RP-1277. */
export const OnALaptop: Story = {
  parameters: { ...wide, layout: "fullscreen" },
  render: (args, context) => <OnItsPage args={args} context={context} />,
  play: async (context) => {
    await expectTabletToolbar(context);
    const toolbar = within(toolbarOf(context));
    const create = toolbar.getByRole("button", { name: labelsOf(context).create.trigger });
    const views = toolbar.getByRole("navigation", { name: viewSwitchLabels[storyLocale(context)].view });
    await expect(Math.abs(topOf(views) - topOf(create))).toBeLessThanOrEqual(6);
  },
};

/** On a phone the Filter panel opens from the bottom of the screen (RP-1273's FilterMenu). Left open for the screenshot. */
export const FilterOnAPhone: Story = {
  parameters: { ...phone, ...overlay },
  render: (args, context) => <FilteredBoard {...args} locale={storyLocale(context)} labels={labelsOf(context)} />,
  play: async (context) => {
    const f = filterOf(context);
    await userEvent.click(context.canvas.getByRole("button", { name: new RegExp(`^${escaped(f.filters)}`) }));
    const sheet = await screen.findByRole("dialog", { name: f.filters });
    await expect(sheet.getBoundingClientRect().bottom).toBe(innerHeight);
    await expect(within(sheet).getByRole("group", { name: f.trade })).toBeInTheDocument();
  },
};

/** Nothing found: one message, and the × clears the search and every filter. */
export const NoMatches: Story = {
  args: { filter: { q: "zzz", trade: [], company: [] } },
  render: (args, context) => <FilteredBoard {...args} locale={storyLocale(context)} labels={labelsOf(context)} />,
  play: async (context) => {
    const f = filterOf(context);
    await expect(context.canvas.getByRole("heading", { name: f.noMatchesTitle })).toBeVisible();
    await expect(context.canvas.queryByRole("region", { name: labelsOf(context).board })).toBeNull();
    await userEvent.click(context.canvas.getByRole("button", { name: f.clear }));
    await waitFor(() => expect(shownCards(context)).toHaveLength(4));
    await expect(context.canvas.getByRole("searchbox", { name: f.search })).toHaveValue("");
  },
};
