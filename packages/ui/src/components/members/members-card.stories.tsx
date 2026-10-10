import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor } from "storybook/test";
import { phone } from "../../storybook/form.ts";
import { storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { EmptyState } from "../feedback/states.tsx";
import { RowActionsMenu } from "../list/row-menu.tsx";
import { ToolbarSearch } from "../list/list-toolbar.tsx";
import { MembersCard, membersSearchStyle, type MemberRow } from "./members-card.tsx";

// The Members page's card (RP-413, kit `RP.users`) with plain story data.

const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  table: b("Members", "الأعضاء"),
  name: b("Name", "الاسم"),
  marks: b("Role", "الدور"),
  projects: b("Projects", "المشاريع"),
  status: b("Status", "الحالة"),
  actions: b("Actions", "الإجراءات"),
  none: b("—", "—"),
  search: b("Search by name or email", "ابحث بالاسم أو البريد الإلكتروني"),
  authorizedPerson: b("Authorized Person", "المفوَّض"),
  projectCreator: b("Project Creator", "منشئ المشاريع"),
  statuses: {
    active: b("Active", "نشط"),
    invited: b("Invited", "مدعو"),
    locked: b("Locked", "مقفل"),
    deactivated: b("Deactivated", "معطَّل"),
  },
  menuFor: (name: string, locale: "en" | "ar") => (locale === "ar" ? `إجراءات ${name}` : `Actions for ${name}`),
  makeCreator: b("Make Project Creator", "تعيينه منشئًا للمشاريع"),
  deactivate: b("Deactivate", "تعطيل"),
  emptyTitle: b("No matching Members", "لا أعضاء مطابقون"),
  empty: b("No Member of your Company matches that search.", "لا يوجد عضو في شركتك يطابق هذا البحث."),
};

const people = [
  { id: "m1", name: b("Saeed Al Qahtani", "سعيد القحطاني"), email: "saeed.alqahtani@tmc.test", marks: ["authorizedPerson", "projectCreator"], projects: "3", status: "active" },
  { id: "m2", name: b("Hafiz Hamdan", "حافظ حمدان"), email: "hafiz.hamdan@tmc.test", marks: ["projectCreator"], projects: "2", status: "active" },
  { id: "m3", name: b("Ali Sonour", "علي سنور"), email: "ali.sonour@tmc.test", marks: [], projects: "1", status: "locked" },
  { id: "m4", name: b("Sara Al Otaibi", "سارة العتيبي"), email: "sara.alotaibi@tmc.test", marks: [], projects: "0", status: "invited" },
  { id: "m5", name: b("Omar Al Harbi", "عمر الحربي"), email: "omar.alharbi@tmc.test", marks: [], projects: "1", status: "deactivated" },
] as const;

function rowsFor(context: StoryContext, { menu, counts }: { menu: boolean; counts: boolean }): MemberRow[] {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  const locale = context.globals.locale === "ar" ? "ar" : "en";
  return people.map((p) => ({
    id: p.id,
    name: t(p.name),
    email: p.email,
    colourKey: p.id,
    initialsFrom: p.name.en,
    marks: p.marks.map((mark) => t(copy[mark])),
    projects: counts || p.id === "m1" ? p.projects : null,
    status: p.status,
    statusLabel: t(copy.statuses[p.status]),
    menu: menu ? (
      <RowActionsMenu
        label={copy.menuFor(t(p.name), locale)}
        items={[
          { key: "creator", icon: "person-add", label: t(copy.makeCreator), onSelect: fn() },
          { key: "deactivate", icon: "logout", label: t(copy.deactivate), tone: "danger", onSelect: fn() },
        ]}
      />
    ) : undefined,
  }));
}

function Card({ context, menu = true, counts = true, none = false }: { context: StoryContext; menu?: boolean; counts?: boolean; none?: boolean }) {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  return (
    <div className="p-4">
      <MembersCard
        rows={rowsFor(context, { menu, counts })}
        hasMenu={menu}
        labels={{
          table: t(copy.table),
          name: t(copy.name),
          marks: t(copy.marks),
          projects: t(copy.projects),
          status: t(copy.status),
          actions: t(copy.actions),
          none: t(copy.none),
        }}
        search={
          <ToolbarSearch
            label={t(copy.search)}
            placeholder={t(copy.search)}
            value={undefined}
            {...membersSearchStyle}
            onSearch={fn()}
          />
        }
        empty={
          none ? (
            <EmptyState icon="search" title={t(copy.emptyTitle)}>
              {t(copy.empty)}
            </EmptyState>
          ) : undefined
        }
      />
    </div>
  );
}

