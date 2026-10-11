import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { formatNumber } from "@rabaed/domain";
import { phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { buttonVariants } from "../button/button.tsx";
import { Badge } from "../data/badge.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../data/table.tsx";
import { Icon } from "../icon/icon.tsx";
import { FilterChoices, FilterMenu } from "./filter-menu.tsx";
import { ListToolbar, ToolbarSearch, ToolbarSwitch } from "./list-toolbar.tsx";
import { Pager, TableCard } from "./table-card.tsx";

// The data list page template (RP-409) from its pieces, with plain story data:
// a register of Drawings. The Submittals List (`WorkItemList`) is built the
// same way; the Kanban (RP-410) and Members (RP-413) reuse the pieces.

const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  toolbar: b("Filters and sort", "التصفية والترتيب"),
  add: b("Add Drawing", "إضافة مخطط"),
  search: b("Search", "بحث"),
  placeholder: b("Search this list", "ابحث في القائمة"),
  filters: b("Filters", "التصفية"),
  clearAll: b("Clear all", "مسح الكل"),
  done: b("Done", "تم"),
  close: b("Close", "إغلاق"),
  all: b("All", "الكل"),
  discipline: b("Discipline", "التخصص"),
  sheetSize: b("Sheet size", "حجم اللوحة"),
  current: b("Current only", "الحالية فقط"),
  table: b("Drawings", "المخططات"),
  number: b("Drawing number", "رقم المخطط"),
  name: b("Drawing", "المخطط"),
  pages: b("Pages", "الصفحات"),
  first: b("First page", "الصفحة الأولى"),
  previous: b("Previous page", "الصفحة السابقة"),
  next: b("Next page", "الصفحة التالية"),
  summary: b("Page 1 of 4 · 180 drawings", "صفحة 1 من 4 · 180 مخططًا"),
};

const disciplines = [
  { value: "AR", label: b("Architecture", "معماري") },
  { value: "ST", label: b("Structure", "إنشائي") },
  { value: "EL", label: b("Electrical", "كهرباء") },
];
const rows = [
  { number: "TWR-AR-DWG-0101", name: b("Ground floor plan", "مخطط الطابق الأرضي"), discipline: "AR" },
  { number: "TWR-ST-DWG-0201", name: b("Foundation layout", "مخطط الأساسات"), discipline: "ST" },
  { number: "TWR-EL-DWG-0301", name: b("Lighting layout, Level 3", "مخطط الإنارة، الطابق 3"), discipline: "EL" },
];

type Args = { onClearAll: () => void; onSearch: (words: string | undefined) => void };

