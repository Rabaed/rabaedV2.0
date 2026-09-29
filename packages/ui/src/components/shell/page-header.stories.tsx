import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { storyText } from "../../storybook/locale.ts";
import { projectTabsLabel, shellCopy, storyPageHeader } from "../../storybook/shell.tsx";
import { PageHeader } from "./page-header.tsx";

const meta = {
  title: "Shell/PageHeader",
  render: (_args, context) => storyPageHeader(context),
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A Project page: its number above, its name as the page's one heading, an action, and the Project tabs. */
export const WithProjectTabs: Story = {
  play: async (context) => {
    await expect(context.canvas.getByRole("heading", { level: 1 })).toHaveTextContent(storyText(context, shellCopy.project));
    await expect(context.canvas.getByRole("button", { name: storyText(context, shellCopy.newSubmittal) })).toBeVisible();
    await expect(context.canvas.getByRole("navigation", { name: storyText(context, projectTabsLabel) })).toBeVisible();
  },
};

/** A page with a title only. */
export const TitleOnly: Story = {
  render: (_args, context) => <PageHeader title={storyText(context, shellCopy.members)} />,
  play: async (context) => {
    await expect(context.canvas.getByRole("heading", { level: 1 })).toHaveTextContent(storyText(context, shellCopy.members));
  },
};
