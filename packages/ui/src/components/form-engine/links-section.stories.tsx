import type { LinkSearchResults, LinkTarget, Locale, WorkItemLink } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { linksSectionLabels } from "../../storybook/form-engine.ts";
import { LinksSection } from "./links-section.tsx";

// The Links System Field (RP-291, spec RP-289): an item's Links, each the other
// item's Document Number and Subject. A linked item the viewer can't see comes
// without an id, and opening it only says they may not see its details (E1).
// Story data only: the API decides what each viewer gets.
const self = "00000000-0000-4000-8000-000000000099";
const subjects: Record<Locale, string[]> = {
  en: ["Cable trays, galvanised", "Switchgear panels", "Lighting fixtures", "Cable ladders"],
  ar: ["حوامل الكابلات المجلفنة", "لوحات المفاتيح", "وحدات الإنارة", "سلالم الكابلات"],
};
const numbers = ["TWR-MAR-EL-0012", "TWR-MAR-EL-0004", "TWR-MAR-EL-0007", "TWR-MAR-EL-0002"];
const itemId = (i: number) => `00000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, "0")}`;

/** A Link to story item `i`, as the API returns it; `seen: false` is one the viewer can't see. */
const link = (locale: Locale, i: number, { seen = true, fieldKey = null as string | null } = {}): WorkItemLink => ({
  id: `00000000-0000-4000-8000-0000000001${String(i + 1).padStart(2, "0")}`,
  kind: fieldKey ? "relies_on" : "related",
  fieldKey,
  documentNumber: numbers[i]!,
  subject: subjects[locale][i]!,
  workItemId: seen ? itemId(i) : null,
});

const search =
  (locale: Locale) =>
  async (query: string): Promise<LinkSearchResults> => {
    const q = query.toLowerCase();
    const links: LinkTarget[] = numbers
      .map((documentNumber, i) => ({ id: itemId(i), documentNumber, subject: subjects[locale][i]! }))
      .filter((t) => t.documentNumber.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q));
    return { links, nextPage: null };
  };

const copy = {
  title: { en: "Links", ar: "الروابط" },
  none: { en: "No Links yet.", ar: "لا توجد روابط بعد." },
  hidden: { en: "You are not allowed to see the details of this item.", ar: "غير مسموح لك برؤية تفاصيل هذا البند." },
  find: { en: "Find an item to link", ar: "ابحث عن بند لربطه" },
  results: { en: "Search results", ar: "نتائج البحث" },
  cable: { en: "cable", ar: "الكابلات" },
  question: { en: "Related submittals", ar: "التقديمات ذات الصلة" },
  refused: { en: "That item can't be linked.", ar: "لا يمكن ربط هذا البند." },
};
const removeLabel = (locale: Locale, number: string) =>
  locale === "en" ? `Remove the Link to ${number}` : `إزالة الربط مع \u2066${number}\u2069`;

type Args = { onAdd: (target: LinkTarget) => void; onRemove: (link: WorkItemLink) => void };

const meta: Meta<Args> = {
  title: "Form engine/LinksSection",
  args: { onAdd: fn(), onRemove: fn() },
  decorators: [(Story) => <div className="max-w-xl">{Story()}</div>],
};

export default meta;
type Story = StoryObj<Args>;

const section = (
  args: Args,
  locale: Locale,
  links: WorkItemLink[],
  extra: Partial<Parameters<typeof LinksSection>[0]> = {},
) => (
  <LinksSection
    locale={locale}
    labels={linksSectionLabels[locale]}
    links={links}
    canChange
    workItemId={self}
    search={search(locale)}
    onAdd={args.onAdd}
    onRemove={args.onRemove}
    hrefFor={(id) => `#/work-items/${id}`}
    debounceMs={0}
    {...extra}
  />
);

/**
 * The raiser's Draft: its Links, each opening the item, with remove; and the
 * picker, which never offers an item already linked.
 */
export const Editable: Story = {
  render: (args, context) => section(args, storyLocale(context), [link(storyLocale(context), 0), link(storyLocale(context), 1)]),
  play: async (context) => {
    const { canvas, args } = context;
    const locale = storyLocale(context);
    const list = canvas.getByRole("list", { name: storyText(context, copy.title) });
    const opens = within(list).getAllByRole("link");
    await expect(opens).toHaveLength(2);
    await expect(opens[0]).toHaveAttribute("href", `#/work-items/${itemId(0)}`);
    await expect(within(opens[0]!).getByText(numbers[0]!)).toHaveAttribute("dir", "ltr");
    await expect(opens[0]).toHaveTextContent(subjects[locale][0]!);
    await userEvent.click(canvas.getByRole("button", { name: removeLabel(locale, numbers[1]!) }));
    await expect(args.onRemove).toHaveBeenCalledWith(link(locale, 1));

    await userEvent.type(canvas.getByRole("searchbox", { name: storyText(context, copy.find) }), storyText(context, copy.cable));
    const results = await canvas.findByRole("list", { name: storyText(context, copy.results) });
    // Cable trays is already linked: only Cable ladders is offered.
    const offered = within(results).getAllByRole("button");
    await expect(offered).toHaveLength(1);
    await userEvent.click(offered[0]!);
    await expect(args.onAdd).toHaveBeenCalledWith({ id: itemId(3), documentNumber: numbers[3], subject: subjects[locale][3] });
  },
};

