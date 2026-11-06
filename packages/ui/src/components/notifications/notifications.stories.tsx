import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { phone } from "../../storybook/form.ts";
import { storyText } from "../../storybook/locale.ts";
import { NotificationCard, NotificationEmpty, NotificationGroup } from "./notification-list.tsx";
import { NotificationMenu } from "./notification-menu.tsx";
import { NotificationRow, type NotificationRowProps } from "./notification-row.tsx";

// The bell's dropdown, its phone sheet and the Notifications page's rows (RP-1153, the owner's
// design "Rabaed Notifications"). Story data only: what a Consultant's Lead Reviewer reads.
const b = (en: string, ar: string) => ({ en, ar });
type Text = ReturnType<typeof b>;
const copy = {
  title: b("Notifications", "الإشعارات"),
  new: b("3 new", "3 جديد"),
  markAll: b("Mark all as read", "تحديد الكل كمقروء"),
  settings: b("Notification settings", "إعدادات الإشعارات"),
  viewAll: b("View all", "عرض الكل"),
  close: b("Close", "إغلاق"),
  bell: b("Notifications · 3 unread", "الإشعارات · 3 غير مقروءة"),
  unread: b("Unread", "غير مقروء"),
  watching: b("Watching", "قيد المراقبة"),
  hint: b("Goes away if a colleague picks it up", "يختفي إذا استلمه زميل"),
  empty: b("No notifications yet", "لا إشعارات بعد"),
  emptyText: b("When an item reaches you, or an item you watch moves, it shows here.", "عندما يصلك عنصر، أو يتحرك عنصر تتابعه، يظهر هنا."),
  tower: b("Tower Residences", "أبراج السكن"),
  marina: b("Marina Mall", "مارينا مول"),
};

type Row = Omit<NotificationRowProps, "what" | "subject" | "project" | "time" | "watching" | "hint" | "unreadLabel"> & {
  what: Text;
  subject: Text;
  project: Text;
  time: Text;
  watching?: boolean;
  hint?: boolean;
};
const rows: Row[] = [
  {
    href: "#1",
    icon: "users",
    tone: "brand",
    what: b("Reached your Step Pool at Review & issue Code", "وصل إلى مجموعة خطوتك في المراجعة وإصدار الرمز"),
    documentNumber: "TWR-TMC-EL-MAR-0005",
    subject: b("Distribution boards — Tower 2", "لوحات التوزيع — البرج 2"),
    project: copy.tower,
    time: b("5 min", "5 د"),
    dateTime: "2026-11-06T08:55:00.000Z",
    unread: true,
    hint: true,
  },
  {
    href: "#2",
    icon: "git-branch",
    tone: "violet",
    what: b("New Revision from TMC Constructions: Rev 1", "مراجعة جديدة من تي إم سي للمقاولات: Rev 1"),
    documentNumber: "TWR-TMC-AR-MAR-0009 Rev 1",
    subject: b("Aluminium cladding panels", "ألواح الكسوة الألمنيوم"),
    project: copy.tower,
    time: b("2 h", "2 س"),
    dateTime: "2026-11-06T07:00:00.000Z",
    unread: true,
    watching: true,
  },
  {
    href: "#3",
    icon: "clipboard-check",
    tone: "success",
    what: b("Inspection Result: Failed", "نتيجة الفحص: راسب"),
    documentNumber: "MRM-TMC-EL-WIR-0019",
    subject: b("Cable tray supports — Level 1", "دعامات حوامل الكابلات — الطابق 1"),
    project: copy.marina,
    time: b("Yesterday 10:10", "أمس 10:10"),
    dateTime: "2026-11-05T07:10:00.000Z",
    unread: false,
    watching: true,
  },
];

function rowsIn(context: { globals: Record<string, unknown> }, layout: NotificationRowProps["layout"]) {
  const t = (text: Text) => storyText(context, text);
  return rows.map((r) => (
    <NotificationRow
      key={r.href}
      {...r}
      layout={layout}
      what={t(r.what)}
      subject={t(r.subject)}
      project={t(r.project)}
      time={t(r.time)}
      watching={r.watching ? t(copy.watching) : undefined}
      hint={r.hint ? t(copy.hint) : undefined}
      unreadLabel={t(copy.unread)}
    />
  ));
}

