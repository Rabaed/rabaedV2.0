import { formSchema, type OptionList } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { FormRenderer } from "./form-renderer.tsx";

// The option_list field (RP-282, spec RP-278): a choice from an Option List of up
// to three levels, each level filtered by the one above, also as a table column.
// A retired option stays on an answer that holds it, marked. Story data only:
// real lists are edited in Rabaed Admin and read from the API.
const listId = "00000000-0000-4000-8000-0000000000a1";
const node = (value: string, en: string, ar: string, options: OptionList["options"] = [], retired = false) => ({
  id: `00000000-0000-4000-8000-${value.padStart(12, "0").slice(-12)}`,
  value,
  label: { en, ar },
  retired,
  options,
});

const materials: OptionList = {
  id: listId,
  name: { en: "Materials", ar: "المواد" },
  options: [
    node("cables", "Cables", "الكابلات", [
      node("copper", "Copper", "نحاس", [
        node("two5", "2.5 mm²", "2.5 مم²"),
        node("six", "6 mm²", "6 مم²"),
        node("ten", "10 mm²", "10 مم²", [], true),
      ]),
      node("fibre", "Fibre", "ألياف"),
    ]),
    node("trays", "Cable trays", "حوامل الكابلات"),
    node("conduit", "Conduit", "المواسير", [], true),
  ],
};

const schema = formSchema.parse({
  sections: [
    {
      key: "material",
      title: { en: "Material", ar: "المادة" },
      fields: [
        { key: "grade", type: "option_list", list: listId, depth: 3, required: true, label: { en: "Material grade", ar: "درجة المادة" } },
        { key: "kinds", type: "option_list", list: listId, depth: 1, multiple: true, label: { en: "Other kinds", ar: "أنواع أخرى" } },
        {
          key: "items",
          type: "table",
          label: { en: "Items", ar: "البنود" },
          columns: [
            { key: "name", type: "text", label: { en: "Name", ar: "الاسم" } },
            { key: "kind", type: "option_list", list: listId, depth: 2, label: { en: "Kind", ar: "النوع" } },
          ],
        },
      ],
    },
  ],
});

const copy = {
  grade: { en: "Material grade", ar: "درجة المادة" },
  level2: { en: "Level 2", ar: "المستوى 2" },
  level3: { en: "Level 3", ar: "المستوى 3" },
  cables: { en: "Cables", ar: "الكابلات" },
  copper: { en: "Copper", ar: "نحاس" },
  two5: { en: "2.5 mm²", ar: "2.5 مم²" },
  tooShallow: { en: "Keep choosing down to the last level.", ar: "تابع الاختيار حتى المستوى الأخير." },
  unknown: { en: "Choose one of the options.", ar: "اختر أحد الخيارات." },
  retired: { en: "retired", ar: "موقوف" },
};

const meta = {
  title: "Form engine/FormRenderer/OptionList",
  component: FormRenderer,
  args: { schema, answers: {}, mode: "edit", locale: "en", optionLists: [materials], onChange: fn() },
  decorators: [(Story) => <div className="max-w-3xl">{Story()}</div>],
} satisfies Meta<typeof FormRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Filling it: each level offers the options under the one chosen above, down to the field's depth. */
export const Edit: Story = {
  render: function Render(args, context) {
    const [values, setValues] = useState<Record<string, unknown>>({});
    return (
      <FormRenderer
        {...args}
        locale={storyLocale(context)}
        answers={values}
        onChange={(changes) => {
          args.onChange?.(changes);
          setValues((current) => ({ ...current, ...changes }));
        }}
      />
    );
  },
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getByRole("group", { name: new RegExp(storyText(context, copy.grade)) })).toBeVisible();
    // Only the first level at first; retired options aren't offered.
    await expect(canvas.queryByRole("combobox", { name: new RegExp(storyText(context, copy.level2)) })).toBeNull();
    await userEvent.click(canvas.getByRole("combobox", { name: new RegExp(storyText(context, { en: "Level 1", ar: "المستوى 1" })) }));
    await expect(screen.queryByRole("option", { name: /Conduit|المواسير/ })).toBeNull();
    await userEvent.click(screen.getByRole("option", { name: storyText(context, copy.cables) }));

    await userEvent.click(canvas.getByRole("combobox", { name: new RegExp(storyText(context, copy.level2)) }));
    await userEvent.click(screen.getByRole("option", { name: storyText(context, copy.copper) }));

    // The third level offers the options under Copper, and not the retired one.
    await userEvent.click(canvas.getByRole("combobox", { name: new RegExp(storyText(context, copy.level3)) }));
    await expect(screen.queryByRole("option", { name: /10/ })).toBeNull();
    await userEvent.click(screen.getByRole("option", { name: storyText(context, copy.two5) }));
    // The answer is the value of the option reached.
    await expect(context.args.onChange).toHaveBeenLastCalledWith({ grade: "two5" });

    // Choosing another option above clears what was below it.
    await userEvent.click(canvas.getByRole("combobox", { name: new RegExp(storyText(context, copy.level2)) }));
    await userEvent.click(screen.getByRole("option", { name: storyText(context, { en: "Fibre", ar: "ألياف" }) }));
    await expect(context.args.onChange).toHaveBeenLastCalledWith({ grade: "fibre" });
    await expect(canvas.queryByRole("combobox", { name: new RegExp(storyText(context, copy.level3)) })).toBeNull();
  },
};

