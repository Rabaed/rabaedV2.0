import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { buttonVariants } from "../button/button.tsx";
import { storyLocale } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { addSignatureLabel, signatureRequiredLabels } from "../../storybook/signature.ts";
import { SignatureRequiredDialog } from "./signature-required-dialog.tsx";

// No Signature, no Transition (RP-85): the pop-up a Member without a Signature gets when
// they open a Transition, before its Action Form. Story data only.

const meta = {
  title: "People/SignatureRequiredDialog",
  component: SignatureRequiredDialog,
  args: { labels: signatureRequiredLabels.en, open: true, onOpenChange: fn(), addSignature: null },
  render: (args, context) => (
    <SignatureRequiredDialog
      {...args}
      labels={signatureRequiredLabels[storyLocale(context)]}
      addSignature={
        <a href="#/profile/signature?returnTo=/work-items/1" className={buttonVariants()}>
          {addSignatureLabel[storyLocale(context)]}
        </a>
      }
    />
  ),
  parameters: overlay,
} satisfies Meta<typeof SignatureRequiredDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Says why, names nothing but the Member's own missing Signature, and links to Add
 * Signature with the way back to the item. No Action Form, no "Sign" button. Left open for
 * the screenshot.
 */
export const AsksForASignature: Story = {
  play: async (context) => {
    const locale = storyLocale(context);
    const l = signatureRequiredLabels[locale];
    const panel = await screen.findByRole("dialog", { name: l.title });
    await expect(panel).toHaveAccessibleDescription(l.body);
    await expect(within(panel).getByRole("link", { name: addSignatureLabel[locale] })).toHaveAttribute(
      "href",
      "#/profile/signature?returnTo=/work-items/1",
    );
    await expect(within(panel).queryByRole("textbox")).toBeNull();
    // Only Close and "Not now": no "Sign" button and no checkbox (ADR 0017).
    await expect(within(panel).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([l.close, l.notNow]);
    await expect(within(panel).queryByRole("checkbox")).toBeNull();
  },
};

/** "Not now" closes it; nothing else happens. */
export const NotNow: Story = {
  play: async (context) => {
    const l = signatureRequiredLabels[storyLocale(context)];
    const panel = await screen.findByRole("dialog", { name: l.title });
    await userEvent.click(within(panel).getByRole("button", { name: l.notNow }));
    await expect(context.args.onOpenChange).toHaveBeenCalledWith(false);
  },
};