const meta = {
  title: "Notifications/Notifications",
  component: NotificationRow,
  parameters: { layout: "padded" },
} satisfies Meta<typeof NotificationRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The page's rows, grouped by Project: unread tinted with a dot, the kind's icon, the number left-to-right. */
export const PageGroups: Story = {
  args: {} as NotificationRowProps,
  render: (_args, context) => {
    const t = (text: Text) => storyText(context, text);
    const all = rowsIn(context, "page");
    return (
      <div className="flex max-w-[960px] flex-col gap-4">
        <NotificationGroup code="TWR" name={t(copy.tower)} count={2}>
          {all.slice(0, 2)}
        </NotificationGroup>
        <NotificationGroup code="MRM" name={t(copy.marina)} count={1}>
          {all.slice(2)}
        </NotificationGroup>
      </div>
    );
  },
  play: async (context) => {
    const canvas = within(context.canvasElement);
    const t = (text: Text) => storyText(context, text);
    const first = canvas.getByRole("link", { name: new RegExp(t(rows[0]!.what).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(first).toHaveAttribute("href", "#1");
    // The unread state is said in words too, not by colour alone.
    await expect(within(first).getByText(t(copy.unread))).toBeInTheDocument();
    await expect(canvas.getAllByText(t(copy.unread))).toHaveLength(2);
    await expect(canvas.getByText("TWR-TMC-EL-MAR-0005")).toHaveAttribute("dir", "ltr");
    await expect(canvas.getByText(t(copy.hint))).toBeVisible();
    await expect(canvas.getAllByText(t(copy.watching))).toHaveLength(2);
    await expect(canvas.getByRole("heading", { name: new RegExp(t(copy.tower)) })).toBeVisible();
    await expect(canvas.getByText(t(rows[0]!.time)).closest("time")).toHaveAttribute("dateTime", "2026-11-06T08:55:00.000Z");
  },
};

/** Grouping off: one card with every row. */
export const PageUngrouped: Story = {
  args: {} as NotificationRowProps,
  render: (_args, context) => <NotificationCard>{rowsIn(context, "page")}</NotificationCard>,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole("link")).toHaveLength(3);
  },
};

/** Nothing to show: its own words, never a blank page. */
export const Empty: Story = {
  args: {} as NotificationRowProps,
  render: (_args, context) => (
    <NotificationCard>
      <NotificationEmpty title={storyText(context, copy.empty)} text={storyText(context, copy.emptyText)} />
    </NotificationCard>
  ),
  play: async (context) => {
    await expect(within(context.canvasElement).getByText(storyText(context, copy.empty))).toBeVisible();
  },
};

function Menu({ context, count, onMarkAll }: { context: { globals: Record<string, unknown> }; count: number; onMarkAll: () => void }) {
  const t = (text: Text) => storyText(context, text);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex justify-end">
      <NotificationMenu
        open={open}
        onOpenChange={setOpen}
        label={count ? t(copy.bell) : t(copy.title)}
        count={count}
        title={t(copy.title)}
        newLabel={count ? t(copy.new) : null}
        markAll={{ label: t(copy.markAll), disabled: count === 0, onClick: onMarkAll }}
        settings={{ href: "#settings", label: t(copy.settings) }}
        viewAll={{ href: "#all", label: t(copy.viewAll) }}
        closeLabel={t(copy.close)}
      >
        {count ? rowsIn(context, "menu") : <NotificationEmpty title={t(copy.empty)} text={t(copy.emptyText)} />}
      </NotificationMenu>
    </div>
  );
}

/** The bell opens its dropdown: header with the count of new ones, Mark all as read, settings; the latest rows; View all. */
export const BellMenu: Story = {
  args: { onOpen: fn() } as unknown as NotificationRowProps,
  render: (args, context) => <Menu context={context} count={3} onMarkAll={(args as unknown as { onOpen: () => void }).onOpen} />,
  play: async (context) => {
    const t = (text: Text) => storyText(context, text);
    const bell = within(context.canvasElement).getByRole("button", { name: t(copy.bell) });
    await expect(bell).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(bell);
    const menu = await screen.findByRole("dialog", { name: t(copy.title) });
    await expect(bell).toHaveAttribute("aria-expanded", "true");
    await expect(within(menu).getByText(t(copy.new))).toBeVisible();
    await expect(within(menu).getAllByRole("link", { name: /MAR|WIR/ })).toHaveLength(3);
    await expect(within(menu).getByRole("link", { name: t(copy.settings) })).toHaveAttribute("href", "#settings");
    await expect(within(menu).getByRole("link", { name: t(copy.viewAll) })).toHaveAttribute("href", "#all");
    await userEvent.click(within(menu).getByRole("button", { name: t(copy.markAll) }));
    await expect((context.args as unknown as { onOpen: ReturnType<typeof fn> }).onOpen).toHaveBeenCalledOnce();
    await userEvent.keyboard("{Escape}");
    await expect(screen.queryByRole("dialog", { name: t(copy.title) })).toBeNull();
    await expect(bell).toHaveFocus();
  },
};

/** Nothing yet: no count on the bell, Mark all as read disabled, the empty words in the dropdown. */
export const BellEmpty: Story = {
  args: {} as NotificationRowProps,
  render: (_args, context) => <Menu context={context} count={0} onMarkAll={() => undefined} />,
  play: async (context) => {
    const t = (text: Text) => storyText(context, text);
    await userEvent.click(within(context.canvasElement).getByRole("button", { name: t(copy.title) }));
    const menu = await screen.findByRole("dialog", { name: t(copy.title) });
    await expect(within(menu).getByRole("button", { name: t(copy.markAll) })).toBeDisabled();
    await expect(within(menu).getByText(t(copy.empty))).toBeVisible();
  },
};

/** On a phone the bell opens a full-screen sheet, with Mark all as read and View all at its foot and a close button. */
export const BellSheetPhone: Story = {
  parameters: phone,
  args: {} as NotificationRowProps,
  render: (_args, context) => <Menu context={context} count={3} onMarkAll={() => undefined} />,
  play: async (context) => {
    const t = (text: Text) => storyText(context, text);
    await userEvent.click(within(context.canvasElement).getByRole("button", { name: t(copy.bell) }));
    const sheet = await screen.findByRole("dialog", { name: t(copy.title) });
    await expect(within(sheet).getByRole("button", { name: t(copy.markAll) })).toBeVisible();
    await expect(within(sheet).getByRole("link", { name: t(copy.viewAll) })).toBeVisible();
    await userEvent.click(within(sheet).getByRole("button", { name: t(copy.close) }));
    await expect(screen.queryByRole("dialog", { name: t(copy.title) })).toBeNull();
  },
};
