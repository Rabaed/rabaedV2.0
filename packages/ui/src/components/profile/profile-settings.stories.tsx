import { defaultNotificationSettings, type NotificationSettingsView } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { expectTouchTarget, phone, tablet } from "../../storybook/form.ts";
import { touchTargetOffenders } from "../../storybook/touch-target.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { profileSettingsLabels } from "../../storybook/profile.ts";
import { ProfileSettings, type ProfileSettingsProps } from "./profile-settings.tsx";

// The Member's profile and notification settings (RP-1154; the owner's reference
// "Rabaed Profile & Notification Settings.html", gap table approved 2026-11-06). Story data only.
const copy = {
  title: { en: "Profile & notifications", ar: "الملف الشخصي والإشعارات" },
  saveIdle: { en: "Changes save as you make them", ar: "تُحفظ التغييرات فور إجرائها" },
  saved: { en: "Saved", ar: "تم الحفظ" },
  allSaved: { en: "All changes saved", ar: "كل التغييرات محفوظة" },
  positions: { en: "Positions on my Projects", ar: "مناصبي في المشاريع" },
  inAppLine: { en: "In-app notifications are always sent. These settings control email only.", ar: "تُرسل الإشعارات داخل التطبيق دائمًا. هذه الإعدادات تخص البريد فقط." },
  notifications: { en: "Notification settings", ar: "إعدادات الإشعارات" },
  pauseAll: { en: "Pause all email", ar: "إيقاف كل رسائل البريد مؤقتًا" },
  pausedHelp: { en: "Email is paused.", ar: "البريد متوقف." },
  watched: { en: "Items I watch", ar: "البنود التي أراقبها" },
  ticked10: { en: "10 of 10 outcomes ticked", ar: "10 من 10 نتائج محددة" },
  ticked9: { en: "9 of 10 outcomes ticked", ar: "9 من 10 نتائج محددة" },
  codeC: { en: "Revise and Resubmit", ar: "يُراجع ويُعاد تقديمه" },
  weekly: { en: "Weekly Step Age report", ar: "تقرير عمر الخطوة الأسبوعي" },
  stepReached: { en: "Step reached me or my pool", ar: "وصلتني خطوة أو وصلت مجموعتي" },
  inApp: { en: "In-app", ar: "داخل التطبيق" },
  mute: { en: "Mute", ar: "كتم" },
  muted: { en: "Muted: no email from this Project", ar: "مكتوم: لا بريد من هذا المشروع" },
  unmuted: { en: "Email uses the settings below", ar: "البريد يتبع الإعدادات أدناه" },
  digest: { en: "Daily digest", ar: "ملخص يومي" },
  off: { en: "Off", ar: "إيقاف" },
  noProjects: { en: "You are not on any Project yet.", ar: "لست في أي مشروع بعد." },
  failed: { en: "That didn't save. Try again.", ar: "لم يُحفظ ذلك. حاول مرة أخرى." },
  signature: { en: "Signature", ar: "التوقيع" },
};

const tower = { en: "Tower Residences", ar: "أبراج السكن" };
const value: NotificationSettingsView = {
  settings: defaultNotificationSettings,
  emailPaused: false,
  preferredLanguage: "en",
  receivesWeeklyReport: true,
  projects: [
    { id: "0199a1b2-0000-7000-8000-000000000001", code: "TWR", name: tower, muted: false, positions: [{ en: "Project Manager", ar: "مدير المشروع" }] },
    {
      id: "0199a1b2-0000-7000-8000-000000000002",
      code: "MRM",
      name: { en: "Marina Mall", ar: "مارينا مول" },
      muted: false,
      positions: [
        { en: "Engineer", ar: "مهندس" },
        { en: "Project Manager", ar: "مدير المشروع" },
      ],
    },
  ],
};
const member = {
  id: "0199a1b2-0000-7000-8000-0000000000aa",
  name: { en: "Ali Sonour", ar: "علي سنور" },
  email: "ali.sonour@tmc-constructions.ae",
  companyName: { en: "TMC Constructions", ar: "تي إم سي للمقاولات" },
};

const ok = async () => ({ ok: true as const });

/** The save line after "Saved" settles (the pinned time): stories that save end here, so their screenshots are stable. */
async function savedSettles(context: Parameters<NonNullable<Story["play"]>>[0]) {
  const status = context.canvas.getByRole("status");
  await waitFor(() => expect(status).toHaveTextContent(`${storyText(context, copy.allSaved)} · 14:02`), { timeout: 4000 });
}

