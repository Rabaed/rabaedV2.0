import { formatNumber } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { NumberedPager, type NumberedPagerProps } from "./numbered-pager.tsx";

// The List's numbered pager (RP-409, the owner's design), on its own. Story copy only.
const b = (en: string, ar: string) => ({ en, ar });
const labels = {
  en: { pages: "Pages", rowsPerPage: "Rows per page", first: "First page", previous: "Previous page", next: "Next page", last: "Last page", page: (p: string) => `Page ${p}` },
  ar: { pages: "الصفحات", rowsPerPage: "صفوف في الصفحة", first: "الصفحة الأولى", previous: "الصفحة السابقة", next: "الصفحة التالية", last: "الصفحة الأخيرة", page: (p: string) => `صفحة ${p}` },
};

const meta = {
  title: "List/NumberedPager",
  component: NumberedPager,
  args: {
    page: 10,
    lastPage: 20,
    hasNext: true,
    pageSize: 25,
    pageSizes: [10, 25, 50],
    summary: "Page 10 of 20 · 487 submittals",
    labels: labels.en,
    number: (n: number) => formatNumber(n, "en"),
    hrefFor: (p: number) => `?page=${p}`,
    onPageSize: fn<NumberedPagerProps["onPageSize"]>(),
  },
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <div className="rounded-md border border-border bg-surface">
        <NumberedPager
          {...args}
          labels={labels[locale]}
          number={(n) => formatNumber(n, locale)}
          summary={args.summary && storyText(context, b(args.summary, args.lastPage === null ? "صفحة 3" : "صفحة 10 من 20 · 487 تقديم"))}
        />
      </div>
    );
  },
} satisfies Meta<typeof NumberedPager>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Many pages: the first, the last and the ones around this, with gaps; this page is filled. */
export const ManyPages: Story = {
  play: async (context) => {
    const nav = within(context.canvas.getByRole("navigation", { name: storyText(context, b("Pages", "الصفحات")) }));
    await expect(nav.getAllByText("…")).toHaveLength(2);
    await expect(nav.getByRole("link", { name: storyText(context, b("Last page", "الصفحة الأخيرة")) })).toHaveAttribute("href", "?page=20");
    await expect(nav.getByText(storyText(context, b("Page 10", "صفحة 10")), { selector: "[aria-current=page] *" })).toBeInTheDocument();
  },
};

/** Under a search: no last page and no total, the pages read so far and the next. */
export const UnderASearch: Story = {
  args: { page: 3, lastPage: null, hasNext: true, summary: "Page 3" },
  play: async (context) => {
    const nav = within(context.canvas.getByRole("navigation", { name: storyText(context, b("Pages", "الصفحات")) }));
    await expect(nav.queryByRole("link", { name: storyText(context, b("Last page", "الصفحة الأخيرة")) })).toBeNull();
    await expect(nav.getByRole("link", { name: storyText(context, b("Page 4", "صفحة 4")) })).toBeVisible();
  },
};

/** On a phone the pager wraps under the rows per page, every button a full touch target. */
export const OnAPhone: Story = { parameters: phone };
