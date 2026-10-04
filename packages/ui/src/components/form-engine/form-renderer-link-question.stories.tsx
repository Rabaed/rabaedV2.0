import { formSchema, type HiddenLinkChoice, type LinkSearchResults, type LinkTarget, type Locale } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { FormRenderer, type FormLinks } from "./form-renderer.tsx";

// The link question, `work_item_ref` (RP-293, spec RP-289): the filler picks
// items with Link search; each shows as its Document Number (left to right) and
// Subject. A chosen item the viewer can't see comes as its number and Subject
// only, without an id, and opening it says only that they may not see its
// details (E1, ADR 0012). Story data only: the API decides what each viewer gets.
const self = "00000000-0000-4000-8000-000000000099";
const subjects: Record<Locale, string[]> = {
  en: ["Cable trays, galvanised", "Switchgear panels", "Lighting fixtures", "Cable ladders"],
  ar: ["حوامل الكابلات المجلفنة", "لوحات المفاتيح", "وحدات الإنارة", "سلالم الكابلات"],
};
const numbers = ["TWR-MAR-EL-0012", "TWR-MAR-EL-0004", "TWR-MAR-EL-0007", "TWR-MAR-EL-0002"];
const itemId = (i: number) => `00000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, "0")}`;
const target = (locale: Locale, i: number): LinkTarget => ({ id: itemId(i), documentNumber: numbers[i]!, subject: subjects[locale][i]! });
const hidden = (locale: Locale, i: number): HiddenLinkChoice => ({ documentNumber: numbers[i]!, subject: subjects[locale][i]! });

const schema = formSchema.parse({
  sections: [
    {
      key: "basis",
      title: { en: "Basis", ar: "الأساس" },
      fields: [
        {
          key: "related",
          type: "work_item_ref",
          required: true,
          label: { en: "Related submittals", ar: "التقديمات ذات الصلة" },
          help: { en: "Earlier submittals this one relies on.", ar: "التقديمات السابقة التي يعتمد عليها هذا التقديم." },
        },
      ],
    },
  ],
});

/** What the page passes: the names of the chosen items the viewer sees, and the Link search API. */
const links = (locale: Locale, extra: Partial<FormLinks> = {}): FormLinks => ({
  targets: Object.fromEntries([0, 1, 2, 3].map((i) => [itemId(i), { documentNumber: numbers[i]!, subject: subjects[locale][i]! }])),
  search: async (query: string): Promise<LinkSearchResults> => {
    const q = query.toLowerCase();
    return {
      links: [0, 1, 2, 3].map((i) => target(locale, i)).filter((t) => t.documentNumber.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q)),
      nextPage: null,
    };
  },
  workItemId: self,
  hrefFor: (id) => `#/work-items/${id}`,
  debounceMs: 0,
  ...extra,
});

const copy = {
  label: { en: "Related submittals", ar: "التقديمات ذات الصلة" },
  results: { en: "Search results", ar: "نتائج البحث" },
  cable: { en: "cable", ar: "الكابلات" },
  hidden: { en: "You are not allowed to see the details of this item.", ar: "غير مسموح لك برؤية تفاصيل هذا البند." },
  required: { en: "This field is required.", ar: "هذا الحقل مطلوب." },
  unanswered: { en: "Not answered", ar: "لم تتم الإجابة" },
};
const removeLabel = (locale: Locale, number: string) => (locale === "en" ? `Remove ${number}` : `إزالة ⁦${number}⁩`);

const meta = {
  title: "Form engine/FormRenderer/LinkQuestion",
  component: FormRenderer,
  args: { schema, answers: {}, mode: "edit", locale: "en", onChange: fn() },
  decorators: [(Story) => <div className="max-w-3xl">{Story()}</div>],
} satisfies Meta<typeof FormRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Filling it: Link search finds items by number or Subject; each picked shows
 * as a chip with its number and Subject and can be removed; an item already
 * chosen isn't offered again.
 */
