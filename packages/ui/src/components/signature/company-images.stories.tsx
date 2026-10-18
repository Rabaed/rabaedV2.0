import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { companyImagesLabels, storyLogoUrl, storyStampUrl } from "../../storybook/company-images.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { CompanyImages } from "./company-images.tsx";

// The Company profile's logo and Stamp (RP-617): the Authorized Person uploads them, every other
// Member of the Company sees them. Story data only (made-up images).

const meta = {
  title: "People/CompanyImages",
  component: CompanyImages,
  args: { labels: companyImagesLabels.en, logo: null, stamp: null, canManage: true, onUpload: fn(async () => ({ ok: true as const })) },
  render: (args, context) => (
    <div className="max-w-3xl">
      <CompanyImages {...args} labels={companyImagesLabels[storyLocale(context)]} />
    </div>
  ),
} satisfies Meta<typeof CompanyImages>;

export default meta;
type Story = StoryObj<typeof meta>;

const pngFile = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "stamp.png", { type: "image/png" });

/** The Authorized Person, before any upload: the notice that nobody can act, and both file controls. */
export const NoStampYet: Story = {
  play: async (context) => {
    const l = companyImagesLabels[storyLocale(context)];
    const canvas = within(context.canvasElement);
    await expect(canvas.getByRole("note")).toHaveTextContent(l.noStamp);
    await expect(canvas.getByLabelText(l.logo.upload)).toBeInTheDocument();
    await expect(canvas.getByLabelText(l.stamp.upload)).toBeInTheDocument();
    await expect(canvas.queryByRole("img")).toBeNull();
  },
};

/**
 * Each file control is a button in the page's language, never the browser's own "Choose File":
 * the input itself is visually hidden inside the button that names it, and its help describes it.
 */
export const FileButtonsInThePageLanguage: Story = {
  play: async (context) => {
    const l = companyImagesLabels[storyLocale(context)];
    const canvas = within(context.canvasElement);
    for (const card of [l.logo, l.stamp]) {
      const input = canvas.getByLabelText(card.upload);
      await expect(input).toHaveAttribute("type", "file");
      await expect(input.getBoundingClientRect().width).toBeLessThanOrEqual(1);
      await expect(within(input.closest("label")!).getByText(card.upload)).toBeVisible();
      await expect(input).toHaveAccessibleDescription(card.fileHelp);
    }
  },
};

/** Choosing a file uploads it as the Stamp, as base64. */
export const UploadsTheStamp: Story = {
  play: async (context) => {
    const l = companyImagesLabels[storyLocale(context)];
    const canvas = within(context.canvasElement);
    await userEvent.upload(canvas.getByLabelText(l.stamp.upload), pngFile());
    await waitFor(() => expect(context.args.onUpload).toHaveBeenCalledWith("stamp", { contentType: "image/png", data: "iVBORw0KGgo=" }));
  },
};

/** A file that isn't a PNG or JPEG is refused in the page, before anything is sent. */
export const RefusesOtherFiles: Story = {
  play: async (context) => {
    const l = companyImagesLabels[storyLocale(context)];
    const canvas = within(context.canvasElement);
    const input = canvas.getByLabelText(l.logo.upload);
    await userEvent.upload(input, new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }), { applyAccept: false });
    await expect(await canvas.findByText(l.refusals.file_type)).toBeInTheDocument();
    await expect(context.args.onUpload).not.toHaveBeenCalled();
  },
};

/** Another Member of the Company: both images, no notice, and no file controls. */
export const AsAnotherMember: Story = {
  args: { logo: { url: storyLogoUrl }, stamp: { url: storyStampUrl }, canManage: false },
  play: async (context) => {
    const l = companyImagesLabels[storyLocale(context)];
    const canvas = within(context.canvasElement);
    await expect(canvas.getByRole("img", { name: l.logo.imageAlt })).toBeInTheDocument();
    await expect(canvas.getByRole("img", { name: l.stamp.imageAlt })).toBeInTheDocument();
    await expect(canvas.queryByRole("note")).toBeNull();
    await expect(canvas.queryByLabelText(l.stamp.replace)).toBeNull();
  },
};

/** The Authorized Person with both added: Replace on each. */
export const BothAdded: Story = {
  args: { logo: { url: storyLogoUrl }, stamp: { url: storyStampUrl } },
  play: async (context) => {
    const l = companyImagesLabels[storyLocale(context)];
    const canvas = within(context.canvasElement);
    await expect(canvas.getByLabelText(l.logo.replace)).toBeInTheDocument();
    await expect(canvas.getByLabelText(l.stamp.replace)).toBeInTheDocument();
  },
};