const meta = {
  title: "Profile/ProfileSettings",
  component: ProfileSettings,
  args: {
    locale: "en",
    labels: profileSettingsLabels.en,
    member,
    value,
    signature: <p>Signature card</p>,
    onSave: fn<ProfileSettingsProps["onSave"]>(ok),
    onMute: fn<ProfileSettingsProps["onMute"]>(ok),
    // 14:02 in Riyadh, so "All changes saved · 14:02" reads the same on every run.
    now: () => new Date("2026-11-07T11:02:00Z"),
  },
  render: (args, context) => <ProfileSettings {...args} locale={storyLocale(context)} labels={profileSettingsLabels[storyLocale(context)]} />,
  decorators: [(Story) => <main className="p-4">{Story()}</main>],
} satisfies Meta<typeof ProfileSettings>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

/** The defaults: the Profile card beside the settings. Every setting is about email: no In-app switch anywhere. */
export const Defaults: Story = {
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.getByRole("heading", { level: 1, name: storyText(context, copy.title) })).toBeVisible();
    await expect(canvas.getByText(storyText(context, copy.saveIdle))).toBeVisible();
    await expect(canvas.getByText(member.email)).toHaveAttribute("dir", "ltr");
    const positions = within(canvas.getByRole("list", { name: storyText(context, copy.positions) }));
    await expect(positions.getAllByRole("listitem")).toHaveLength(2);
    await expect(positions.getByText(storyText(context, { en: "Engineer · Project Manager", ar: "مهندس · مدير المشروع" }))).toBeVisible();
    await expect(canvas.getByText(storyText(context, copy.inAppLine))).toBeVisible();
    await expect(canvas.queryAllByRole("switch", { name: storyText(context, copy.inApp) })).toHaveLength(0);
    await expect(canvas.getAllByText(storyText(context, copy.unmuted))).toHaveLength(2);
    await expect(canvas.getByText(storyText(context, copy.signature))).toBeVisible();
  },
};

/** A change saves at once: the save line shows "Saved", then settles to "All changes saved · time". */
export const SavesAtOnce: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    const step = within(canvas.getByRole("group", { name: storyText(context, copy.stepReached) }));
    await userEvent.click(step.getByRole("radio", { name: storyText(context, copy.digest) }));
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ settings: expect.objectContaining({ step_reached: { email: "digest" } }) }),
    );
    await expect(await canvas.findByRole("status")).toHaveTextContent(storyText(context, copy.saved));
    await savedSettles(context);
  },
};

/** Email paused: the row turns amber and explains; the Projects and "What to email" are dimmed and can't be changed. */
export const Paused: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    await userEvent.click(canvas.getByRole("switch", { name: storyText(context, copy.pauseAll) }));
    await expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({ emailPaused: true, settings: defaultNotificationSettings }));
    await expect(canvas.getByText(storyText(context, copy.pausedHelp), { exact: false })).toBeVisible();
    // Inert: out of the accessibility tree, not focusable and not clickable. (Testing Library still finds what is inert.)
    const card = within(canvas.getByRole("region", { name: storyText(context, copy.notifications) }));
    for (const control of [...card.getAllByRole("switch", { name: storyText(context, copy.mute) }), ...card.getAllByRole("radio")]) {
      await expect(control.closest("[inert]")).not.toBeNull();
    }
    await expect(card.getByRole("switch", { name: storyText(context, copy.pauseAll) }).closest("[inert]")).toBeNull();
    // The email language, in the Profile card, stays usable.
    await expect(canvas.getByRole("radio", { name: "العربية" }).closest("[inert]")).toBeNull();
    await savedSettles(context);
  },
};

/** A mute is an email setting: it saves at once and its line says no email comes from that Project. */
export const Mute: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    const mutes = canvas.getAllByRole("switch", { name: storyText(context, copy.mute) });
    await userEvent.click(mutes[0]!);
    await expect(args.onMute).toHaveBeenCalledWith(value.projects[0]!.id, true);
    await expect(mutes[0]).toBeChecked();
    await expect(canvas.getByText(storyText(context, copy.muted))).toBeVisible();
    await savedSettles(context);
  },
};

