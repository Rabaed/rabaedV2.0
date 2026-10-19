import type { PackageSummary, PackagesFilter } from "@rabaed/domain";
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { packagesBoardLabels } from "../../storybook/packages.ts";
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
const electrical = { id: "00000000-0000-4000-8000-0000000000e1", code: "EL", name: b("Electrical", "الكهرباء") };
const mechanical = { id: "00000000-0000-4000-8000-0000000000e2", code: "ME", name: b("Mechanical", "الميكانيكا") };
const architectural = { id: "00000000-0000-4000-8000-0000000000e3", code: "AR", name: b("Architectural", "المعماري") };
const pkg = (n: number, rest: Partial<PackageSummary>): PackageSummary => ({
  id: `00000000-0000-4000-8000-0000000000f${n}`,
  projectId: project,
  number: `PKG-00${n}`,
  name: b(`Package ${n}`, `الحزمة ${n}`),
  status: "in_progress",
  owner: alFuttaim,
  trades: [],
  counts: { total: 0, open: 0, codes: {} },
  ...rest,
});

const bathrooms = pkg(1, { name: b("Bathrooms – Tower 1", "الحمامات – البرج 1"), status: "open", trades: [mechanical], counts: { total: 3, open: 3, codes: {} } });
const lighting = pkg(2, { name: b("Lighting – Podium", "الإنارة – المنصة"), trades: [electrical], counts: { total: 8, open: 5, codes: { A: 2, C: 1 } } });
// Another Contractor's own PKG-001: numbers count per owning Participant, so its Company shows beside it.
const facade = pkg(3, { number: "PKG-001", name: b("Façade – Tower 2", "الواجهة – البرج 2"), owner: nesma, trades: [architectural], counts: { total: 4, open: 1, codes: { A: 1, B: 1, D: 1 } } });
const lifts = pkg(4, { name: b("Lifts", "المصاعد"), status: "done", trades: [electrical, mechanical], counts: { total: 2, open: 0, codes: { A: 1, B: 1 } } });

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
  decorators: [(Story) => <div className="bg-canvas p-6">{Story()}</div>],
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
      // The owning Company on the number's row.
      const owner = within(card).getByText(p.owner.companyName[locale]);
      await expect(Math.abs(owner.getBoundingClientRect().top - number.getBoundingClientRect().top)).toBeLessThan(12);
      await expect(within(card).getByText(p.name[locale])).toBeVisible();
      await expect(card.querySelector("[data-package-status]")).toHaveTextContent(l.status[p.status]);
    }
  },
};

/** A card's counts are the API's, of the submittals the viewer sees: one per Review Code, and the ones still open. */
export const Counts: Story = {
  play: async (context) => {
    const l = labelsOf(context);
    const card = cardOf(context, lighting);
    await expect(card.querySelector('[data-code="A"]')).toHaveTextContent("2");
    await expect(card.querySelector('[data-code="C"]')).toHaveTextContent("1");
    await expect(card.querySelector('[data-code="B"]')).toBeNull();
    await expect(card.querySelector('[data-code="open"]')).toHaveTextContent("5");
    await expect(within(card).getByText(l.closedOf("3", "8"))).toBeVisible();
    await expect(within(card).getByRole("progressbar", { name: l.closedOf("3", "8") })).toHaveAttribute("aria-valuenow", "3");
  },
};

/**
 * A Consultant engineer narrowed to Electrical (RP-588-2): the same Package through the six
 * Electrical submittals they see, never a total of eight; its status is the one word everyone reads.
 */
export const NarrowedViewer: Story = {
  args: { packages: [pkg(7, { name: b("Bathrooms – Tower 1", "الحمامات – البرج 1"), counts: { total: 6, open: 6, codes: {} } })] },
  play: async (context) => {
    const l = labelsOf(context);
    const card = context.canvasElement.querySelector<HTMLElement>("[data-package-card]")!;
    await expect(within(card).getByText(l.closedOf("0", "6"))).toBeVisible();
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
    await expect(context.canvas.getByRole("button", { name: labelsOf(context).create.trigger })).toBeVisible();
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
    await userEvent.click(context.canvas.getByRole("button", { name: l.trigger }));
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
    await userEvent.click(context.canvas.getByRole("button", { name: l.trigger }));
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
    await expect(tradeNames).toEqual([architectural, electrical, mechanical].map((t) => `${t.name[locale]} (${t.code})`));
    await userEvent.click(within(trades).getByRole("checkbox", { name: new RegExp(escaped(electrical.name[locale])) }));
    await waitFor(() => expect(shownCards(context)).toEqual([`#${lighting.id}`, `#${lifts.id}`]));
    await userEvent.click(await screen.findByRole("tab", { name: new RegExp(escaped(f.company)) }));
    const companies = await screen.findByRole("group", { name: f.company });
    await expect(within(companies).getAllByRole("checkbox")).toHaveLength(2);
    await userEvent.click(within(companies).getByRole("checkbox", { name: nesma.companyName[locale] }));
    await waitFor(() => expect(context.canvas.getByRole("heading", { name: f.noMatchesTitle })).toBeVisible());
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
