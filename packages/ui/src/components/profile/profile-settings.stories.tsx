import { defaultNotificationSettings, type NotificationSettingsView } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { profileSettingsLabels } from "../../storybook/profile.ts";
import { ProfileSettings, type ProfileSettingsProps } from "./profile-settings.tsx";

// The Member's profile and notification settings (RP-1154; the owner's reference
// "Rabaed Profile & Notification Settings.html", gap table approved 2026-11-06). Story data only.
const copy = {
  title: { en: "Profile & notifications", ar: "الملف الشخصي والإشعارات" },
  saveIdle: { en: "Changes save as you make them", ar: "تُحفظ التغييرات فور إجرائها" },
  saved: { en: "Saved", ar: "تم الحفظ" },
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
  },
  render: (args, context) => <ProfileSettings {...args} locale={storyLocale(context)} labels={profileSettingsLabels[storyLocale(context)]} />,
  decorators: [(Story) => <main className="p-4">{Story()}</main>],
} satisfies Meta<typeof ProfileSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

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

/** A change saves at once, and the save line turns into "Saved". */
export const SavesAtOnce: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    const step = within(canvas.getByRole("group", { name: storyText(context, copy.stepReached) }));
    await userEvent.click(step.getByRole("radio", { name: storyText(context, copy.digest) }));
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ settings: expect.objectContaining({ step_reached: { email: "digest" } }) }),
    );
    await expect(await canvas.findByRole("status")).toHaveTextContent(storyText(context, copy.saved));
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

/** The language of their emails is chosen in the Profile card and saved with the rest. */
export const EmailLanguage: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    await userEvent.click(canvas.getByRole("radio", { name: "العربية" }));
    await expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({ preferredLanguage: "ar" }));
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

/** At phone width the controls sit under each row and are touch-sized. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    const { canvas } = context;
    await expectTouchTarget(canvas.getByRole("switch", { name: storyText(context, copy.pauseAll) }));
    await expectTouchTarget(canvas.getAllByRole("radio", { name: storyText(context, copy.digest) })[0]!);
    await expectTouchTarget(canvas.getByRole("button", { name: new RegExp(storyText(context, copy.watched)) }));
  },
};