const meta = {
  title: "Members/Members card",
  render: (_args, context) => <Card context={context} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const rowOf = (context: PlayContext, name: { en: string; ar: string }) =>
  context.canvas.getByText(storyText(context, name)).closest("tr")!;

/**
 * The Authorized Person's view: each Member's avatar, name and email (always left to right), their marks
 * ("—" for none), Projects, status chip, and the row's menu at the end.
 */
export const AuthorizedPerson: Story = {
  play: async (context) => {
    const rows = context.canvas.getAllByRole("row");
    await expect(rows).toHaveLength(people.length + 1);
    const saeed = rowOf(context, people[0].name);
    await expect(saeed).toHaveTextContent(storyText(context, copy.authorizedPerson));
    await expect(saeed).toHaveTextContent(storyText(context, copy.projectCreator));
    await expect(rowOf(context, people[2].name)).toHaveTextContent(storyText(context, copy.none));
    for (const status of ["active", "invited", "locked", "deactivated"] as const) {
      await expect(context.canvas.getAllByText(storyText(context, copy.statuses[status]))[0]).toBeVisible();
    }
    await expect(context.canvas.getAllByRole("button", { name: /.+/ }).filter((x) => x.getAttribute("aria-haspopup") === "menu")).toHaveLength(people.length);
    // Every email reads left to right in both languages.
    await expect(context.canvas.getByText(people[1].email).closest("bdi")).toHaveAttribute("dir", "ltr");
  },
};

/** A plain Member: no menu column, no Invite; a colleague's Projects count is not theirs to read ("—"). */
export const PlainMember: Story = {
  render: (_args, context) => <Card context={context} menu={false} counts={false} />,
  play: async (context) => {
    await expect(context.canvas.queryByRole("button", { name: /Actions|إجراءات/ })).toBeNull();
    await expect(context.canvas.getAllByRole("columnheader")).toHaveLength(4);
    await expect(rowOf(context, people[1].name)).toHaveTextContent(storyText(context, copy.none));
  },
};

/** A search with no match: the card keeps its search box and says so. */
export const NoMatches: Story = {
  render: (_args, context) => <Card context={context} none />,
  play: async (context) => {
    await expect(context.canvas.getByRole("search")).toBeVisible();
    await expect(context.canvas.getByText(storyText(context, copy.emptyTitle))).toBeVisible();
    await expect(context.canvas.queryByRole("table")).toBeNull();
  },
};

/** The row's menu open: Make or Remove Project Creator, Deactivate; the menu aligns to the button's end. */
export const MenuOpen: Story = {
  parameters: overlay,
  play: async (context) => {
    const t = (text: { en: string; ar: string }) => storyText(context, text);
    const locale = context.globals.locale === "ar" ? "ar" : "en";
    await userEvent.click(context.canvas.getByRole("button", { name: copy.menuFor(t(people[1].name), locale) }));
    const menu = await screen.findByRole("menu");
    await expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
  },
};

/** Keyboard: Enter opens the menu on its first command, the arrows move, Escape closes and returns to the button. */
export const MenuKeyboard: Story = {
  play: async (context) => {
    const t = (text: { en: string; ar: string }) => storyText(context, text);
    const locale = context.globals.locale === "ar" ? "ar" : "en";
    const button = context.canvas.getByRole("button", { name: copy.menuFor(t(people[1].name), locale) });
    button.focus();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("menu");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: t(copy.makeCreator) })).toHaveFocus());
    await userEvent.keyboard("{ArrowDown}");
    await expect(screen.getByRole("menuitem", { name: t(copy.deactivate) })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(screen.getByRole("menuitem", { name: t(copy.makeCreator) })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await expect(button).toHaveFocus();
  },
};

/** On a phone the table scrolls inside the card, never the page. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    await expect(context.canvas.getByRole("region", { name: storyText(context, copy.table) })).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  },
};
