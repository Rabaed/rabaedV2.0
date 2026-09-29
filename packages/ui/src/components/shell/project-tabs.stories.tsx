import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyText } from "../../storybook/locale.ts";
import { comingSoon, projectTabLabels, projectTabsLabel, storyProjectTabs } from "../../storybook/shell.tsx";
import { projectTabKeys } from "./project-tabs.tsx";

const meta = {
  title: "Shell/ProjectTabs",
  render: (_args, context) => storyProjectTabs(context),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The Project's tabs, always in the agreed order. They are page navigation:
 * links in a named `nav`, the current one marked `aria-current="page"`.
 * Schedule is not built yet: greyed out, announced as unavailable, with a
 * "Coming soon" hint.
 */
export const Tabs: Story = {
  play: async (context) => {
    const nav = context.canvas.getByRole("navigation", { name: storyText(context, projectTabsLabel) });
    await expect(nav).toBeVisible();
    const links = context.canvas.getAllByRole("link");
    await expect(links.map((link) => link.textContent)).toEqual(projectTabKeys.map((key) => storyText(context, projectTabLabels[key])));
    await expect(context.canvas.getByRole("link", { name: storyText(context, projectTabLabels.submittals) })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const schedule = context.canvas.getByRole("link", { name: storyText(context, projectTabLabels.schedule) });
    await expect(schedule).toHaveAttribute("aria-disabled", "true");
    await expect(schedule).not.toHaveAttribute("href");
    await expect(schedule).toHaveAccessibleDescription(storyText(context, comingSoon));
  },
};

/** The Coming soon hint shows on hover or keyboard focus. */
export const ComingSoonHint: Story = {
  play: async (context) => {
    const schedule = context.canvas.getByRole("link", { name: storyText(context, projectTabLabels.schedule) });
    schedule.focus();
    await expect(await screen.findByRole("tooltip")).toHaveTextContent(storyText(context, comingSoon));
    // Pressing it does nothing: there is nowhere to go yet.
    await userEvent.keyboard("{Enter}");
    await expect(location.hash).not.toContain("schedule");
  },
};

/** On a phone the tabs scroll sideways; the current one is scrolled into view. */
export const Phone: Story = {
  parameters: phone,
  render: (_args, context) => storyProjectTabs(context, "views"),
  play: async (context) => {
    const list = context.canvas.getByRole("list");
    await expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
    const current = context.canvas.getByRole("link", { name: storyText(context, projectTabLabels.views) });
    const box = list.getBoundingClientRect();
    const tab = current.getBoundingClientRect();
    await expect(tab.left).toBeGreaterThanOrEqual(box.left - 1);
    await expect(tab.right).toBeLessThanOrEqual(box.right + 1);
    await expectTouchTarget(current);
    // Sideways only: the page itself hasn't scrolled.
    await expect(scrollY).toBe(0);
  },
};
