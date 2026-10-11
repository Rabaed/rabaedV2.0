import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { shellCopy, storyProjectTabs, storyProjectTitle } from "../../storybook/shell.tsx";
import { TopBar } from "./app-shell.tsx";
import { PageContent, TabsBar, TopBarTitle } from "./page-frame.tsx";

// The pieces around a page inside AppShell (RP-406): the top bar's title, the tabs band and the content area.
const meta = {
  title: "Shell/PageFrame",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Outside a Project the top bar names the place the Member is in. It is not a heading: the page keeps its own `h1`. */
export const PageTitle: Story = {
  render: (_args, context) => (
    <div className="bg-canvas">
      <TopBar title={<TopBarTitle title={storyText(context, shellCopy.projects)} />} />
      <PageContent>
        <h1 className="font-display text-h4 font-bold">{storyText(context, shellCopy.projects)}</h1>
      </PageContent>
    </div>
  ),
  play: async (context) => {
    const banner = context.canvas.getByRole("banner");
    await expect(banner).toHaveTextContent(storyText(context, shellCopy.projects));
    await expect(within(banner).queryByRole("heading")).toBeNull();
  },
};

/**
 * Inside a Project: back to the Projects page (the arrow points back: left in
 * English, right in Arabic), the Project's mark, its name and Host Company, then
 * the Project's tabs in their band and the page under them, full width.
 */
export const ProjectTitle: Story = {
  render: (_args, context) => (
    <div className="bg-canvas">
      <TopBar title={storyProjectTitle(context)} />
      <TabsBar>{storyProjectTabs(context, "dashboard")}</TabsBar>
      <PageContent>
        <div className="h-40 rounded-md border border-dashed border-border-strong" />
      </PageContent>
    </div>
  ),
  play: async (context) => {
    const banner = context.canvas.getByRole("banner");
    await expect(banner).toHaveTextContent(storyText(context, shellCopy.hostCompany));
    const back = within(banner).getByRole("link", { name: storyText(context, shellCopy.back) });
    const title = within(banner).getByText(storyText(context, shellCopy.project)).getBoundingClientRect();
    // The back link sits before the name: on its left in English, its right in Arabic.
    if (storyLocale(context) === "ar") await expect(back.getBoundingClientRect().left).toBeGreaterThan(title.right);
    else await expect(back.getBoundingClientRect().right).toBeLessThan(title.left);
  },
};
