import { defaultNotificationSettings, type NotificationSettingsView } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { notificationSettingsLabels } from "../../storybook/notifications.ts";
import { NotificationSettingsForm, type NotificationSettingsFormProps } from "./notification-settings.tsx";

// The Member's notification settings (RP-355, spec RP-344; design §7). Story data only.
const copy = {
  pauseAll: { en: "Pause all email", ar: "إيقاف كل الرسائل مؤقتًا" },
  watched: { en: "Items I watch", ar: "البنود التي أراقبها" },
  outcomes: { en: "Outcomes that notify me", ar: "النتائج التي تُشعرني" },
  codeC: { en: "C · Revise and Resubmit", ar: "C · يُراجع ويُعاد تقديمه" },
  weekly: { en: "Weekly Step Age report", ar: "تقرير عمر الخطوة الأسبوعي" },
  inApp: { en: "In-app", ar: "داخل التطبيق" },
  email: { en: "Email", ar: "البريد الإلكتروني" },
  mute: { en: "Mute", ar: "كتم" },
  digest: { en: "Daily digest", ar: "ملخص يومي" },
  off: { en: "Off", ar: "إيقاف" },
  failed: { en: "That didn't save. Try again.", ar: "لم يُحفظ ذلك. حاول مرة أخرى." },
};

const value: NotificationSettingsView = {
  settings: defaultNotificationSettings,
  emailPaused: false,
  preferredLanguage: "ar",
  receivesWeeklyReport: false,
  projects: [
    { id: "0199a1b2-0000-7000-8000-000000000001", code: "TWR", name: { en: "Riyadh Gate Tower", ar: "برج بوابة الرياض" }, muted: false },
    { id: "0199a1b2-0000-7000-8000-000000000002", code: "MKT", name: { en: "Jeddah Market", ar: "سوق جدة" }, muted: true },
  ],
};

const ok = async () => ({ ok: true as const });

const meta = {
  title: "Notifications/NotificationSettingsForm",
  component: NotificationSettingsForm,
  args: { locale: "en", labels: notificationSettingsLabels.en, value, onSave: fn<NotificationSettingsFormProps["onSave"]>(ok), onMute: fn<NotificationSettingsFormProps["onMute"]>(ok) },
  render: (args, context) => <NotificationSettingsForm {...args} locale={storyLocale(context)} labels={notificationSettingsLabels[storyLocale(context)]} />,
  decorators: [(Story) => <main className="max-w-3xl p-4">{Story()}</main>],
} satisfies Meta<typeof NotificationSettingsForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The defaults, for a Member who doesn't receive the weekly report: its row is not shown. Pausing email saves at once. */
export const Defaults: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    await expect(canvas.queryByRole("heading", { name: storyText(context, copy.weekly) })).toBeNull();
    // In-app is always sent: no group has an In-app switch.
    await expect(canvas.queryAllByRole("switch", { name: storyText(context, copy.inApp) })).toHaveLength(0);
    await expect(canvas.getAllByRole("radio", { name: storyText(context, copy.off) })).toHaveLength(4);
    await userEvent.click(canvas.getByRole("switch", { name: storyText(context, copy.pauseAll) }));
    await expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({ emailPaused: true, settings: defaultNotificationSettings }));
  },
};

/** "Items I watch" opens to its outcome ticks; unticking Code C saves the rest. */
export const OutcomeTicks: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    await userEvent.click(canvas.getByText(storyText(context, copy.outcomes)));
    const codeC = canvas.getByRole("checkbox", { name: storyText(context, copy.codeC) });
    await expect(codeC).toBeChecked();
    await userEvent.click(codeC);
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          watched: { email: "digest", outcomes: ["A", "B", "D", "passed", "passed_with_comments", "failed", "approved", "rejected", "cancelled"] },
        }),
      }),
    );
    await expect(codeC).not.toBeChecked();
  },
};

/** A group's email choice and a Project's mute; the weekly report row for a Member who receives it. */
export const EmailAndMutes: Story = {
  args: { value: { ...value, receivesWeeklyReport: true } },
  play: async (context) => {
    const { canvas, args } = context;
    await expect(canvas.getByRole("heading", { name: storyText(context, copy.weekly) })).toBeVisible();
    const watched = within(canvas.getByRole("heading", { name: storyText(context, copy.watched) }).closest("li")!);
    await userEvent.click(watched.getByRole("radio", { name: storyText(context, copy.off) }));
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ settings: expect.objectContaining({ watched: expect.objectContaining({ email: "off" }) }) }),
    );
    const mutes = canvas.getAllByRole("switch", { name: storyText(context, copy.mute) });
    await expect(mutes[1]).toBeChecked();
    await userEvent.click(mutes[0]!);
    await expect(args.onMute).toHaveBeenCalledWith(value.projects[0]!.id, true);
    await expect(mutes[0]).toBeChecked();
  },
};

/** The weekly report is an email on its own schedule: its row has one Email switch, no In-app switch and no digest choice. */
export const WeeklyReport: Story = {
  args: { value: { ...value, receivesWeeklyReport: true } },
  play: async (context) => {
    const { canvas, args } = context;
    const weekly = within(canvas.getByRole("heading", { name: storyText(context, copy.weekly) }).closest("li")!);
    await expect(weekly.queryByRole("switch", { name: storyText(context, copy.inApp) })).toBeNull();
    await expect(weekly.queryByRole("radio")).toBeNull();
    const email = weekly.getByRole("switch", { name: storyText(context, copy.email) });
    await expect(email).toBeChecked();
    await userEvent.click(email);
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ settings: expect.objectContaining({ weekly_report: { email: "off" } }) }),
    );
    await expect(email).not.toBeChecked();
  },
};

/** A refused save is undone and says so. */
export const Refused: Story = {
  args: { onSave: fn<NotificationSettingsFormProps["onSave"]>(async () => ({ ok: false, reason: "unavailable" })) },
  play: async (context) => {
    const { canvas } = context;
    const pause = canvas.getByRole("switch", { name: storyText(context, copy.pauseAll) });
    await userEvent.click(pause);
    await expect(await canvas.findByRole("alert")).toHaveTextContent(storyText(context, copy.failed));
    await expect(pause).not.toBeChecked();
  },
};

/** At phone width: the rows stack and the controls are touch-sized. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    const { canvas } = context;
    await expectTouchTarget(canvas.getByRole("switch", { name: storyText(context, copy.pauseAll) }));
    await expectTouchTarget(canvas.getAllByRole("radio", { name: storyText(context, copy.digest) })[0]!);
  },
};
