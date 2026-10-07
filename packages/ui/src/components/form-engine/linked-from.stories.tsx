import type { LinkedFromItem, Locale } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { linkedFromLabels, linksSectionLabels } from "../../storybook/form-engine.ts";
import { LinkedFromList } from "./linked-from.tsx";
import { LinksSection } from "./links-section.tsx";

// "Linked from" (RP-292, spec RP-289): the Submitted items that link to this
// one, below its Links. One the viewer can see opens it; one they can't comes
// as its Document Number and Subject only, without an id, and opening it only
// says they may not see its details (E3). Story data only: the API decides what
// each viewer gets, and never sends a Draft or an item in internal review.
const subjects: Record<Locale, string[]> = {
  en: ["Busbar risers", "Cable trays, Tower 2"],
  ar: ["صواعد قضبان التوزيع", "حوامل الكابلات، البرج 2"],
};
const numbers = ["TWR-MAR-EL-0021", "TWR-MAR-EL-0034"];
const itemId = (i: number) => `00000000-0000-4000-8000-0000000002${String(i + 1).padStart(2, "0")}`;
const hiddenId = itemId(1);

/** Story item `i` as the API returns it; `seen: false` is one the viewer can't see. */
const linker = (locale: Locale, i: number, seen = true): LinkedFromItem => ({
  documentNumber: numbers[i]!,
  subject: subjects[locale][i]!,
  workItemId: seen ? itemId(i) : null,
});

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

/**
 * Two Submitted items link here: one the viewer sees opens it; the other, which
 * they can't see, shows its number and Subject and only explains why it won't open.
 */
export const Listed: Story = {
  render: (_args, context) => section(storyLocale(context), [linker(storyLocale(context), 0), linker(storyLocale(context), 1, false)]),
  play: async (context) => {
    const { canvas, canvasElement } = context;
    const locale = storyLocale(context);
    await expect(canvas.getByRole("heading", { level: 3, name: storyText(context, copy.title) })).toBeVisible();
    const list = canvas.getByRole("list", { name: storyText(context, copy.title) });
    const opens = within(list).getAllByRole("link");
    await expect(opens).toHaveLength(1);
    await expect(opens[0]).toHaveAttribute("href", `#/work-items/${itemId(0)}`);
    await expect(within(opens[0]!).getByText(numbers[0]!)).toHaveAttribute("dir", "ltr");
    await expect(opens[0]).toHaveTextContent(subjects[locale][0]!);

    const hidden = within(list).getByRole("button", { expanded: false });
    await expect(hidden).toHaveTextContent(numbers[1]!);
    await expect(hidden).toHaveTextContent(subjects[locale][1]!);
    await expect(within(hidden).getByText(numbers[1]!)).toHaveAttribute("dir", "ltr");
    await expect(canvas.getByText(storyText(context, copy.hidden), { selector: "p" })).not.toBeVisible();
    await userEvent.click(hidden);
    await expect(hidden).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText(storyText(context, copy.hidden), { selector: "p" })).toBeVisible();
    await expect(canvasElement.innerHTML).not.toContain(hiddenId);
  },
};

/** Nothing Submitted links here: says so. */
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
  render: (_args, context) => section(storyLocale(context), [linker(storyLocale(context), 0), linker(storyLocale(context), 1, false)]),
  play: async (context) => {
    const list = context.canvas.getByRole("list", { name: storyText(context, copy.title) });
    await expectTouchTarget(within(list).getByRole("link"));
    await expectTouchTarget(within(list).getByRole("button", { expanded: false }));
  },
};
