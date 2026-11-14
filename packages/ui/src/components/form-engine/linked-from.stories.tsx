import type { LinkedFromItem, Locale } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { linkedFromLabels, linksSectionLabels } from "../../storybook/form-engine.ts";
import { LinkedFromList } from "./linked-from.tsx";
import { LinksSection } from "./links-section.tsx";

// "Linked from" (RP-292, spec RP-289; RP-1301): the Submitted items that link to
// this one and that the viewer sees, below its Links. Each opens its item. One the
// viewer can't see is never in the read (RP-1301, reversing E3's number and
// Subject), so nothing of it shows. Story data only: the API decides what each
// viewer gets, and never sends a Draft or an item in internal review.
const subjects: Record<Locale, string[]> = {
  en: ["Busbar risers", "Cable trays, Tower 2"],
  ar: ["صواعد قضبان التوزيع", "حوامل الكابلات، البرج 2"],
};
const numbers = ["TWR-MAR-EL-0021", "TWR-MAR-EL-0034"];
const itemId = (i: number) => `00000000-0000-4000-8000-0000000002${String(i + 1).padStart(2, "0")}`;

/** Story item `i` as the API returns it to a viewer who sees it. */
const linker = (locale: Locale, i: number): LinkedFromItem => ({ documentNumber: numbers[i]!, subject: subjects[locale][i]!, workItemId: itemId(i) });

const copy = {
  title: { en: "Linked from", ar: "مرتبط من" },
  none: { en: "No Submitted item links here yet.", ar: "لا يرتبط بهذا البند أي بند مُقدَّم بعد." },
  hidden: { en: "You are not allowed to see the details of this item.", ar: "غير مسموح لك برؤية تفاصيل هذا البند." },
};

const meta: Meta = {
  title: "Form engine/LinkedFrom",
  decorators: [(Story) => <div className="max-w-xl">{Story()}</div>],
};

export default meta;
type Story = StoryObj;

/** The Links section of a Submitted item, with "Linked from" below its Links. */
const section = (locale: Locale, items: LinkedFromItem[]) => (
  <LinksSection
    locale={locale}
    labels={linksSectionLabels[locale]}
    links={[]}
    canChange={false}
    workItemId="00000000-0000-4000-8000-000000000099"
    search={async () => ({ links: [], nextPage: null })}
    onAdd={fn()}
    onRemove={fn()}
    hrefFor={(id) => `#/work-items/${id}`}
  >
    <LinkedFromList labels={linkedFromLabels[locale]} items={items} hrefFor={(id) => `#/work-items/${id}`} />
  </LinksSection>
);

/** Two Submitted items the viewer sees link here: each opens its item, its Document Number left to right. */
export const Listed: Story = {
  render: (_args, context) => section(storyLocale(context), [linker(storyLocale(context), 0), linker(storyLocale(context), 1)]),
  play: async (context) => {
    const { canvas } = context;
    const locale = storyLocale(context);
    await expect(canvas.getByRole("heading", { level: 3, name: storyText(context, copy.title) })).toBeVisible();
    const list = canvas.getByRole("list", { name: storyText(context, copy.title) });
    const opens = within(list).getAllByRole("link");
    await expect(opens).toHaveLength(2);
    for (const i of [0, 1]) {
      await expect(opens[i]).toHaveAttribute("href", `#/work-items/${itemId(i)}`);
      await expect(within(opens[i]!).getByText(numbers[i]!)).toHaveAttribute("dir", "ltr");
      await expect(opens[i]).toHaveTextContent(subjects[locale][i]!);
    }
    await expect(within(list).queryByRole("button")).toBeNull();
  },
};

/**
 * RP-1301-1: of the two items linking here, the viewer may see one. The read gives only that one, and the
 * list shows exactly it: no second row, no "may not see" entry, no count or "1 more", no hidden number.
 */
export const OnlyWhatTheViewerMaySee: Story = {
  render: (_args, context) => section(storyLocale(context), [linker(storyLocale(context), 0)]),
  play: async (context) => {
    const { canvas, canvasElement } = context;
    const list = canvas.getByRole("list", { name: storyText(context, copy.title) });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    await expect(within(list).getByRole("link")).toHaveAttribute("href", `#/work-items/${itemId(0)}`);
    const text = canvasElement.textContent ?? "";
    await expect(text).not.toContain(numbers[1]!);
    await expect(text).not.toContain(subjects[storyLocale(context)][1]!);
    await expect(text).not.toContain(storyText(context, copy.hidden));
    await expect(text).not.toMatch(/\b(more|1\s*\+|\+\s*1)\b|المزيد/);
    await expect(canvasElement.innerHTML).not.toContain(itemId(1));
  },
};

/** Nothing the viewer sees links here: says so, as it does when nothing links here at all. */
export const Empty: Story = {
  render: (_args, context) => section(storyLocale(context), []),
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getByRole("heading", { level: 3, name: storyText(context, copy.title) })).toBeVisible();
    await expect(canvas.getByText(storyText(context, copy.none))).toBeVisible();
    await expect(canvas.queryByRole("list", { name: storyText(context, copy.title) })).toBeNull();
  },
};

/** At phone width: every entry is touch-sized. */
export const Phone: Story = {
  parameters: phone,
  render: (_args, context) => section(storyLocale(context), [linker(storyLocale(context), 0), linker(storyLocale(context), 1)]),
  play: async (context) => {
    const list = context.canvas.getByRole("list", { name: storyText(context, copy.title) });
    for (const open of within(list).getAllByRole("link")) await expectTouchTarget(open);
  },
};
