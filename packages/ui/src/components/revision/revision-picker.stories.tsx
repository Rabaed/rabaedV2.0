import { formatDate, type Locale, type RevisionChain } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { revisionBannerLabels, revisionPickerLabels } from "../../storybook/revision.ts";
import { DocNo } from "../doc-no/doc-no.tsx";
import { RevisionBanner, RevisionPicker, type RevisionPickerProps } from "./revision-picker.tsx";

// The one Revision picker (RP-1253; the owner's reference, gap table approved 2026-11-07), as the
// Submittal Panel's number block shows it: the banner above while an earlier Revision is open, then the
// base number with the picker right after it. The chain is what the API lists for the viewer. Story data only.

type Revision = RevisionChain["revisions"][number];
const stage = (key: string, category: Revision["stage"]["category"], en: string, ar: string): Revision["stage"] => ({ key, category, name: { en, ar } });
const closedAtC = stage("revise_resubmit", "closed_negative", "Revise & Resubmit", "مراجعة وإعادة تقديم");
const base = "TWR-TMC-EL-MAR-280";
const original: Revision = {
  id: "00000000-0000-4000-8000-000000000000",
  documentNumber: base,
  revisionNo: 0,
  stage: closedAtC,
  submissionDate: "2026-07-01T06:00:00.000Z",
  closedAt: "2026-07-25T06:00:00.000Z",
  outcome: "C",
};
const rev1: Revision = {
  id: "00000000-0000-4000-8000-000000000001",
  documentNumber: `${base} Rev 1`,
  revisionNo: 1,
  stage: closedAtC,
  submissionDate: "2026-07-28T06:00:00.000Z",
  closedAt: "2026-08-10T06:00:00.000Z",
  outcome: "C",
};
const rev2: Revision = {
  id: "00000000-0000-4000-8000-000000000002",
  documentNumber: `${base} Rev 2`,
  revisionNo: 2,
  stage: stage("pending_approval", "in_progress", "Pending Approval", "بانتظار الاعتماد"),
  submissionDate: "2026-08-14T06:00:00.000Z",
  closedAt: null,
  outcome: null,
};
const draftRev2: Revision = { ...rev2, documentNumber: null, stage: stage("draft", "draft", "Draft", "مسودة"), submissionDate: null };

/** An event date as the picker shows it. */
const day = (at: string, locale: Locale) => formatDate(new Date(at), locale);

const copy = {
  code: { en: "Code C", ar: "الرمز C" },
};

const meta = {
  title: "Work Items/RevisionPicker",
  component: RevisionPicker,
  args: {
    locale: "en",
    labels: revisionPickerLabels.en,
    revisions: [original, rev1, rev2],
    openId: rev2.id,
    onOpen: fn<RevisionPickerProps["onOpen"]>(),
    outcome: (code) => <span data-outcome={code}>{`Code ${code}`}</span>,
  },
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <div className="flex flex-col gap-4">
        <RevisionBanner locale={locale} labels={revisionBannerLabels[locale]} revisions={args.revisions} openId={args.openId} onOpen={args.onOpen} />
        <p className="text-[26px] leading-[1.1] font-extrabold">
          <DocNo value={base} className="font-extrabold" />
          <RevisionPicker
            {...args}
            locale={locale}
            labels={revisionPickerLabels[locale]}
            outcome={(code) => <span data-outcome={code}>{copy.code[locale].replace("C", code)}</span>}
          />
        </p>
      </div>
    );
  },
  decorators: [(Story) => <div className="max-w-xl p-4">{Story()}</div>],
} satisfies Meta<typeof RevisionPicker>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const picker = (context: PlayContext) => context.canvas.getByRole("button", { name: /^Rev \d|^Original$|^الأصلي$/ });
const openMenu = async (context: PlayContext) => {
  await userEvent.click(picker(context));
  return screen.findByRole("menu", { name: revisionPickerLabels[storyLocale(context)].title });
};
const rowNames = (menu: HTMLElement) => within(menu).getAllByRole("menuitemradio").map((row) => row.querySelector("b")?.firstChild?.textContent);

