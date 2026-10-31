import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";
import { storyText } from "../../storybook/locale.ts";
import { AttachmentChips, type AttachmentChipsLabels } from "./attachment-chips.tsx";

// The Work Item page's Attachments card (RP-1188, gap table row 50): a chip per Document, Open and Remove
// on each while the holder may change them, and "Attach a Document". Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  none: b("No Documents attached.", "لا توجد مستندات مرفقة."),
  attach: b("Attach a Document", "إرفاق مستند"),
  open: b("Open", "فتح"),
  remove: b("Remove", "إزالة"),
};
const labels = (context: StoryContext): AttachmentChipsLabels => ({
  none: storyText(context, copy.none),
  attach: storyText(context, copy.attach),
  open: (name) => `${storyText(context, copy.open)} ${name}`,
  remove: (name) => `${storyText(context, copy.remove)} ${name}`,
});

const documents = [
  { id: "0190a1b2-0000-7000-8000-000000000011", fileName: "Cover_letter.pdf", contentType: "application/pdf", frozen: false },
  { id: "0190a1b2-0000-7000-8000-000000000012", fileName: "Lighting_calculation.pdf", contentType: "application/pdf", frozen: true },
];

type Args = { canChange: boolean; onOpen: (id: string) => void; onRemove: (id: string) => void; onAttach: (file: File) => void };

const meta = {
  title: "Work Item page/Attachment chips",
  args: { canChange: true, onOpen: fn(), onRemove: fn(), onAttach: fn() },
  render: (args, context) => (
    <div className="max-w-2xl p-4">
      <AttachmentChips labels={labels(context)} documents={documents} accept={["application/pdf"]} help="PDF, up to 25 MB." {...args} />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The holder: each chip opens its Document; a Submitted one can't be removed; Attach a Document picks a file. */
export const Holder: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    await userEvent.click(canvas.getByRole("button", { name: `${storyText(context, copy.open)} Cover_letter.pdf` }));
    await expect(args.onOpen).toHaveBeenCalledWith(documents[0]!.id);
    await userEvent.click(canvas.getByRole("button", { name: `${storyText(context, copy.remove)} Cover_letter.pdf` }));
    await expect(args.onRemove).toHaveBeenCalledWith(documents[0]!.id);
    await expect(canvas.queryByRole("button", { name: `${storyText(context, copy.remove)} Lighting_calculation.pdf` })).toBeNull();
    const picker = canvas.getByLabelText(storyText(context, copy.attach));
    await userEvent.upload(picker, new File(["%PDF"], "Datasheet.pdf", { type: "application/pdf" }));
    await expect(args.onAttach).toHaveBeenCalledOnce();
  },
};

/** Anyone else: the chips open their Documents, with nothing to remove or attach. */
export const Reader: Story = {
  args: { canChange: false },
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getAllByRole("button")).toHaveLength(2);
    await expect(canvas.queryByLabelText(storyText(context, copy.attach))).toBeNull();
  },
};