/** A multiple choice: a checkbox for each option that can be chosen, named by its path. */
export const Multiple: Story = {
  args: { answers: { grade: "two5", kinds: ["trays"] } },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    await userEvent.click(canvas.getByRole("checkbox", { name: storyText(context, copy.cables) }));
    await expect(context.args.onChange).toHaveBeenLastCalledWith({ kinds: ["trays", "cables"] });
    await expect(canvas.queryByRole("checkbox", { name: /Conduit|المواسير/ })).toBeNull();
  },
};

/** Three levels, with a retired option kept on the answer, marked, and one in a table column. */
export const WithRetiredOption: Story = {
  args: {
    answers: { grade: "ten", kinds: ["conduit"], items: [{ name: "Main run", kind: "conduit" }, { name: "Spur", kind: "fibre" }] },
  },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    // The retired option stays chosen and is marked; the levels above it are as they were.
    await expect(canvas.getByRole("combobox", { name: new RegExp(storyText(context, copy.level3)) })).toHaveTextContent(
      new RegExp(`10.*${storyText(context, copy.retired)}`),
    );
    await expect(canvas.getByRole("checkbox", { name: new RegExp(storyText(context, copy.retired)) })).toBeChecked();
    // It can be changed away from; the picker then offers only options that aren't retired.
    await userEvent.click(canvas.getByRole("combobox", { name: new RegExp(storyText(context, copy.level3)) }));
    await expect(screen.queryAllByRole("option", { name: new RegExp(storyText(context, copy.retired)) })).toHaveLength(1);
    await userEvent.keyboard("{Escape}");
  },
};

/** Stopped above the depth when leaving Draft, and a retired option chosen anew: each field's own message. */
export const WithErrors: Story = {
  args: {
    answers: { grade: "cables", items: [{ name: "Spur", kind: "conduit" }] },
    errors: [
      { key: "grade", code: "too_shallow" },
      { key: "items", code: "unknown_option", row: 0, column: "kind" },
    ],
  },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getByRole("group", { name: new RegExp(storyText(context, copy.grade)) })).toHaveAccessibleDescription(
      storyText(context, copy.tooShallow),
    );
    await expect(canvas.getAllByText(storyText(context, copy.unknown))).not.toHaveLength(0);
    // The next level waits, empty, for the filler to go on.
    await expect(canvas.getByRole("combobox", { name: new RegExp(storyText(context, copy.level2)) })).toBeVisible();
  },
};

/** Read only: the path to each option, in the viewer's language; a retired one marked; the table cell the same. */
export const ReadOnly: Story = {
  args: {
    mode: "read",
    answers: { grade: "two5", kinds: ["trays", "conduit"], items: [{ name: "Main run", kind: "fibre" }, { name: "Spur", kind: "conduit" }] },
  },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.queryAllByRole("combobox")).toEqual([]);
    const sep = storyText(context, { en: " › ", ar: " ‹ " });
    await expect(
      canvas.getByText(`${storyText(context, copy.cables)}${sep}${storyText(context, copy.copper)}${sep}${storyText(context, copy.two5)}`),
    ).toBeVisible();
    await expect(within(canvas.getByRole("table")).getAllByRole("row")).toHaveLength(3);
    await expect(canvas.getAllByText(new RegExp(`\\(${storyText(context, copy.retired)}\\)`)).length).toBeGreaterThanOrEqual(2);
  },
};

/** Nothing answered: "Not answered". */
export const ReadOnlyEmpty: Story = {
  args: { mode: "read" },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async (context) => {
    await expect(context.canvas.getAllByText(storyText(context, { en: "Not answered", ar: "لم تتم الإجابة" })).length).toBeGreaterThan(0);
  },
};

/** On a phone, the levels stack in one column; nothing scrolls sideways. */
export const PhoneEdit: Story = {
  parameters: phone,
  args: { answers: { grade: "two5", items: [{ name: "Main run", kind: "fibre" }] } },
  render: (args, context) => <FormRenderer {...args} locale={storyLocale(context)} />,
  play: async () => {
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  },
};