function DrawingsPage({ context, args }: { context: StoryContext; args: Args }) {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  const locale = storyLocale(context);
  const [discipline, setDiscipline] = useState<string | undefined>("AR");
  const [current, setCurrent] = useState(true);
  return (
    <div className="flex flex-col gap-4 p-4">
      <ListToolbar
        label={t(copy.toolbar)}
        end={<Badge>{t(copy.table)}</Badge>}
      >
        <a href="#add" className={buttonVariants()}>
          <Icon name="plus" />
          {t(copy.add)}
        </a>
        <ToolbarSearch label={t(copy.search)} placeholder={t(copy.placeholder)} value={undefined} onSearch={args.onSearch} />
        <FilterMenu
          labels={{
            filters: t(copy.filters),
            clearAll: t(copy.clearAll),
            done: t(copy.done),
            close: t(copy.close),
            applied: (n, count) => (locale === "ar" ? `${n} تصفية مطبقة` : `${n} ${count === 1 ? "filter" : "filters"} applied`),
            number: (n) => formatNumber(n, locale),
          }}
          onClearAll={args.onClearAll}
          fields={[
            {
              key: "discipline",
              label: t(copy.discipline),
              count: discipline ? 1 : 0,
              content: (
                <FilterChoices
                  label={t(copy.discipline)}
                  allLabel={t(copy.all)}
                  value={discipline}
                  choices={disciplines.map((d) => ({ value: d.value, label: t(d.label) }))}
                  onChange={setDiscipline}
                />
              ),
            },
            {
              key: "size",
              label: t(copy.sheetSize),
              count: 0,
              content: (
                <FilterChoices
                  label={t(copy.sheetSize)}
                  allLabel={t(copy.all)}
                  value={undefined}
                  choices={["A0", "A1", "A3"].map((s) => ({ value: s, label: s }))}
                  onChange={() => {}}
                />
              ),
            },
          ]}
        />
        <ToolbarSwitch label={t(copy.current)} checked={current} onCheckedChange={setCurrent} />
      </ListToolbar>
      <TableCard
        footer={
          <Pager
            labels={{ pages: t(copy.pages), first: t(copy.first), previous: t(copy.previous), next: t(copy.next) }}
            summary={t(copy.summary)}
            next="#page-2"
          />
        }
      >
        <Table label={t(copy.table)} className="w-max min-w-full text-sm">
          <TableHeader>
            <TableRow>
              <TableHead sort="ascending" onSort={() => {}}>
                {t(copy.number)}
              </TableHead>
              <TableHead>{t(copy.name)}</TableHead>
              <TableHead>{t(copy.discipline)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.number}>
                <TableCell>
                  <bdi dir="ltr">{r.number}</bdi>
                </TableCell>
                <TableCell className="font-semibold whitespace-nowrap">{t(r.name)}</TableCell>
                <TableCell>
                  <Badge>{t(disciplines.find((d) => d.value === r.discipline)!.label)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}

const meta = {
  title: "List/DataListPage",
  args: { onClearAll: fn(), onSearch: fn() },
  render: (args, context) => <DrawingsPage context={context} args={args} />,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The template: the toolbar (primary action, search, Filters with the number
 * applied, a switch, an end slot), the table in its card, and the pager on the
 * first page: no way back, on to the next.
 */
export const Default: Story = {
  play: async (context) => {
    await expect(context.canvas.getByRole("region", { name: storyText(context, copy.toolbar) })).toBeVisible();
    await expect(context.canvas.getByRole("button", { name: `${storyText(context, copy.filters)} 1` })).toBeVisible();
    const pager = within(context.canvas.getByRole("navigation", { name: storyText(context, copy.pages) }));
    await expect(pager.queryByRole("link", { name: storyText(context, copy.first) })).toBeNull();
    await expect(pager.queryByRole("link", { name: storyText(context, copy.previous) })).toBeNull();
    await expect(pager.getByRole("link", { name: storyText(context, copy.next) })).toHaveAttribute("href", "#page-2");
    await expect(pager.getByText(storyText(context, copy.summary))).toBeVisible();
  },
};

/** The filter popover: fields on the start side with their counts, the chosen field's values beside them. Left open. */
export const FiltersOpen: Story = {
  parameters: overlay,
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("button", { name: `${storyText(context, copy.filters)} 1` }));
    const panel = await screen.findByRole("dialog", { name: storyText(context, copy.filters) });
    const tab = within(panel).getByRole("tab", { name: `${storyText(context, copy.discipline)} 1` });
    await expect(tab).toHaveAttribute("aria-selected", "true");
    const choices = within(within(panel).getByRole("group", { name: storyText(context, copy.discipline) })).getAllByRole("button");
    await expect(choices.map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "true", "false", "false"]);
    await userEvent.click(within(panel).getByRole("button", { name: storyText(context, copy.clearAll) }));
    await expect(context.args.onClearAll).toHaveBeenCalled();
  },
};

/** On a phone: the toolbar wraps, the search takes the width, and nothing scrolls the page sideways. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    const box = context.canvas.getByRole("searchbox", { name: storyText(context, copy.search) });
    await expect(box.getBoundingClientRect().width).toBeGreaterThan(250);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
    await userEvent.type(box, "plan{enter}");
    await expect(context.args.onSearch).toHaveBeenCalledWith("plan");
  },
};