export const Edit: Story = {
  render: function Render(args, context) {
    const locale = storyLocale(context);
    const [values, setValues] = useState<Record<string, unknown>>({ related: [itemId(0)] });
    return (
      <FormRenderer
        {...args}
        locale={locale}
        answers={values}
        links={links(locale)}
        onChange={(changes) => {
          args.onChange?.(changes);
          setValues((current) => ({ ...current, ...changes }));
        }}
      />
    );
  },
  play: async (context) => {
    const { canvas, args } = context;
    const locale = storyLocale(context);
    const chosen = canvas.getByRole("list", { name: storyText(context, copy.label) });
    await expect(within(chosen).getAllByRole("listitem")).toHaveLength(1);
    await expect(within(chosen).getByText(numbers[0]!)).toHaveAttribute("dir", "ltr");
    await expect(chosen).toHaveTextContent(subjects[locale][0]!);

    await userEvent.type(canvas.getByRole("searchbox", { name: new RegExp(storyText(context, copy.label)) }), storyText(context, copy.cable));
    const results = await canvas.findByRole("list", { name: storyText(context, copy.results) });
    // Cable trays is already chosen: only Cable ladders is offered.
    const offered = within(results).getAllByRole("button");
    await expect(offered).toHaveLength(1);
    await userEvent.click(offered[0]!);
    await expect(args.onChange).toHaveBeenLastCalledWith({ related: [itemId(0), itemId(3)] });
    await expect(within(canvas.getByRole("list", { name: storyText(context, copy.label) })).getAllByRole("listitem")).toHaveLength(2);

    await userEvent.click(canvas.getByRole("button", { name: removeLabel(locale, numbers[0]!) }));
    await expect(args.onChange).toHaveBeenLastCalledWith({ related: [itemId(3)] });
    await userEvent.click(canvas.getByRole("button", { name: removeLabel(locale, numbers[3]!) }));
    await expect(args.onChange).toHaveBeenLastCalledWith({ related: undefined });
  },
};

/**
 * A chosen item the filler can't see: its number and Subject only, marked; opening it
 * says only that they may not see its details. It can be removed, and stays otherwise.
 */
export const HiddenChoice: Story = {
  render: (args, context) => {
    const locale = storyLocale(context);
    return <FormRenderer {...args} locale={locale} answers={{ related: [itemId(1), hidden(locale, 2)] }} links={links(locale)} />;
  },
  play: async (context) => {
    const { canvas, canvasElement, args } = context;
    const locale = storyLocale(context);
    const chosen = canvas.getByRole("list", { name: storyText(context, copy.label) });
    const closed = within(chosen).getByRole("button", { expanded: false });
    await expect(closed).toHaveTextContent(numbers[2]!);
    await expect(canvas.getByText(storyText(context, copy.hidden), { selector: "p" })).not.toBeVisible();
    await userEvent.click(closed);
    await expect(closed).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText(storyText(context, copy.hidden), { selector: "p" })).toBeVisible();
    await expect(canvasElement.innerHTML).not.toContain(itemId(2));
    await userEvent.click(canvas.getByRole("button", { name: removeLabel(locale, numbers[2]!) }));
    await expect(args.onChange).toHaveBeenLastCalledWith({ related: [itemId(1)] });
  },
};

/** Required, and empty when leaving Draft: its own message, and the search box to fill it. */
export const Required: Story = {
  args: { errors: [{ key: "related", code: "required" }] },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} links={links(storyLocale(context))} />,
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getByRole("searchbox", { name: new RegExp(storyText(context, copy.label)) })).toHaveAccessibleDescription(
      new RegExp(storyText(context, copy.required)),
    );
  },
};

/**
 * From Submit, read only: each item opens it, or, for one the viewer can't
 * see, says only that they may not see its details. No search, no remove.
 */
export const ReadOnly: Story = {
  args: { mode: "read" },
  render: (args, context) => {
    const locale = storyLocale(context);
    return <FormRenderer {...args} locale={locale} answers={{ related: [itemId(0), hidden(locale, 2)] }} links={links(locale)} />;
  },
  play: async (context) => {
    const { canvas, canvasElement } = context;
    await expect(canvas.queryByRole("searchbox")).toBeNull();
    await expect(canvas.queryByRole("button", { name: /Remove|إزالة/ })).toBeNull();
    const chosen = canvas.getByRole("list", { name: storyText(context, copy.label) });
    const opens = within(chosen).getAllByRole("link");
    await expect(opens).toHaveLength(1);
    await expect(opens[0]).toHaveAttribute("href", `#/work-items/${itemId(0)}`);
    await userEvent.click(within(chosen).getByRole("button", { expanded: false }));
    await expect(canvas.getByText(storyText(context, copy.hidden), { selector: "p" })).toBeVisible();
    await expect(canvasElement.innerHTML).not.toContain(itemId(2));
  },
};

/** Read only, nothing chosen: "Not answered". */
export const ReadOnlyEmpty: Story = {
  args: { mode: "read" },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} links={links(storyLocale(context))} />,
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, copy.unanswered))).toBeVisible();
  },
};

/** At phone width: chips wrap, and each remove button is a full touch target. */
export const Phone: Story = {
  parameters: phone,
  render: (args, context) => {
    const locale = storyLocale(context);
    return <FormRenderer {...args} locale={locale} answers={{ related: [itemId(0), itemId(1), hidden(locale, 2)] }} links={links(locale)} />;
  },
  play: async (context) => {
    const { canvas } = context;
    const locale = storyLocale(context);
    await expectTouchTarget(canvas.getByRole("button", { name: removeLabel(locale, numbers[0]!) }));
    await expectTouchTarget(canvas.getByRole("searchbox", { name: new RegExp(storyText(context, copy.label)) }));
  },
};
