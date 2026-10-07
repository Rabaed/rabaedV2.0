import type { LinkSearchResults, LinkTarget, Locale } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { linkSearchLabels } from "../../storybook/form-engine.ts";
import { Field } from "../form/field.tsx";
import { LinkSearch } from "./link-search.tsx";

// Link search (RP-290, spec RP-289): find a Submitted item you can see by part of
// its Document Number or Subject, to link it. The page passes a `search` that
// calls the Link search API; these stories search a fixed list instead. Story
// data only: the API decides what a Member may be offered.
const subjects: Record<Locale, string[]> = {
  en: ["Cable trays, galvanised", "Cable glands", "Lighting fixtures", "Switchgear panels", "Cable ladders"],
  ar: ["حوامل الكابلات المجلفنة", "جلب الكابلات", "وحدات الإنارة", "لوحات المفاتيح", "سلالم الكابلات"],
};
const numbers = ["TWR-MAR-EL-0012", "TWR-MAR-EL-0009", "TWR-MAR-EL-0007", "TWR-MAR-EL-0004", "TWR-MAR-EL-0002"];
const targets = (locale: Locale): LinkTarget[] =>
  numbers.map((documentNumber, i) => ({
    id: `00000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, "0")}`,
    documentNumber,
    subject: subjects[locale][i]!,
  }));

/** Searches the story's items as the API does: part of the number or Subject, any case, `pageSize` at a time. */
const searchOf =
  (locale: Locale, pageSize = 20) =>
  async (query: string, page: number): Promise<LinkSearchResults> => {
    const q = query.toLowerCase();
    const matches = targets(locale).filter((t) => t.documentNumber.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q));
    const links = matches.slice((page - 1) * pageSize, page * pageSize);
    return { links, nextPage: matches.length > page * pageSize ? page + 1 : null };
  };

const copy = {
  label: { en: "Find an item to link", ar: "ابحث عن بند لربطه" },
  hint: { en: "Type part of a Document Number or Subject.", ar: "اكتب جزءًا من رقم المستند أو الموضوع." },
  cable: { en: "cable", ar: "الكابلات" },
  noMatch: { en: "No items match.", ar: "لا توجد بنود مطابقة." },
  results: { en: "Search results", ar: "نتائج البحث" },
  more: { en: "Show more", ar: "عرض المزيد" },
  question: { en: "Related submittals", ar: "التقديمات ذات الصلة" },
};

type Args = { onPick: (link: LinkTarget) => void };

const meta: Meta<Args> = {
  title: "Form engine/LinkSearch",
  args: { onPick: fn() },
  decorators: [(Story) => <div className="max-w-xl">{Story()}</div>],
};

export default meta;
type Story = StoryObj<Args>;

const box = (canvas: ReturnType<typeof within>, context: Parameters<typeof storyText>[0]) =>
  canvas.getByRole("searchbox", { name: storyText(context, copy.label) });

/** Before typing: the search box and a hint of what it searches. Nothing is listed yet. */
export const Empty: Story = {
  render: (args, context) => <LinkSearch locale={storyLocale(context)} labels={linkSearchLabels[storyLocale(context)]} search={searchOf(storyLocale(context))} onPick={args.onPick} debounceMs={0} />,
  play: async (context) => {
    const { canvas } = context;
    await expect(box(canvas, context)).toHaveValue("");
    await expect(box(canvas, context)).toHaveAccessibleDescription(storyText(context, copy.hint));
    await expect(canvas.queryByRole("list")).toBeNull();
  },
};

/**
 * Results: each item by its Document Number (left to right, even in Arabic) and
 * Subject. An item already linked isn't offered again; picking one hands it
 * to the page.
 */
export const Results: Story = {
  render: (args, context) => (
    <LinkSearch
      locale={storyLocale(context)}
      labels={linkSearchLabels[storyLocale(context)]}
      search={searchOf(storyLocale(context))}
      onPick={args.onPick}
      exclude={[targets(storyLocale(context))[1]!.id]}
      debounceMs={0}
    />
  ),
  play: async (context) => {
    const { canvas, args } = context;
    const locale = storyLocale(context);
    await userEvent.type(box(canvas, context), storyText(context, copy.cable));
    const list = await canvas.findByRole("list", { name: storyText(context, copy.results) });
    const options = within(list).getAllByRole("button");
    // Cable trays and Cable ladders; Cable glands is already linked.
    await expect(options).toHaveLength(2);
    const number = within(options[0]!).getByText(numbers[0]!);
    await expect(number).toHaveAttribute("dir", "ltr");
    await expect(options[0]).toHaveTextContent(subjects[locale][0]!);
    await expect(canvas.getByRole("status")).toHaveTextContent(locale === "en" ? "2 items" : "بندان");
    await userEvent.click(options[1]!);
    await expect(args.onPick).toHaveBeenCalledWith(targets(locale)[4]);
  },
};

/** Nothing matches: says so, and that only Submitted items the Member can see are offered. */
export const NoResults: Story = {
  render: (args, context) => <LinkSearch locale={storyLocale(context)} labels={linkSearchLabels[storyLocale(context)]} search={searchOf(storyLocale(context))} onPick={args.onPick} debounceMs={0} />,
  play: async (context) => {
    const { canvas } = context;
    await userEvent.type(box(canvas, context), "XYZ");
    await waitFor(() => expect(canvas.getByRole("status")).toHaveTextContent(storyText(context, copy.noMatch)));
    await expect(canvas.queryByRole("list")).toBeNull();
  },
};

/** More than a page: "Show more" adds the next page under the first. */
export const MorePages: Story = {
  render: (args, context) => (
    <LinkSearch locale={storyLocale(context)} labels={linkSearchLabels[storyLocale(context)]} search={searchOf(storyLocale(context), 2)} onPick={args.onPick} debounceMs={0} />
  ),
  play: async (context) => {
    const { canvas } = context;
    await userEvent.type(box(canvas, context), "TWR");
    const list = await canvas.findByRole("list", { name: storyText(context, copy.results) });
    await expect(within(list).getAllByRole("button")).toHaveLength(2);
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.more) }));
    await waitFor(() => expect(within(list).getAllByRole("button")).toHaveLength(4));
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.more) }));
    await waitFor(() => expect(within(list).getAllByRole("button")).toHaveLength(5));
    await expect(canvas.queryByRole("button", { name: storyText(context, copy.more) })).toBeNull();
  },
};

/** In a Form, as a link question: the Field's label names the search box. */
export const InAField: Story = {
  render: (args, context) => (
    <Field label={storyText(context, copy.question)}>
      <LinkSearch locale={storyLocale(context)} labels={linkSearchLabels[storyLocale(context)]} search={searchOf(storyLocale(context))} onPick={args.onPick} debounceMs={0} />
    </Field>
  ),
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getByRole("searchbox", { name: storyText(context, copy.question) })).toBeVisible();
  },
};

/** At phone width: the box and every result are touch-sized. */
export const Phone: Story = {
  parameters: phone,
  render: (args, context) => <LinkSearch locale={storyLocale(context)} labels={linkSearchLabels[storyLocale(context)]} search={searchOf(storyLocale(context))} onPick={args.onPick} debounceMs={0} />,
  play: async (context) => {
    const { canvas } = context;
    await userEvent.type(box(canvas, context), storyText(context, copy.cable));
    const list = await canvas.findByRole("list", { name: storyText(context, copy.results) });
    await expectTouchTarget(box(canvas, context));
    for (const option of within(list).getAllByRole("button")) await expectTouchTarget(option);
  },
};