/** A new Draft without Links: says so, and offers the picker. */
export const Empty: Story = {
  render: (args, context) => section(args, storyLocale(context), []),
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getByText(storyText(context, copy.none))).toBeVisible();
    await expect(canvas.getByRole("searchbox", { name: storyText(context, copy.find) })).toBeVisible();
  },
};

/**
 * A Link to an item the viewer can't see: its number and Subject only, no
 * address to open; opening it says only that they may not see its details.
 */
export const HiddenLink: Story = {
  render: (args, context) =>
    section(args, storyLocale(context), [link(storyLocale(context), 0), link(storyLocale(context), 2, { seen: false })], {
      canChange: false,
    }),
  play: async (context) => {
    const { canvas, canvasElement } = context;
    const list = canvas.getByRole("list", { name: storyText(context, copy.title) });
    await expect(within(list).getAllByRole("link")).toHaveLength(1);
    const hidden = within(list).getByRole("button", { expanded: false });
    await expect(hidden).toHaveTextContent(numbers[2]!);
    await expect(canvas.getByText(storyText(context, copy.hidden), { selector: "p" })).not.toBeVisible();
    await userEvent.click(hidden);
    await expect(hidden).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText(storyText(context, copy.hidden), { selector: "p" })).toBeVisible();
    await expect(canvasElement.innerHTML).not.toContain(itemId(2));
  },
};

/** From Submit: the Links read only, with no picker and no remove. */
export const ReadOnly: Story = {
  render: (args, context) =>
    section(args, storyLocale(context), [link(storyLocale(context), 0), link(storyLocale(context), 1)], { canChange: false }),
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getAllByRole("link")).toHaveLength(2);
    await expect(canvas.queryByRole("searchbox")).toBeNull();
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

/** A link question's Links, under its label; they change with its answer, so they have no remove here. */
export const WithLinkQuestion: Story = {
  render: (args, context) => {
    const locale = storyLocale(context);
    return section(args, locale, [link(locale, 0), link(locale, 1, { fieldKey: "related_submittals" }), link(locale, 2, { fieldKey: "related_submittals", seen: false })], {
      questionLabels: { related_submittals: copy.question[locale] },
    });
  },
  play: async (context) => {
    const { canvas } = context;
    const locale = storyLocale(context);
    await expect(canvas.getByRole("heading", { name: storyText(context, copy.question) })).toBeVisible();
    const question = canvas.getByRole("list", { name: storyText(context, copy.question) });
    await expect(within(question).getAllByRole("listitem")).toHaveLength(2);
    await expect(within(question).queryByRole("button", { name: removeLabel(locale, numbers[1]!) })).toBeNull();
    await expect(canvas.getByRole("button", { name: removeLabel(locale, numbers[0]!) })).toBeVisible();
  },
};

/** An add or a removal refused: the reason, as the page words it. */
export const Refused: Story = {
  render: (args, context) =>
    section(args, storyLocale(context), [link(storyLocale(context), 0)], { message: storyText(context, copy.refused) }),
  play: async (context) => {
    await expect(context.canvas.getByRole("alert")).toHaveTextContent(storyText(context, copy.refused));
  },
};

/** At phone width: every Link, the remove buttons and the picker are touch-sized. */
export const Phone: Story = {
  parameters: phone,
  render: (args, context) =>
    section(args, storyLocale(context), [link(storyLocale(context), 0), link(storyLocale(context), 2, { seen: false })]),
  play: async (context) => {
    const { canvas } = context;
    const locale = storyLocale(context);
    const list = canvas.getByRole("list", { name: storyText(context, copy.title) });
    await expectTouchTarget(within(list).getByRole("link"));
    await expectTouchTarget(within(list).getByRole("button", { expanded: false }));
    await expectTouchTarget(canvas.getByRole("button", { name: removeLabel(locale, numbers[0]!) }));
    await expectTouchTarget(canvas.getByRole("searchbox", { name: storyText(context, copy.find) }));
  },
};