/**
 * The latest open (the Project Admin, who sees the whole chain: RP-1253-2): "Rev 2" with a chevron in the
 * brand tint, no banner. Its menu lists the Revisions newest first, the Original last: Rev 2 checked and
 * Current, Submitted on its Submission Date with its Stage; the earlier ones Returned on their close, at Code C.
 */
export const LatestOpen: Story = {
  play: async (context) => {
    const locale = storyLocale(context);
    const labels = revisionPickerLabels[locale];
    await expect(picker(context)).toHaveTextContent("Rev 2");
    await expect(picker(context)).toHaveAttribute("data-revision-picker", "latest");
    await expect(picker(context)).toHaveAttribute("aria-haspopup", "menu");
    await expect(picker(context)).toHaveAttribute("title", labels.tooltip);
    await expect(context.canvas.queryByRole("status")).toBeNull();
    const menu = await openMenu(context);
    await expect(picker(context)).toHaveAttribute("aria-expanded", "true");
    await expect(rowNames(menu)).toEqual(["Rev 2", "Rev 1", labels.revision.original]);
    const rows = within(menu).getAllByRole("menuitemradio");
    await expect(rows.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    await expect(rows[0]).toHaveTextContent(labels.current);
    await expect(rows[1]).not.toHaveTextContent(labels.current);
    await expect(rows[0]).toHaveTextContent(labels.submitted(day(rev2.submissionDate!, locale)));
    await expect(rows[0]).toHaveTextContent(rev2.stage.name[locale]);
    await expect(rows[1]).toHaveTextContent(labels.closed(day(rev1.closedAt!, locale)));
    await expect(rows[2]).toHaveTextContent(labels.closed(day(original.closedAt!, locale)));
    await expect(within(rows[1]!).getByText((_, el) => el?.getAttribute("data-outcome") === "C")).toBeTruthy();
    // The open row has the focus; the arrows move between rows; Esc closes the menu.
    await waitFor(() => expect(rows[0]).toHaveFocus());
    await userEvent.keyboard("{ArrowDown}");
    await expect(rows[1]).toHaveFocus();
    await userEvent.keyboard("{End}");
    await expect(rows[2]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(rows[0]).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  },
};

/** Choosing the Original opens it; choosing the one already open does nothing. */
export const ChoosingARevision: Story = {
  play: async (context) => {
    const { args } = context;
    let menu = await openMenu(context);
    await userEvent.click(within(menu).getAllByRole("menuitemradio")[0]!);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await expect(args.onOpen).not.toHaveBeenCalled();
    menu = await openMenu(context);
    await userEvent.click(within(menu).getAllByRole("menuitemradio")[2]!);
    await expect(args.onOpen).toHaveBeenCalledOnce();
    await expect(args.onOpen).toHaveBeenCalledWith(original.id);
  },
};

/** A click outside closes the menu. */
export const ClickOutside: Story = {
  play: async (context) => {
    await openMenu(context);
    await userEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  },
};

/**
 * The Original open, read only: the button turns amber and says "Original"; the banner above says so,
 * names Rev 2 as what replaced it, and "Go to Rev 2" opens it. The Current row in the menu does too.
 */
export const EarlierOpen: Story = {
  args: { openId: original.id },
  play: async (context) => {
    const locale = storyLocale(context);
    const labels = revisionBannerLabels[locale];
    await expect(picker(context)).toHaveTextContent(labels.revision.original);
    await expect(picker(context)).toHaveAttribute("data-revision-picker", "past");
    const banner = context.canvas.getByRole("status");
    await expect(banner).toHaveTextContent(labels.viewing(labels.revision.original, "C"));
    await expect(banner).toHaveTextContent(labels.replaced("Rev 2"));
    await userEvent.click(within(banner).getByRole("button", { name: labels.goTo("Rev 2") }));
    await expect(context.args.onOpen).toHaveBeenCalledOnce();
    await expect(context.args.onOpen).toHaveBeenCalledWith(rev2.id);
    const menu = await openMenu(context);
    const rows = within(menu).getAllByRole("menuitemradio");
    await expect(rows.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
    await userEvent.click(rows[0]!);
    await expect(context.args.onOpen).toHaveBeenLastCalledWith(rev2.id);
  },
};

/**
 * RP-1253-1: the Owner Representative of Building A sees the original and Rev 1 but not Rev 2 (moved to
 * Building B), so the chain read lists those two. Rev 1 is their latest: Current, no banner, no
 * "Replaced by", no "Go to", and no Rev 2 row anywhere.
 */
export const LaterRevisionHidden: Story = {
  args: { revisions: [original, rev1], openId: rev1.id },
  play: async (context) => {
    const labels = revisionPickerLabels[storyLocale(context)];
    await expect(picker(context)).toHaveTextContent("Rev 1");
    await expect(picker(context)).toHaveAttribute("data-revision-picker", "latest");
    await expect(context.canvas.queryByRole("status")).toBeNull();
    const menu = await openMenu(context);
    await expect(rowNames(menu)).toEqual(["Rev 1", labels.revision.original]);
    await expect(within(menu).getAllByRole("menuitemradio")[0]).toHaveTextContent(labels.current);
    await expect(document.body).not.toHaveTextContent("Rev 2");
    await userEvent.keyboard("{Escape}");
  },
};

/** The Original open to the same reader: the banner names Rev 1, their latest, never Rev 2. */
export const LaterRevisionHiddenOnTheOriginal: Story = {
  args: { revisions: [original, rev1], openId: original.id },
  play: async (context) => {
    const labels = revisionBannerLabels[storyLocale(context)];
    await expect(context.canvas.getByRole("status")).toHaveTextContent(labels.replaced("Rev 1"));
    await expect(document.body).not.toHaveTextContent("Rev 2");
  },
};

/**
 * C1 on its own Draft Rev 2 (RP-1300, owner's decision 2026-11-13): the button lists the chain, Rev 2 open and
 * Current with no date, each earlier Revision a row to open; no banner, as on the latest.
 */
export const DraftRevision: Story = {
  args: { revisions: [original, rev1, draftRev2], openId: draftRev2.id },
  play: async (context) => {
    await expect(context.canvas.queryByRole("status")).toBeNull();
    await userEvent.click(context.canvas.getByRole("button", { name: /Rev 2/ }));
    const rows = await within(document.body).findAllByRole("menuitemradio");
    await expect(rows).toHaveLength(3);
    await expect(rows[0]).toHaveAttribute("aria-checked", "true");
    await userEvent.click(rows[1]!);
    await expect(context.args.onOpen).toHaveBeenCalledWith(rev1.id);
  },
};

/** Only the Original seen (K1 while Rev 1 is C1's Draft, scenario 51): nothing at all. */
export const OnlyTheOriginal: Story = {
  args: { revisions: [original], openId: original.id },
  play: async (context) => {
    await expect(context.canvas.queryByRole("button")).toBeNull();
    await expect(context.canvas.queryByRole("status")).toBeNull();
  },
};

/** "Rev n" stays untranslated with Latin digits in Arabic too, and the number reads left to right. */
export const RevUntranslated: Story = {
  args: { openId: rev1.id },
  play: async (context) => {
    await expect(picker(context)).toHaveTextContent(/^Rev 1$/);
    const number = context.canvas.getByText(base);
    await expect(getComputedStyle(number).direction).toBe("ltr");
    await expectLaidOutLeftToRight(number);
    await expect(context.canvas.getByRole("status")).toHaveTextContent("Rev 2");
  },
};

/** At phone width the button is touch-sized, and so are the menu's rows. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    await expectTouchTarget(picker(context));
    const menu = await openMenu(context);
    for (const row of within(menu).getAllByRole("menuitemradio")) await expectTouchTarget(row);
    await userEvent.keyboard("{Escape}");
  },
};
