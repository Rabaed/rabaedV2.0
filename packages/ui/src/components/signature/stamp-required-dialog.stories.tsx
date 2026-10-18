import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { buttonVariants } from "../button/button.tsx";
import { addStampLabel, stampRequiredLabels, storyCompanyName } from "../../storybook/company-images.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { StampRequiredDialog } from "./stamp-required-dialog.tsx";

// No Stamp, no Transition (RP-617): the message a Member gets when they open a Transition while
// their own Company has no Stamp, before its Action Form. Story data only (a made-up Company).

const meta = {
  title: "People/StampRequiredDialog",
  component: StampRequiredDialog,
  args: { labels: stampRequiredLabels.member.en, open: true, onOpenChange: fn() },
  render: (args, context) => <StampRequiredDialog {...args} labels={stampRequiredLabels.member[storyLocale(context)]} />,
  parameters: overlay,
} satisfies Meta<typeof StampRequiredDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A Member: names only their own Company, says its owner or Authorized Person must add the
 * Stamp, and offers nothing to do but close it. No Action Form. Left open for the screenshot.
 */
export const ForAMember: Story = {
  play: async (context) => {
    const locale = storyLocale(context);
    const l = stampRequiredLabels.member[locale];
    const panel = await screen.findByRole("dialog", { name: l.title });
    await expect(panel).toHaveAccessibleDescription(l.body);
    await expect(panel).toHaveTextContent(storyCompanyName[locale]);
    await expect(within(panel).queryByRole("link")).toBeNull();
    await expect(within(panel).queryByRole("textbox")).toBeNull();
    await expect(within(panel).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([l.close, l.dismiss]);
  },
};

/** The Authorized Person: the way to add the Stamp in the Company profile, and "Not now". */
export const ForTheAuthorizedPerson: Story = {
  render: (args, context) => (
    <StampRequiredDialog
      {...args}
      labels={stampRequiredLabels.authorizedPerson[storyLocale(context)]}
      addStamp={
        <a href="#/company" className={buttonVariants()}>
          {addStampLabel[storyLocale(context)]}
        </a>
      }
    />
  ),
  play: async (context) => {
    const locale = storyLocale(context);
    const l = stampRequiredLabels.authorizedPerson[locale];
    const panel = await screen.findByRole("dialog", { name: l.title });
    await expect(panel).toHaveAccessibleDescription(l.body);
    await expect(within(panel).getByRole("link", { name: addStampLabel[locale] })).toHaveAttribute("href", "#/company");
  },
};

/** Closing it does nothing else. */
export const Dismiss: Story = {
  play: async (context) => {
    const l = stampRequiredLabels.member[storyLocale(context)];
    const panel = await screen.findByRole("dialog", { name: l.title });
    await userEvent.click(within(panel).getByRole("button", { name: l.dismiss }));
    await expect(context.args.onOpenChange).toHaveBeenCalledWith(false);
  },
};
