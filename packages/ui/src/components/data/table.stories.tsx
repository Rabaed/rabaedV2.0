import { formatNumber, type Locale } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { expectTabFocusRing, expectTouchTarget, phone, press } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { Button } from "../button/button.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { EmptyState } from "../feedback/states.tsx";
import { Checkbox } from "../form/checkbox.tsx";
import { Badge } from "./badge.tsx";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, type TableSort } from "./table.tsx";

type Text = Record<Locale, string>;
type Submittal = { number: string; rev: number; title: Text; trade: Text; sheets: number };

const trades = {
  electrical: { en: "Electrical", ar: "كهرباء" },
  mechanical: { en: "Mechanical", ar: "ميكانيكا" },
  civil: { en: "Civil", ar: "مدني" },
};

const submittals: Submittal[] = [
  { number: "TWR-TMC-EL-MAR-041", rev: 2, title: { en: "Main switchboard", ar: "لوحة التوزيع الرئيسية" }, trade: trades.electrical, sheets: 14 },
  { number: "TWR-TMC-ME-MAR-017", rev: 0, title: { en: "Chilled water pumps", ar: "مضخات المياه المبردة" }, trade: trades.mechanical, sheets: 6 },
  { number: "TWR-TMC-CV-MAR-008", rev: 1, title: { en: "Raft foundation rebar", ar: "حديد تسليح اللبشة" }, trade: trades.civil, sheets: 112 },
];

const copy = {
  label: { en: "Submittals", ar: "الاعتمادات" },
  number: { en: "Number", ar: "الرقم" },
  title: { en: "Title", ar: "العنوان" },
  trade: { en: "Trade", ar: "التخصص" },
  sheets: { en: "Sheets", ar: "الصفحات" },
  selectAll: { en: "Select all Submittals", ar: "تحديد كل الاعتمادات" },
  emptyTitle: { en: "No Submittals yet", ar: "لا توجد اعتمادات بعد" },
  emptyBody: { en: "Submittals your Company creates or receives appear here.", ar: "تظهر هنا الاعتمادات التي تنشئها شركتك أو تستلمها." },
  create: { en: "Create a Submittal", ar: "إنشاء اعتماد" },
};

type Context = { globals: Record<string, unknown> };

function Row({ item, locale, children }: { item: Submittal; locale: Locale; children?: ReactNode }) {
  return (
    <>
      {children}
      <TableCell>
        <DocNo value={item.number} rev={item.rev} />
      </TableCell>
      <TableCell>{item.title[locale]}</TableCell>
      <TableCell>
        <Badge>{item.trade[locale]}</Badge>
      </TableCell>
      <TableCell align="end">{formatNumber(item.sheets, locale)}</TableCell>
    </>
  );
}

function Headers({ context }: { context: Context }) {
  return (
    <>
      <TableHead>{storyText(context, copy.number)}</TableHead>
      <TableHead>{storyText(context, copy.title)}</TableHead>
      <TableHead>{storyText(context, copy.trade)}</TableHead>
      <TableHead align="end">{storyText(context, copy.sheets)}</TableHead>
    </>
  );
}

