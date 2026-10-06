import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyText } from "../../storybook/locale.ts";
import { projectTabLabels, projectTabsLabel, storyProjectTabs } from "../../storybook/shell.tsx";
import type { ProjectTabKey } from "./project-tabs.tsx";

const meta = {
  title: "Shell/ProjectTabs",
  render: (_args, context) => storyProjectTabs(context),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const tabNames = (context: PlayContext) => context.canvas.getAllByRole("link").map((link) => link.textContent);
const labelsOf = (context: PlayContext, keys: ProjectTabKey[]) => keys.map((key) => storyText(context, projectTabLabels[key]));

/**
 * A Project with only Submittals Types: Dashboard, Submittals and Settings.
 * The tabs are page navigation: links in a named `nav`, the current one marked
 * `aria-current="page"`. No empty Module tab, and no placeholder.
 */
export const SubmittalsOnly: Story = {
  play: async (context) => {
    const nav = context.canvas.getByRole("navigation", { name: storyText(context, projectTabsLabel) });
    await expect(nav).toBeVisible();
    await expect(tabNames(context)).toEqual(labelsOf(context, ["dashboard", "submittals", "settings"]));
    await expect(context.canvas.getByRole("link", { name: storyText(context, projectTabLabels.submittals) })).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
};

/** A Project with Types in every Module: a tab for each, in the agreed order. */
export const EveryModule: Story = {
  render: (_args, context) => storyProjectTabs(context, "submittals", ["submittals", "inspections", "snag_list", "site_reports", "drawings"]),
  play: async (context) => {
    await expect(tabNames(context)).toEqual(
      labelsOf(context, ["dashboard", "submittals", "inspections", "snag-list", "site-reports", "drawings", "settings"]),
    );
  },
};

/** On a phone the tabs scroll sideways; the current one is scrolled into view. */
export const Phone: Story = {
  parameters: phone,
  render: (_args, context) => storyProjectTabs(context, "drawings", ["submittals", "inspections", "snag_list", "site_reports", "drawings"]),
  play: async (context) => {
    const list = context.canvas.getByRole("list");
    await expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
    const current = context.canvas.getByRole("link", { name: storyText(context, projectTabLabels.drawings) });
    const box = list.getBoundingClientRect();
    const tab = current.getBoundingClientRect();
    await expect(tab.left).toBeGreaterThanOrEqual(box.left - 1);
    await expect(tab.right).toBeLessThanOrEqual(box.right + 1);
    await expectTouchTarget(current);
    // Sideways only: the page itself hasn't scrolled.
    await expect(scrollY).toBe(0);
  },
};
