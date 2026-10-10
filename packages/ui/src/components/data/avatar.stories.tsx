import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import photo from "../../storybook/fixtures/avatar-photo.svg";
import { storyText } from "../../storybook/locale.ts";
import { Avatar, CompanyChip } from "./avatar.tsx";

const people = {
  faisal: { en: "Faisal Al Harbi", ar: "فيصل الحربي" },
  hala: { en: "Hala Abdullah", ar: "هالة عبدالله" },
  nasser: { en: "Nasser Al Qahtani", ar: "ناصر القحطاني" },
};
const company = { en: "Al Waha PMC", ar: "الواحة لإدارة المشاريع" };

const meta = {
  title: "Data/Avatar",
  component: Avatar,
  args: { name: "" },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Initials on a tint picked from the name, in three sizes. Each avatar is an image named after the person. */
export const Initials: Story = {
  render: (args, context) => (
    <div className="flex items-center gap-3">
      <Avatar {...args} name={storyText(context, people.faisal)} size="sm" />
      <Avatar {...args} name={storyText(context, people.hala)} size="md" />
      <Avatar {...args} name={storyText(context, people.nasser)} size="lg" />
    </div>
  ),
  play: async (context) => {
    const avatar = context.canvas.getByRole("img", { name: storyText(context, people.faisal) });
    await expect(avatar).toHaveTextContent(context.globals.locale === "ar" ? "ف" : "FA");
    await expect(context.canvas.getAllByRole("img")).toHaveLength(3);
  },
};

/**
 * The Members list's avatar (RP-413): given a stable key, the initials sit in white on a solid colour
 * picked from it, so the same Member always has the same one.
 */
export const Solid: Story = {
  render: (args, context) => (
    <div className="flex items-center gap-3">
      <Avatar {...args} name={storyText(context, people.faisal)} solidFrom="member-1" />
      <Avatar {...args} name={storyText(context, people.hala)} solidFrom="member-2" />
      <Avatar {...args} name={storyText(context, people.nasser)} solidFrom="member-3" />
      <Avatar {...args} name={storyText(context, people.faisal)} solidFrom="member-1" size="lg" />
    </div>
  ),
  play: async (context) => {
    const [first, again] = context.canvas.getAllByRole("img", { name: storyText(context, people.faisal) });
    await expect(getComputedStyle(first!).backgroundColor).toBe(getComputedStyle(again!).backgroundColor);
    await expect(getComputedStyle(first!).color).toBe("rgb(255, 255, 255)");
  },
};

/** A photo, named after the person. */
export const Photo: Story = {
  render: (args, context) => <Avatar {...args} name={storyText(context, people.hala)} src={photo} size="lg" />,
  play: async (context) => {
    const avatar = context.canvas.getByRole("img", { name: storyText(context, people.hala) });
    const img = avatar.querySelector("img")!;
    await waitFor(() => expect(img.complete && img.naturalWidth > 0).toBe(true));
  },
};

/** A photo that fails to load falls back to the initials. */
export const BrokenImage: Story = {
  render: (args, context) => <Avatar {...args} name={storyText(context, people.nasser)} src="/missing-avatar.png" size="lg" />,
  play: async (context) => {
    const avatar = context.canvas.getByRole("img", { name: storyText(context, people.nasser) });
    await waitFor(() => expect(avatar.querySelector("img")).toBeNull());
    await expect(avatar).toHaveTextContent(context.globals.locale === "ar" ? "ن" : "NA");
  },
};

/**
 * Next to the name it would repeat, the avatar is decorative: hidden from
 * screen readers, so the name is read once.
 */
export const Decorative: Story = {
  render: (args, context) => (
    <div className="flex items-center gap-2">
      <Avatar {...args} name={storyText(context, people.faisal)} decorative />
      <span className="text-body text-text">{storyText(context, people.faisal)}</span>
    </div>
  ),
  play: async (context) => {
    await expect(context.canvas.queryByRole("img")).toBeNull();
    await expect(context.canvas.getByText(storyText(context, people.faisal))).toBeVisible();
  },
};

/** A company: a rounded square instead of a circle, its logo or initials. */
export const Company: Story = {
  render: (args, context) => (
    <div className="flex items-center gap-3">
      <Avatar {...args} kind="company" name={storyText(context, company)} size="md" />
      <Avatar {...args} kind="company" name={storyText(context, company)} src={photo} size="lg" />
    </div>
  ),
  play: async (context) => {
    for (const avatar of context.canvas.getAllByRole("img", { name: storyText(context, company) })) {
      await expect(parseFloat(getComputedStyle(avatar).borderTopLeftRadius)).toBeLessThan(avatar.offsetWidth / 2);
    }
  },
};

/**
 * The company chip: a company's mark and name in a pill, for where another
 * company appears as one block. It shows the company only, never a person.
 * The mark sits at the start: left in English, right in Arabic.
 */
export const CompanyChipStory: Story = {
  name: "Company chip",
  render: (_args, context) => (
    <div className="flex flex-wrap gap-2">
      <CompanyChip name={storyText(context, company)} />
      <CompanyChip name={storyText(context, company)} logoSrc={photo} />
    </div>
  ),
  play: async (context) => {
    const [chip] = context.canvas.getAllByText(storyText(context, company));
    await expect(context.canvas.queryByRole("img")).toBeNull();
    const pill = chip!.parentElement!;
    const mark = pill.firstElementChild!.getBoundingClientRect();
    const text = chip!.getBoundingClientRect();
    await expect(context.globals.locale === "ar" ? mark.left > text.left : mark.left < text.left).toBe(true);
  },
};