const meta = {
  title: "Data/Table",
  component: Table,
  args: { label: "" },
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <Table {...args} label={storyText(context, copy.label)}>
        <TableHeader>
          <TableRow>
            <Headers context={context} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {submittals.map((item) => (
            <TableRow key={item.number}>
              <Row item={item} locale={locale} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  },
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const table = (context: PlayContext) => context.canvas.getByRole("table", { name: storyText(context, copy.label) });

/**
 * Real table roles: a named table, column headers and cells. The table fits,
 * so its region is not a tab stop (see StickyHeader and Phone for one that scrolls).
 */
export const Default: Story = {
  play: async (context) => {
    await expect(context.canvas.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(
      [copy.number, copy.title, copy.trade, copy.sheets].map((text) => storyText(context, text)),
    );
    await expect(within(table(context)).getAllByRole("row")).toHaveLength(submittals.length + 1);
    await expect(context.canvas.getByRole("cell", { name: storyText(context, submittals[1]!.title) })).toBeVisible();
    await expect(context.canvas.getByRole("region", { name: storyText(context, copy.label) })).not.toHaveAttribute("tabindex");
  },
};

/**
 * Columns run in the reading direction: Number is the leftmost column in
 * English and the rightmost in Arabic. Numbers align to the end edge (right in
 * English, left in Arabic) so they line up.
 */
export const Mirrored: Story = {
  play: async (context) => {
    const [number, title] = context.canvas.getAllByRole("columnheader").map((th) => th.getBoundingClientRect());
    const rtl = storyLocale(context) === "ar";
    await expect(rtl ? number!.left > title!.left : number!.left < title!.left).toBe(true);

    const cell = context.canvas.getByRole("cell", { name: "112" });
    const range = document.createRange();
    range.selectNodeContents(cell);
    const text = range.getBoundingClientRect();
    const box = cell.getBoundingClientRect();
    const gap = rtl ? text.left - box.left : box.right - text.right;
    // Only the cell's padding lies between the number and the end edge.
    await expect(gap).toBeLessThanOrEqual(parseFloat(getComputedStyle(cell).paddingInlineEnd) + 1);
  },
};

type SortKey = "number" | "title";

function SortableTable({ context }: { context: Context }) {
  const locale = storyLocale(context);
  const [sort, setSort] = useState<{ key: SortKey; order: Exclude<TableSort, "none"> }>({ key: "number", order: "ascending" });
  const value = (item: Submittal) => (sort.key === "number" ? item.number : item.title[locale]);
  const rows = [...submittals].sort((a, b) => value(a).localeCompare(value(b), locale) * (sort.order === "ascending" ? 1 : -1));
  const sortBy = (key: SortKey) => () =>
    setSort((current) => ({ key, order: current.key === key && current.order === "ascending" ? "descending" : "ascending" }));
  const state = (key: SortKey): TableSort => (sort.key === key ? sort.order : "none");
  return (
    <Table label={storyText(context, copy.label)}>
      <TableHeader>
        <TableRow>
          <TableHead sort={state("number")} onSort={sortBy("number")}>
            {storyText(context, copy.number)}
          </TableHead>
          <TableHead sort={state("title")} onSort={sortBy("title")}>
            {storyText(context, copy.title)}
          </TableHead>
          <TableHead>{storyText(context, copy.trade)}</TableHead>
          <TableHead align="end">{storyText(context, copy.sheets)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((item) => (
          <TableRow key={item.number}>
            <Row item={item} locale={locale} />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const firstNumber = (context: PlayContext) => within(table(context)).getAllByRole("row")[1]!.querySelector("bdi")?.textContent;

/**
 * Sortable columns: the header is a button, and `aria-sort` on the column
 * header tells screen readers the column's order as it changes. Only the
 * sorted column has an order; the others say `none`.
 */
export const Sortable: Story = {
  render: (_args, context) => <SortableTable context={context} />,
  play: async (context) => {
    const header = (text: Text) => context.canvas.getByRole("columnheader", { name: storyText(context, text) });
    const button = (text: Text) => within(header(text)).getByRole("button", { name: storyText(context, text) });
    await expect(header(copy.number)).toHaveAttribute("aria-sort", "ascending");
    await expect(header(copy.title)).toHaveAttribute("aria-sort", "none");
    await expect(header(copy.trade)).not.toHaveAttribute("aria-sort");
    await expect(firstNumber(context)).toContain("TWR-TMC-CV-MAR-008");

    await userEvent.click(button(copy.number));
    await expect(header(copy.number)).toHaveAttribute("aria-sort", "descending");
    await expect(firstNumber(context)).toContain("TWR-TMC-ME-MAR-017");

    // By keyboard: Tab from the Number button to the Title button, and Enter sorts by it.
    await expect(button(copy.number)).toHaveFocus();
    await expectTabFocusRing(button(copy.title));
    await press("Enter");
    await expect(header(copy.title)).toHaveAttribute("aria-sort", "ascending");
    await expect(header(copy.number)).toHaveAttribute("aria-sort", "none");
  },
};

function SelectableTable({ context }: { context: Context }) {
  const locale = storyLocale(context);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set([submittals[0]!.number]));
  const all = selected.size === submittals.length;
  const toggle = (number: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(number)) next.add(number);
      return next;
    });
  return (
    <Table label={storyText(context, copy.label)}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">
            <Checkbox
              aria-label={storyText(context, copy.selectAll)}
              checked={all ? true : selected.size > 0 ? "indeterminate" : false}
              onCheckedChange={() => setSelected(new Set(all ? [] : submittals.map((item) => item.number)))}
            />
          </TableHead>
          <Headers context={context} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {submittals.map((item) => (
          <TableRow key={item.number} selected={selected.has(item.number)}>
            <Row item={item} locale={locale}>
              <TableCell>
                <Checkbox aria-label={item.number} checked={selected.has(item.number)} onCheckedChange={() => toggle(item.number)} />
              </TableCell>
            </Row>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Row selection: a checkbox per row, named by its Document Number, and one in
 * the header that selects all (mixed when some are selected). Selected rows
 * are highlighted.
 */
export const Selectable: Story = {
  render: (_args, context) => <SelectableTable context={context} />,
  play: async (context) => {
    const all = context.canvas.getByRole("checkbox", { name: storyText(context, copy.selectAll) });
    const row = (index: number) => context.canvas.getByRole("checkbox", { name: submittals[index]!.number });
    await expect(row(0)).toBeChecked();
    await expect(all).toHaveAttribute("aria-checked", "mixed");

    await userEvent.click(all);
    for (const index of [0, 1, 2]) await expect(row(index)).toBeChecked();
    await expect(all).toBeChecked();

    await userEvent.click(row(1));
    await expect(row(1)).not.toBeChecked();
    // By keyboard: Space toggles the focused checkbox.
    row(1).focus();
    await userEvent.keyboard(" ");
    await expect(row(1)).toBeChecked();
    await userEvent.click(all);
    await expect(all).not.toBeChecked();
  },
};

/** With no rows, one row spans every column with an empty state. */
export const Empty: Story = {
  render: (args, context) => (
    <Table {...args} label={storyText(context, copy.label)}>
      <TableHeader>
        <TableRow>
          <Headers context={context} />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableEmpty colSpan={4}>
          <EmptyState title={storyText(context, copy.emptyTitle)} action={<Button>{storyText(context, copy.create)}</Button>}>
            {storyText(context, copy.emptyBody)}
          </EmptyState>
        </TableEmpty>
      </TableBody>
    </Table>
  ),
  play: async (context) => {
    const cells = within(table(context)).getAllByRole("cell");
    await expect(cells).toHaveLength(1);
    await expect(cells[0]).toHaveAttribute("colspan", "4");
    await expect(context.canvas.getByRole("heading", { name: storyText(context, copy.emptyTitle) })).toBeVisible();
  },
};

const manyRows = Array.from({ length: 12 }, (_, index) => ({
  ...submittals[index % submittals.length]!,
  number: `TWR-TMC-EL-MAR-${String(index + 1).padStart(3, "0")}`,
}));

/**
 * A sticky header stays in view while the rows scroll inside the table's
 * region. The region scrolls, so it takes keyboard focus: the arrow keys scroll it.
 */
export const StickyHeader: Story = {
  args: { stickyHeader: true, containerClassName: "max-h-72" },
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <Table {...args} label={storyText(context, copy.label)}>
        <TableHeader>
          <TableRow>
            <Headers context={context} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {manyRows.map((item) => (
            <TableRow key={item.number}>
              <Row item={item} locale={locale} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  },
  play: async (context) => {
    const region = context.canvas.getByRole("region", { name: storyText(context, copy.label) });
    await expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
    await waitFor(() => expect(region).toHaveAttribute("tabindex", "0"));
    await expectTabFocusRing(region);
    region.scrollTop = region.scrollHeight;
    await expect(region.scrollTop).toBeGreaterThan(0);
    const header = context.canvas.getAllByRole("columnheader")[0]!.getBoundingClientRect();
    await expect(Math.abs(header.top - region.getBoundingClientRect().top)).toBeLessThanOrEqual(1);
    region.scrollTop = 0;
  },
};

/** On a phone: the table scrolls sideways in its region (a tab stop), and checkboxes are 44px touch targets. */
export const Phone: Story = {
  parameters: phone,
  render: (_args, context) => <SelectableTable context={context} />,
  play: async (context) => {
    const region = context.canvas.getByRole("region", { name: storyText(context, copy.label) });
    await expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
    await waitFor(() => expect(region).toHaveAttribute("tabindex", "0"));
    for (const checkbox of context.canvas.getAllByRole("checkbox")) await expectTouchTarget(checkbox);
  },
};

/** On a phone: sort buttons are 44px touch targets. */
export const PhoneSortable: Story = {
  parameters: phone,
  render: (_args, context) => <SortableTable context={context} />,
  play: async (context) => {
    for (const button of context.canvas.getAllByRole("button")) await expectTouchTarget(button);
  },
};
