import { formatNumber } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";
import { expectTabFocusRing, expectTouchTarget, phone, press } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.tsx";

const tabs = {
  dashboard: { en: "Dashboard", ar: "لوحة المعلومات" },
  submittals: { en: "Submittals", ar: "الاعتمادات" },
  inspections: { en: "Inspections", ar: "الفحوصات" },
  schedule: { en: "Schedule", ar: "الجدول الزمني" },
};
const panels = {
  dashboard: { en: "Activity across the Project.", ar: "النشاط في المشروع." },
  submittals: { en: "Every Submittal in the Project.", ar: "كل الاعتمادات في المشروع." },
  inspections: { en: "Every Inspection in the Project.", ar: "كل الفحوصات في المشروع." },
};
const listLabel = { en: "Project", ar: "المشروع" };

const meta = {
  title: "Navigation/Tabs",
  component: Tabs,
  render: (args, context) => (
    <Tabs {...args}>
      <TabsList aria-label={storyText(context, listLabel)}>
        <TabsTrigger value="dashboard" icon="layout-dashboard">
          {storyText(context, tabs.dashboard)}
        </TabsTrigger>
        <TabsTrigger value="submittals" icon="file-text" count={formatNumber(231, storyLocale(context))}>
          {storyText(context, tabs.submittals)}
        </TabsTrigger>
        <TabsTrigger value="inspections" icon="clipboard-check" count={formatNumber(18, storyLocale(context))}>
          {storyText(context, tabs.inspections)}
        </TabsTrigger>
        <TabsTrigger value="schedule" icon="calendar" disabled>
          {storyText(context, tabs.schedule)}
        </TabsTrigger>
      </TabsList>
      {(["dashboard", "submittals", "inspections"] as const).map((key) => (
        <TabsContent key={key} value={key} className="py-4 text-body text-text">
          {storyText(context, panels[key])}
        </TabsContent>
      ))}
    </Tabs>
  ),
  args: { defaultValue: "dashboard" },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const tab = (context: PlayContext, key: keyof typeof tabs) =>
  context.canvas.getByRole("tab", { name: new RegExp(`^${storyText(context, tabs[key])}`) });
const forward = (context: StoryContext) => (storyLocale(context) === "ar" ? "ArrowLeft" : "ArrowRight");
const back = (context: StoryContext) => (storyLocale(context) === "ar" ? "ArrowRight" : "ArrowLeft");

/**
 * The ARIA tabs pattern: a named tablist, one tab selected, its panel labelled
 * by it. Tab reaches the selected tab; the arrow pointing along the reading
 * direction (→ in English, ← in Arabic) selects the next one, Home and End the
 * first and last. The disabled tab is skipped.
 */
export const Default: Story = {
  play: async (context) => {
    await expect(context.canvas.getByRole("tablist", { name: storyText(context, listLabel) })).toBeVisible();
    await expect(tab(context, "dashboard")).toHaveAttribute("aria-selected", "true");
    await expect(context.canvas.getByRole("tabpanel", { name: storyText(context, tabs.dashboard) })).toHaveTextContent(
      storyText(context, panels.dashboard),
    );

    await expectTabFocusRing(tab(context, "dashboard"));
    await press(forward(context));
    await expect(tab(context, "submittals")).toHaveFocus();
    await expect(tab(context, "submittals")).toHaveAttribute("aria-selected", "true");
    await expect(context.canvas.getByRole("tabpanel")).toHaveTextContent(storyText(context, panels.submittals));

    await press(back(context));
    await expect(tab(context, "dashboard")).toHaveAttribute("aria-selected", "true");

    await press("End");
    await expect(tab(context, "inspections")).toHaveAttribute("aria-selected", "true");
    await expect(tab(context, "schedule")).toBeDisabled();
    await press("Home");
    await expect(tab(context, "dashboard")).toHaveFocus();

    await userEvent.click(tab(context, "inspections"));
    await expect(context.canvas.getByRole("tabpanel")).toHaveTextContent(storyText(context, panels.inspections));
  },
};

/** Tabs run in the reading direction: the first tab is leftmost in English, rightmost in Arabic. */
export const Mirrored: Story = {
  args: { defaultValue: "submittals" },
  play: async (context) => {
    const first = tab(context, "dashboard").getBoundingClientRect();
    const second = tab(context, "submittals").getBoundingClientRect();
    await expect(storyLocale(context) === "ar" ? first.left > second.left : first.left < second.left).toBe(true);
    // The count is part of the tab's name.
    await expect(tab(context, "submittals")).toHaveAccessibleName(`${storyText(context, tabs.submittals)} 231`);
  },
};

/** On a phone: the tab bar scrolls sideways, and every tab is at least 44 × 44px. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    for (const key of ["dashboard", "submittals", "inspections"] as const) await expectTouchTarget(tab(context, key));
  },
};
