import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";
import { storyText } from "../../storybook/locale.ts";
import { WatermarkSetting, type WatermarkSettingLabels } from "./watermark-setting.tsx";

// The Working Copy's watermark (RP-621), on Project → Settings → Documental Record. No reference
// screen yet (RP-665): it follows the settings cards around it.
const meta = {
  title: "Settings/WatermarkSetting",
  component: WatermarkSetting,
  parameters: { layout: "padded" },
} satisfies Meta<typeof WatermarkSetting>;

export default meta;
type Story = StoryObj<typeof meta>;

const copy = {
  title: { en: "Working Copy watermark", ar: "العلامة المائية لنسخة العمل" },
  description: {
    en: "Printed across every page of a Working Copy, the PDF of an item that isn't closed, so nobody takes it for the record.",
    ar: "تُطبع على كل صفحة من نسخة العمل، وهي ملف PDF لعنصر لم يُغلق، حتى لا يظنها أحد السجل.",
  },
  en: { en: "English text", ar: "النص الإنجليزي" },
  ar: { en: "Arabic text", ar: "النص العربي" },
  help: { en: "Both languages, up to 60 characters each. A change applies to Working Copies made afterwards.", ar: "باللغتين، حتى 60 حرفًا لكل منهما. يسري التغيير على نسخ العمل التي تُعدّ بعده." },
  save: { en: "Save watermark", ar: "حفظ العلامة المائية" },
  saved: { en: "Saved", ar: "تم الحفظ" },
  closed: { en: "This Project is closed.", ar: "هذا المشروع مغلق." },
};

const labels = (context: { globals: Record<string, unknown> }): WatermarkSettingLabels =>
  Object.fromEntries(Object.entries(copy).map(([key, text]) => [key, storyText(context, text)])) as WatermarkSettingLabels;

const base = { value: { en: "Not Final", ar: "غير نهائي" }, maxLength: 60 };

/** The Project's text as it is (the default); Save waits for a change. */
export const Default: Story = {
  args: { ...base, labels: {} as WatermarkSettingLabels, onSave: fn(async () => null) },
  render: (args, context) => <WatermarkSetting {...args} labels={labels(context)} />,
  play: async (context) => {
    const { canvas, args } = context;
    const en = canvas.getByRole("textbox", { name: storyText(context, copy.en) });
    const ar = canvas.getByRole("textbox", { name: storyText(context, copy.ar) });
    await expect(en).toHaveValue("Not Final");
    await expect(ar).toHaveValue("غير نهائي");
    await expect(ar).toHaveAttribute("dir", "rtl");
    await expect(en).toHaveAttribute("dir", "ltr");
    const save = canvas.getByRole("button", { name: storyText(context, copy.save) });
    await expect(save).toBeDisabled();
    await userEvent.clear(en);
    await userEvent.type(en, "  For review ");
    await userEvent.click(save);
    await expect(args.onSave).toHaveBeenCalledWith({ en: "For review", ar: "غير نهائي" });
    await expect(await canvas.findByRole("status")).toHaveTextContent(storyText(context, copy.saved));
  },
};

/** Never empty: with either language cleared, nothing can be saved. */
export const Empty: Story = {
  args: { ...base, labels: {} as WatermarkSettingLabels, onSave: fn(async () => null) },
  render: (args, context) => <WatermarkSetting {...args} labels={labels(context)} />,
  play: async (context) => {
    const { canvas, args } = context;
    await userEvent.clear(canvas.getByRole("textbox", { name: storyText(context, copy.ar) }));
    const save = canvas.getByRole("button", { name: storyText(context, copy.save) });
    await expect(save).toBeDisabled();
    await userEvent.type(canvas.getByRole("textbox", { name: storyText(context, copy.en) }), "{Enter}");
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};

/** The save refused (the Project closed meanwhile): the message, and the text kept as typed. */
export const Refused: Story = {
  args: { ...base, labels: {} as WatermarkSettingLabels, onSave: fn(async () => "closed") },
  render: (args, context) => <WatermarkSetting {...args} labels={labels(context)} onSave={async (next) => (await args.onSave(next)) && storyText(context, copy.closed)} />,
  play: async (context) => {
    const { canvas } = context;
    const en = canvas.getByRole("textbox", { name: storyText(context, copy.en) });
    await userEvent.type(en, " copy");
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.save) }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(storyText(context, copy.closed));
    await expect(en).toHaveValue("Not Final copy");
  },
};

/** A Member who is no Project Admin reads it only: no Save. */
export const ReadOnly: Story = {
  args: { ...base, labels: {} as WatermarkSettingLabels, onSave: fn(async () => null), readOnly: true },
  render: (args, context) => <WatermarkSetting {...args} labels={labels(context)} />,
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getByRole("textbox", { name: storyText(context, copy.en) })).toHaveAttribute("readonly");
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};
