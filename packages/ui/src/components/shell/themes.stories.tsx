import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { expect } from "storybook/test";
import { storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { shellCopy, storySidebar, storyTopBar } from "../../storybook/shell.tsx";
import { themed } from "../../storybook/theme.ts";
import type { ThemeName } from "../../tokens/themes.ts";
import * as homeStories from "../views/home-cards.stories.tsx";
import * as boardStories from "../views/work-item-board.stories.tsx";
import * as listStories from "../views/work-item-list.stories.tsx";
import * as settingsStories from "../settings/settings-layout.stories.tsx";
import { AppShell } from "./app-shell.tsx";
import { PageContent } from "./page-frame.tsx";

// The two themes, each in Light and Dark (owner decision 2026-10-11): the shell around Home, the
// Kanban, the List and Settings, as the kit's background comparison shows them. Each page is the
// one its own stories show; here only the theme changes. Every combination passes the harness's
// contrast check (axe) and has its own screenshot.

type Page = "home" | "kanban" | "list" | "settings";

/** A story's render, called with its own file's args and this story's context (the locale, the theme). */
const renderOf = (story: { render?: unknown }, args: unknown, context: StoryContext): ReactNode =>
  (story.render as (args: unknown, context: StoryContext) => ReactNode)(args, context);

const content: Record<Page, (context: StoryContext) => ReactNode> = {
  home: (context) => renderOf(homeStories.default, homeStories.default.args, context),
  kanban: (context) => renderOf(boardStories.WithToolbar, boardStories.default.args, context),
  list: (context) => renderOf(listStories.default, listStories.default.args, context),
  settings: (context) => renderOf(settingsStories.Default, {}, context),
};

const current: Record<Page, string> = { home: "home", kanban: "projects", list: "projects", settings: "projects" };

function Themed({ page, context }: { page: Page; context: StoryContext }) {
  return (
    <AppShell
      sidebar={storySidebar(context, current[page])}
      topBar={storyTopBar(context)}
      menuLabel={storyText(context, shellCopy.menu)}
      closeLabel={storyText(context, shellCopy.close)}
    >
      <PageContent>{content[page](context)}</PageContent>
    </AppShell>
  );
}

const meta = {
  title: "Shell/Themes",
  // Screenshotted as a whole screen, like the shell.
  parameters: { ...overlay, layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const story = (page: Page, theme: ThemeName): Story => ({
  render: (_args, context) => <Themed page={page} context={context} />,
  parameters: themed(theme),
  play: async (context) => {
    const [family, mode] = theme.split("-");
    await expect(document.documentElement).toHaveAttribute("data-theme", family);
    await expect(document.documentElement).toHaveAttribute("data-mode", mode);
    // The sidebar is dark in every theme and mode: its text is light on it.
    const sidebar = context.canvasElement.querySelector<HTMLElement>("[data-sidebar]")!;
    const [r, g, b] = getComputedStyle(sidebar).backgroundColor.match(/\d+/g)!.map(Number);
    await expect(0.2126 * r! + 0.7152 * g! + 0.0722 * b!).toBeLessThan(60);
  },
});

export const HomeGreyLight = story("home", "grey-light");
export const HomeGreyDark = story("home", "grey-dark");
export const HomeWarmLight = story("home", "warm-light");
export const HomeWarmDark = story("home", "warm-dark");
export const KanbanGreyLight = story("kanban", "grey-light");
export const KanbanGreyDark = story("kanban", "grey-dark");
export const KanbanWarmLight = story("kanban", "warm-light");
export const KanbanWarmDark = story("kanban", "warm-dark");
export const ListGreyLight = story("list", "grey-light");
export const ListGreyDark = story("list", "grey-dark");
export const ListWarmLight = story("list", "warm-light");
export const ListWarmDark = story("list", "warm-dark");
export const SettingsGreyLight = story("settings", "grey-light");
export const SettingsGreyDark = story("settings", "grey-dark");
export const SettingsWarmLight = story("settings", "warm-light");
export const SettingsWarmDark = story("settings", "warm-dark");
