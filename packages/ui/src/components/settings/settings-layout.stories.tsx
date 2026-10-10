import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { Badge } from "../data/badge.tsx";
import { SettingsHeader, SettingsLayout, SettingsNav, SettingsSection, type SettingsNavItem } from "./settings-layout.tsx";

// The template of the Project Settings pages (RP-412): the settings navigation
// beside the page (a select above it on a phone) and the page's section cards.
const meta = {
  title: "Settings/SettingsLayout",
  parameters: { layout: "fullscreen" },
} satisfies Meta<{ onNavigate?: (href: string) => void }>;

export default meta;
type Story = StoryObj<{ onNavigate?: (href: string) => void }>;

const copy = {
  heading: { en: "Project settings", ar: "إعدادات المشروع" },
  numbering: { en: "Document Numbering", ar: "ترقيم المستندات" },
  trades: { en: "Trades & Locations", ar: "التخصصات والمواقع" },
  visibility: { en: "Visibility", ar: "الرؤية" },
  title: { en: "Document Numbering", ar: "ترقيم المستندات" },
  description: {
    en: "How this Project builds its Document Numbers.",
    ar: "كيف يبني هذا المشروع أرقام مستنداته.",
  },
  readOnly: { en: "Only Project Admins can change this", ar: "يمكن لمديري المشروع فقط تغيير هذا" },
  pattern: { en: "Project pattern", ar: "نمط المشروع" },
  patternHint: { en: "Applies to every Work Item Type without its own.", ar: "ينطبق على كل نوع عمل بلا نمط خاص." },
  overrides: { en: "Overrides per Work Item Type", ar: "الاستثناءات لكل نوع عمل" },
  count: { en: "4 of 6", ar: "4 من 6" },
};

const items = (context: { globals: Record<string, unknown> }): SettingsNavItem[] => [
  { key: "numbering", label: storyText(context, copy.numbering), icon: "list", href: "#/numbering" },
  { key: "trades-locations", label: storyText(context, copy.trades), icon: "map-pin", href: "#/trades-locations" },
  { key: "visibility", label: storyText(context, copy.visibility), icon: "eye", href: "#/visibility" },
];

function Page({ context, readOnly = false, onNavigate }: { context: { globals: Record<string, unknown> }; readOnly?: boolean; onNavigate?: (href: string) => void }) {
  return (
    <div className="bg-canvas p-4 sm:p-7">
      <SettingsLayout
        nav={<SettingsNav heading={storyText(context, copy.heading)} items={items(context)} current="numbering" onNavigate={onNavigate ?? fn()} />}
      >
        <SettingsHeader
          title={storyText(context, copy.title)}
          description={storyText(context, copy.description)}
          readOnlyLabel={readOnly ? storyText(context, copy.readOnly) : undefined}
        />
        <SettingsSection
          title={storyText(context, copy.pattern)}
          description={storyText(context, copy.patternHint)}
          actions={<Badge tone="neutral">{storyText(context, copy.count)}</Badge>}
        >
          <div className="h-24 rounded-md border border-dashed border-border-strong" />
        </SettingsSection>
        <SettingsSection title={storyText(context, copy.overrides)}>
          <div className="h-16 rounded-md border border-dashed border-border-strong" />
        </SettingsSection>
      </SettingsLayout>
    </div>
  );
}

/** The navigation on the inline-start side (the right in Arabic), the current page marked, and the cards beside it. */
export const Default: Story = {
  render: (_args, context) => <Page context={context} />,
  play: async (context) => {
    const nav = context.canvas.getByRole("navigation", { name: storyText(context, copy.heading) });
    await expect(within(nav).getByRole("link", { name: storyText(context, copy.numbering) })).toHaveAttribute("aria-current", "page");
    await expect(within(nav).getAllByRole("link")).toHaveLength(3);
    await expect(context.canvas.getByRole("heading", { level: 1, name: storyText(context, copy.title) })).toBeVisible();
    await expect(context.canvas.getByRole("heading", { level: 2, name: storyText(context, copy.pattern) })).toBeVisible();
    // The navigation is before the page on the inline-start side.
    const dir = storyLocale(context) === "ar" ? -1 : 1;
    const navBox = nav.getBoundingClientRect();
    const pageBox = context.canvas.getByRole("heading", { level: 1 }).getBoundingClientRect();
    await expect(Math.sign(pageBox.left - navBox.left)).toBe(dir);
  },
};

/** Whoever may read the page but not change it sees a note in the header. */
export const ReadOnly: Story = {
  render: (_args, context) => <Page context={context} readOnly />,
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, copy.readOnly))).toBeVisible();
  },
};

/** On a phone the navigation is a select above the page; choosing a page navigates. */
export const Phone: Story = {
  parameters: { ...phone, layout: "fullscreen" },
  args: { onNavigate: fn() },
  render: (args, context) => <Page context={context} onNavigate={args.onNavigate} />,
  play: async (context) => {
    await expect(context.canvas.queryByRole("navigation", { name: storyText(context, copy.heading) })).toBeNull();
    const select = context.canvas.getByRole("combobox", { name: storyText(context, copy.heading) });
    await expect(select).toHaveDisplayValue(storyText(context, copy.numbering));
    await userEvent.selectOptions(select, "#/trades-locations");
    await expect(context.args.onNavigate).toHaveBeenCalledWith("#/trades-locations");
  },
};
