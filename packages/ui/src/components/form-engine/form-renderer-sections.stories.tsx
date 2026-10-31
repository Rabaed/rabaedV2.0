import { formSchema } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { formRendererLabels } from "../../storybook/form-engine.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { SubmittalPanelSections } from "../submittal-panel/panel-sections.tsx";
import { FormRenderer } from "./form-renderer.tsx";

// The Work Item page's Form (RP-1151, gap table rows 43–45): each section of the Form is a card that
// folds to a one-line summary, inside the Submittal Panel's sections. Story data only.
const schema = formSchema.parse({
  sections: [
    {
      key: "material",
      title: { en: "Material details", ar: "تفاصيل المواد" },
      fields: [
        { key: "manufacturer", type: "text", required: true, label: { en: "Manufacturer", ar: "الشركة المصنعة" } },
        { key: "model", type: "text", label: { en: "Model", ar: "الطراز" } },
        { key: "spec", type: "text", label: { en: "Specification section", ar: "قسم المواصفات" } },
      ],
    },
    {
      key: "details",
      title: { en: "Description", ar: "الوصف" },
      fields: [{ key: "description", type: "textarea", label: { en: "Description", ar: "الوصف" } }],
    },
  ],
});

const answers = { manufacturer: "Zumtobel", model: "Linea LED 1200", spec: "26 51 00", description: "" };

const copy = {
  material: { en: "Material details", ar: "تفاصيل المواد" },
  details: { en: "Description", ar: "الوصف" },
  summary: { en: "Zumtobel · Linea LED 1200", ar: "Zumtobel · Linea LED 1200" },
  count: { en: "2 sections", ar: "قسمان" },
  collapseAll: { en: "Collapse all", ar: "طي الكل" },
  expandAll: { en: "Expand all", ar: "فتح الكل" },
  nothing: { en: "Nothing answered yet", ar: "لا إجابات بعد" },
};

type StoryContext = { globals: Record<string, unknown> };

/** The Form read in folding sections, as the page lays it out. */
function Folding({ context }: { context: StoryContext }) {
  const locale = storyLocale(context);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <div className="@container/sdp">
      <FormRenderer
        schema={schema}
        answers={answers}
        mode="read"
        locale={locale}
        labels={formRendererLabels[locale]}
        sectionsAs={(sections) => (
          <SubmittalPanelSections
            locale={locale}
            labels={{ count: () => storyText(context, copy.count), collapseAll: storyText(context, copy.collapseAll), expandAll: storyText(context, copy.expandAll) }}
            sections={sections.map((s) => ({ key: s.key, icon: "file-text", title: s.title, summary: s.summary ?? storyText(context, copy.nothing), children: s.content }))}
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
          />
        )}
      />
    </div>
  );
}

const meta = {
  title: "Form engine/FormRenderer/Folding sections",
  component: FormRenderer,
  args: { schema, answers, mode: "read", locale: "en", labels: formRendererLabels.en },
} satisfies Meta<typeof FormRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open, each section shows its answers; folded, its header shows its first two answers instead. */
export const Folding_: Story = {
  name: "Folding",
  render: (_args, context) => <Folding context={context} />,
  play: async (context) => {
    const material = context.canvas.getByRole("button", { name: new RegExp(storyText(context, copy.material)) });
    await expect(material).toHaveAttribute("aria-expanded", "true");
    await expect(context.canvas.getByText("Zumtobel")).toBeVisible();
    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, copy.collapseAll) }));
    await expect(material).toHaveAttribute("aria-expanded", "false");
    await expect(within(material).getByText(copy.summary.en)).toBeVisible();
    // A section with nothing answered says so instead.
    const details = context.canvas.getByRole("button", { name: new RegExp(storyText(context, copy.details)) });
    await expect(within(details).getByText(storyText(context, copy.nothing))).toBeVisible();
    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, copy.expandAll) }));
    await expect(context.canvas.getByText("26 51 00")).toBeVisible();
  },
};
