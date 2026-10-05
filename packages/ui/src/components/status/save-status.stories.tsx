import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { SaveStatus } from "./save-status.tsx";

const meta = {
  title: "Status/SaveStatus",
  component: SaveStatus,
  args: { savedAt: "2026-10-05T07:15:00.000Z", locale: "en" },
  render: (args, context) => <SaveStatus {...args} locale={storyLocale(context)} />,
} satisfies Meta<typeof SaveStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

/** When the item was last saved, in Saudi time with Latin digits. */
export const Saved: Story = {
  play: async (context) => {
    const text = storyText(context, { en: "Saved 10:15", ar: "تم الحفظ 10:15" });
    await expect(context.canvas.getByText(new RegExp(`^${text}`))).toBeInTheDocument();
  },
};

/** A field another Member changed while this editor was typing is kept as theirs, with their name. */
export const ChangedByAnotherMember: Story = {
  render: (args, context) => {
    const ar = storyLocale(context) === "ar";
    return (
      <SaveStatus
        {...args}
        locale={storyLocale(context)}
        changedByOthers={[{ fieldLabel: ar ? "الوصف" : "Description", memberName: ar ? "عمر" : "Omar" }]}
      />
    );
  },
  play: async (context) => {
    const text = storyText(context, {
      en: "Description changed by Omar just now",
      ar: "الوصف: غُيّر بواسطة عمر قبل لحظات",
    });
    await expect(context.canvas.getByText(text)).toBeInTheDocument();
  },
};

/** Before the first save and with nothing changed by others, there is nothing to say beside the Save button. */
export const Nothing: Story = {
  args: { savedAt: null },
  // SaveStatus renders nothing, so the story shows it beside the button it sits next to.
  render: (args, context) => (
    <div className="flex items-center gap-3">
      <button type="button">{storyLocale(context) === "ar" ? "حفظ" : "Save"}</button>
      <SaveStatus {...args} locale={storyLocale(context)} />
    </div>
  ),
  play: async (context) => {
    await expect(context.canvas.queryByRole("status")).toBeNull();
  },
};