/** "Items I watch" opens from its title to its outcome ticks; unticking Code C saves the rest and updates the count. */
export const OutcomeTicks: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    const open = canvas.getByRole("button", { name: new RegExp(storyText(context, copy.watched)) });
    await expect(open).toHaveAttribute("aria-expanded", "false");
    await expect(open).toHaveTextContent(storyText(context, copy.ticked10));
    await userEvent.click(open);
    await expect(open).toHaveAttribute("aria-expanded", "true");
    const codeC = canvas.getByRole("checkbox", { name: new RegExp(storyText(context, copy.codeC)) });
    await expect(codeC).toBeChecked();
    await userEvent.click(codeC);
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          watched: { email: "digest", outcomes: ["A", "B", "D", "passed", "passed_with_comments", "failed", "approved", "rejected", "cancelled"] },
        }),
      }),
    );
    await expect(open).toHaveTextContent(storyText(context, copy.ticked9));
    await savedSettles(context);
  },
};

/** The weekly report is an email on its own schedule: one switch, no digest choice. */
export const WeeklyReport: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    const weekly = canvas.getByRole("switch", { name: storyText(context, copy.weekly) });
    await expect(weekly).toBeChecked();
    await userEvent.click(weekly);
    await expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ weekly_report: { email: "off" } }) }));
    await savedSettles(context);
  },
};

/** A Member who doesn't receive the weekly report has no row for it; one on no Project reads so. */
export const NoProjects: Story = {
  args: { value: { ...value, receivesWeeklyReport: false, projects: [] } },
  play: async (context) => {
    const { canvas } = context;
    await expect(canvas.queryByRole("switch", { name: storyText(context, copy.weekly) })).toBeNull();
    await expect(canvas.getAllByText(storyText(context, copy.noProjects)).length).toBeGreaterThan(0);
  },
};

/** On a Project with no Position there yet: the Project is still listed (never "not on any Project"), naming no Position. */
export const NoPositionYet: Story = {
  args: { value: { ...value, projects: [{ ...value.projects[0]!, positions: [] }] } },
  play: async (context) => {
    const { canvas } = context;
    const positions = within(canvas.getByRole("list", { name: storyText(context, copy.positions) }));
    await expect(positions.getByRole("listitem")).toHaveTextContent(storyText(context, tower));
    await expect(canvas.queryByText(storyText(context, copy.noProjects))).toBeNull();
  },
};

/** The language of their emails is chosen in the Profile card and saved with the rest. */
export const EmailLanguage: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    await userEvent.click(canvas.getByRole("radio", { name: "العربية" }));
    await expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({ preferredLanguage: "ar" }));
    await savedSettles(context);
  },
};

/** A refused save is undone, and the reason shows where "Saved" would. */
export const Refused: Story = {
  args: { onSave: fn<ProfileSettingsProps["onSave"]>(async () => ({ ok: false, reason: "unavailable" })) },
  play: async (context) => {
    const { canvas } = context;
    const pause = canvas.getByRole("switch", { name: storyText(context, copy.pauseAll) });
    await userEvent.click(pause);
    await expect(await canvas.findByRole("alert")).toHaveTextContent(storyText(context, copy.failed));
    await expect(pause).not.toBeChecked();
  },
};

/** A "What to email" row's choices and its title: whether the choices sit under the title or beside it. */
function emailRow(context: PlayContext) {
  const row = context.canvas.getByRole("group", { name: storyText(context, copy.stepReached) });
  const title = within(row).getByText(storyText(context, copy.stepReached)).getBoundingClientRect();
  const choices = within(row).getByRole("radiogroup").getBoundingClientRect();
  return { title, choices, row: row.getBoundingClientRect() };
}

/** At phone width the email choices drop under each row (row 62), full width, and are touch-sized. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    const { canvas } = context;
    await expectTouchTarget(canvas.getByRole("switch", { name: storyText(context, copy.pauseAll) }));
    await expectTouchTarget(canvas.getAllByRole("radio", { name: storyText(context, copy.digest) })[0]!);
    await expectTouchTarget(canvas.getByRole("button", { name: new RegExp(storyText(context, copy.watched)) }));
    const { title, choices } = emailRow(context);
    await expect(choices.top).toBeGreaterThanOrEqual(title.bottom);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  },
};

/**
 * A tablet (820, touch): the cards stacked, each email choice beside its row, as the Tablet Flow draws
 * it; every control 44 across on the touch screen (row 62: 13 were under 44).
 */
export const Tablet: Story = {
  parameters: tablet,
  play: async (context) => {
    const { title, choices } = emailRow(context);
    await expect(choices.top).toBeLessThan(title.bottom);
    await expect(touchTargetOffenders(context.canvasElement)).toEqual([]);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  },
};
