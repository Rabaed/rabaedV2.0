import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor } from "storybook/test";
import { phone } from "../../storybook/form.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { signatureEditorLabels } from "../../storybook/signature.ts";
import { SignatureEditor, type SaveSignatureCall } from "./signature-editor.tsx";

// Profile → Add Signature (RP-85, ADR 0023): draw (pen style and ink), type in a handwriting
// style, or upload an image. Each is saved as an image. Story data only.

const names = { en: "Hafiz Hamdan", ar: "حافظ حمدان" };
const ok: SaveSignatureCall = async () => ({ ok: true });

const meta = {
  title: "People/SignatureEditor",
  component: SignatureEditor,
  args: { labels: signatureEditorLabels.en, defaultName: names.en, onSave: fn<SaveSignatureCall>(ok) },
  render: (args, context) => (
    <SignatureEditor {...args} labels={signatureEditorLabels[storyLocale(context)]} defaultName={names[storyLocale(context)]} />
  ),
  decorators: [(Story) => <div className="max-w-2xl">{Story()}</div>],
} satisfies Meta<typeof SignatureEditor>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const labelsOf = (context: PlayContext) => signatureEditorLabels[storyLocale(context)];

/** A pen stroke across the pad, as a mouse draws it. */
async function drawOn(pad: HTMLElement) {
  const box = pad.getBoundingClientRect();
  const at = (fx: number, fy: number) => ({ clientX: box.left + box.width * fx, clientY: box.top + box.height * fy, buttons: 1, pointerId: 1, bubbles: true });
  pad.dispatchEvent(new PointerEvent("pointerdown", at(0.1, 0.6)));
  for (const [x, y] of [
    [0.2, 0.3],
    [0.35, 0.7],
    [0.5, 0.35],
    [0.7, 0.65],
    [0.85, 0.4],
  ] as const) {
    pad.dispatchEvent(new PointerEvent("pointermove", at(x, y)));
  }
  pad.dispatchEvent(new PointerEvent("pointerup", at(0.85, 0.4)));
}

/** The image a Save sent, decoded: its first bytes say it is a PNG. */
const isPng = (data: string) => atob(data).startsWith("\x89PNG");

/**
 * Draw (the first way): a pen style and an ink, then a stroke on the pad. Save sends it
 * as a drawn PNG. Nothing drawn yet, Save says so instead.
 */
export const Draw: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    const l = labelsOf(context);
    await expect(canvas.getByRole("tab", { name: l.drawn })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(canvas.getByRole("button", { name: l.save }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(l.empty);
    await expect(args.onSave).not.toHaveBeenCalled();

    await userEvent.click(canvas.getByRole("radio", { name: l.pens.bold }));
    await userEvent.click(canvas.getByRole("radio", { name: l.inks.blue }));
    await drawOn(canvas.getByRole("img", { name: l.pad }));
    await expect(canvas.getByRole("button", { name: l.clear })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: l.save }));
    await waitFor(() => expect(args.onSave).toHaveBeenCalledOnce());
    const sent = (args.onSave as ReturnType<typeof fn<SaveSignatureCall>>).mock.calls[0]![0];
    await expect(sent).toMatchObject({ method: "drawn", contentType: "image/png" });
    await expect(isPng(sent.data)).toBe(true);
  },
};

/** Type: the Member's name in a handwriting style and ink, previewed; Save sends it as a typed PNG. */
export const Type: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    const l = labelsOf(context);
    await userEvent.click(canvas.getByRole("tab", { name: l.typed }));
    await expect(canvas.getByRole("textbox", { name: l.name })).toHaveValue(names[storyLocale(context)]);
    await userEvent.click(canvas.getByRole("radio", { name: l.hands.upright }));
    await expect(canvas.getByRole("img", { name: `${l.preview}: ${names[storyLocale(context)]}` })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: l.save }));
    await waitFor(() => expect(args.onSave).toHaveBeenCalledOnce());
    const sent = (args.onSave as ReturnType<typeof fn<SaveSignatureCall>>).mock.calls[0]![0];
    await expect(sent).toMatchObject({ method: "typed", contentType: "image/png" });
    await expect(isPng(sent.data)).toBe(true);
  },
};

/** A tiny PNG, as an uploaded image of a Signature. */
const tinyPng = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

/** Upload: a PNG or JPEG up to 512 KB, previewed, sent as uploaded. Anything else is refused before it is sent. */
export const Upload: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    const l = labelsOf(context);
    await userEvent.click(canvas.getByRole("tab", { name: l.uploaded }));
    const input = canvas.getByLabelText(l.file);
    await userEvent.upload(input, new File(["<svg/>"], "signature.svg", { type: "image/svg+xml" }), { applyAccept: false });
    await expect(await canvas.findByRole("alert")).toHaveTextContent(l.refusals.file_type);
    await userEvent.upload(input, new File([tinyPng], "signature.png", { type: "image/png" }));
    await expect(await canvas.findByRole("img", { name: l.preview })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: l.save }));
    await waitFor(() => expect(args.onSave).toHaveBeenCalledOnce());
    await expect((args.onSave as ReturnType<typeof fn<SaveSignatureCall>>).mock.calls[0]![0]).toMatchObject({ method: "uploaded", contentType: "image/png" });
  },
};

/** The api refused the image: it says so, in the Member's language, and the editor stays as it was. */
export const Refused: Story = {
  args: { onSave: fn<SaveSignatureCall>(async () => ({ ok: false, reason: "invalid_signature_image" })) },
  play: async (context) => {
    const { canvas } = context;
    const l = labelsOf(context);
    await drawOn(canvas.getByRole("img", { name: l.pad }));
    await userEvent.click(canvas.getByRole("button", { name: l.save }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(l.refusals.invalid_signature_image);
  },
};

/** At phone width: drawing with a finger, the pad fills the width and nothing scrolls sideways. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    const pad = context.canvas.getByRole("img", { name: labelsOf(context).pad });
    await expect(pad.getBoundingClientRect().width).toBeLessThanOrEqual(document.documentElement.clientWidth);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  },
};
