import { formSchema } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { storyLocale } from "../../storybook/locale.ts";
import { PuckFormBuilderPrototype } from "./form-builder.prototype.tsx";

// PROTOTYPE, throwaway (RP-19). Puck as the Form builder: switch EN/AR in the
// toolbar for the editor's language and direction; "Preview" in Puck's header
// switches the canvas's language alone. The state panel under the editor shows
// the formSchema the adapter makes, live and on Publish (Save), with
// formSchema.parse and publishProblems.
const initial = formSchema.parse({
  sections: [
    {
      key: "general",
      title: { en: "General", ar: "عام" },
      fields: [
        { key: "trade", type: "trade", label: { en: "Trade", ar: "التخصص" } },
        { key: "location", type: "location", label: { en: "Location", ar: "الموقع" } },
        { key: "scopes", type: "scopes", label: { en: "Scopes", ar: "النطاقات" } },
        { key: "subject_note", type: "text", required: true, label: { en: "Pour reference", ar: "مرجع الصب" }, maxLength: 120 },
      ],
    },
    {
      key: "inspection",
      title: { en: "Inspection", ar: "الفحص" },
      fields: [
        {
          key: "concrete_grade",
          type: "select",
          required: true,
          label: { en: "Concrete grade", ar: "درجة الخرسانة" },
          options: [
            { value: "c30", label: { en: "C30", ar: "C30" } },
            { value: "c40", label: { en: "C40", ar: "C40" } },
          ],
        },
        {
          key: "pour_check",
          type: "checklist",
          required: true,
          label: { en: "Pour check", ar: "فحص الصب" },
          items: [
            { key: "rebar_cover", text: { en: "Rebar cover as per drawing", ar: "الغطاء الخرساني للحديد حسب المخطط" }, comment: "required_on_negative", photo: "required_on_negative" },
            { key: "permit_on_site", text: { en: "Pour permit is on site", ar: "تصريح الصب موجود في الموقع" }, answers: "yes_no_na", comment: "off" },
          ],
        },
      ],
    },
  ],
});

const meta = {
  title: "Prototypes/Puck form builder",
  parameters: { layout: "fullscreen", a11y: { test: "off" } },
  // Throwaway: kept out of the story test harness.
  tags: ["!test"],
} satisfies Meta;

export default meta;

export const Builder: StoryObj = {
  render: (_args, context) => <PuckFormBuilderPrototype initial={initial} ui={storyLocale(context)} />,
};
