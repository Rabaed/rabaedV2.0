import type { Locale, WorkItemDetail } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { Button } from "../button/button.tsx";
import { StagePill } from "../status/stage-pill.tsx";
import { panelNumber, panelPosition, panelWith } from "./panel-model.ts";
import {
  SubmittalPanel,
  SubmittalPanelFacts,
  SubmittalPanelIdentity,
  useSubmittalPanelIds,
  type SubmittalPanelFactsLabels,
  type SubmittalPanelLabels,
} from "./submittal-panel.tsx";

const copy = {
  module: { en: "Submittals", ar: "التقديمات" },
  previous: { en: "Previous submittal", ar: "التقديم السابق" },
  next: { en: "Next submittal", ar: "التقديم التالي" },
  close: { en: "Close", ar: "إغلاق" },
  hint: { en: "Esc to close · ↑ ↓ to move through the list", ar: "Esc للإغلاق · ↑ ↓ للتنقل في القائمة" },
  with: { en: "With", ar: "لدى" },
  stepAge: { en: "Step Age", ar: "عمر الخطوة" },
  location: { en: "Location", ar: "الموقع" },
  noNumber: { en: "No number yet", ar: "بلا رقم بعد" },
  pending: { en: "Pending", ar: "قيد المراجعة" },
  sendForReview: { en: "Send for review", ar: "إرسال للمراجعة" },
};

const panelLabels = (locale: Locale): SubmittalPanelLabels => ({
  module: copy.module[locale],
  position: (n, total) => `${n} / ${total}`,
  previous: copy.previous[locale],
  next: copy.next[locale],
  close: copy.close[locale],
  hint: copy.hint[locale],
});
const factLabels = (locale: Locale): SubmittalPanelFactsLabels => ({
  with: copy.with[locale],
  stepAge: copy.stepAge[locale],
  location: copy.location[locale],
  more: (n) => `+${n}`,
  none: "—",
});

const bi = (en: string, ar: string = en) => ({ en, ar });
type Row = { id: string; documentNumber: string | null; revisionNo: number; title: string; heldBy: WorkItemDetail["heldBy"]; stepAgeWeeks: number | null };

/** Another Company's holder, as the item read gives it: its name only (V14). */
const consultant = { companyName: bi("Design Consultants LLC", "ديزاين للاستشارات"), memberName: null, pool: null };
/** The viewer's own Company's holder: named (the positive control). */
const ownPerson = { companyName: bi("TMC Constructions", "تي إم سي للمقاولات"), memberName: bi("Hafiz Hamdan", "حافظ حمدان"), pool: null };

const rows: Row[] = [
  { id: "r1", documentNumber: "TWR-TMC-CV-DAR-281", revisionNo: 0, title: "Drainage System", heldBy: consultant, stepAgeWeeks: 2 },
  { id: "r2", documentNumber: "TWR-TMC-EL-MAR-042 Rev 1", revisionNo: 1, title: "Linear LED fixtures", heldBy: ownPerson, stepAgeWeeks: 1 },
  { id: "r3", documentNumber: "TWR-TMC-ME-MAR-077", revisionNo: 0, title: "Fan coil units", heldBy: consultant, stepAgeWeeks: 5 },
];

function PanelDemo({ context, start, startOpen = true }: { context: StoryContext; start: string; startOpen?: boolean }) {
  const locale = storyLocale(context);
  const [open, setOpen] = useState<string | null>(startOpen ? start : null);
  const ids = useSubmittalPanelIds();
  const row = rows.find((r) => r.id === open);
  const position = row ? panelPosition(rows.map((r) => r.id), row.id) : null;
  return (
    <div className="space-y-2 p-4">
      {rows.map((r) => (
        <Button key={r.id} variant="secondary" data-row={r.id} onClick={() => setOpen(r.id)}>
          {r.title}
        </Button>
      ))}
      {row && position && (
        <SubmittalPanel
          locale={locale}
          labels={panelLabels(locale)}
          crumb={row.documentNumber ?? copy.noNumber[locale]}
          position={position}
          onPrevious={position.previous ? () => setOpen(position.previous) : undefined}
          onNext={position.next ? () => setOpen(position.next) : undefined}
          onClose={() => setOpen(null)}
          labelledBy={ids.labelledBy}
          identity={
            <SubmittalPanelIdentity
              number={panelNumber(row.documentNumber, row.revisionNo)}
              noNumber={copy.noNumber[locale]}
              subject={row.title}
              numberId={ids.numberId}
              subjectId={ids.subjectId}
              chips={<StagePill stage="pending" label={copy.pending[locale]} />}
            />
          }
          facts={
            <SubmittalPanelFacts
              locale={locale}
              labels={factLabels(locale)}
              with={panelWith(row.heldBy, locale)}
              stepAgeWeeks={row.stepAgeWeeks}
              place={locale === "ar" ? ["المنطقة A", "المبنى 1", "الطابق 3"] : ["Zone A", "Building 1", "Floor 3"]}
            />
          }
          actions={<Button>{copy.sendForReview[locale]}</Button>}
        />
      )}
    </div>
  );
}

const meta = {
  title: "Views/Submittal Panel",
  parameters: overlay,
  render: (_args, context) => <PanelDemo context={context} start="r2" />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const panelOf = (context: PlayContext) => within(context.canvasElement).getByRole("dialog");
const factOf = (context: PlayContext, key: string) => panelOf(context).querySelector<HTMLElement>(`[data-fact="${key}"]`)!;

/**
 * Open on the second loaded row: at the inline-end side (the right in English, the left in
 * Arabic) at the Normal width, over the list with no scrim. The breadcrumb counts the loaded rows;
 * "Rev 1" sits inline after the number; every icon button is named and 32px at least; nothing
 * scrolls sideways. Its own Company's holder is named (the positive control of gap A3).
 */
export const Open: Story = {
  play: async (context) => {
    const panel = panelOf(context);
    await expect(panel).toHaveAccessibleName("TWR-TMC-EL-MAR-042 Rev 1 Linear LED fixtures");
    const box = panel.getBoundingClientRect();
    await expect(box.width).toBe(640);
    await expect(box.height).toBe(innerHeight);
    if (storyLocale(context) === "ar") await expect(box.left).toBe(0);
    else await expect(box.right).toBe(innerWidth);
    // No scrim: the list beside it is still clickable.
    await expect(document.elementFromPoint(storyLocale(context) === "ar" ? innerWidth - 40 : 40, 30)?.closest("[data-submittal-panel]")).toBeNull();

    await expect(within(panel).getByText("TWR-TMC-EL-MAR-042 Rev 1")).toBeVisible();
    await expect(within(panel).getByText("2 / 3", { exact: false })).toBeVisible();
    const rev = panel.querySelector(".sdp-rev")!;
    await expect(rev).toHaveTextContent("Rev 1");
    await expect(getComputedStyle(rev.closest("bdi")!).direction).toBe("ltr");

    for (const name of [copy.previous, copy.next, copy.close]) {
      const button = within(panel).getByRole("button", { name: storyText(context, name) });
      const { width, height } = button.getBoundingClientRect();
      await expect(Math.min(width, height)).toBeGreaterThanOrEqual(32);
    }

    await expect(factOf(context, "with")).toHaveTextContent(storyText(context, { en: "Hafiz Hamdan", ar: "حافظ حمدان" }));
    await expect(within(panel).queryByText(/due|overdue|استحقاق/i)).toBeNull();
    await expect(panel.querySelector(".sdp-body")!.scrollWidth).toBeLessThanOrEqual(panel.querySelector(".sdp-body")!.clientWidth);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  },
};

/**
 * Another Company holds it (V14, gap A3): the With fact names that Company only, with no person
 * and no avatar. Rev 0 shows no revision.
 */
export const AnotherCompanyHolds: Story = {
  render: (_args, context) => <PanelDemo context={context} start="r1" />,
  play: async (context) => {
    const holder = factOf(context, "with");
    await expect(holder.querySelector("dd")).toHaveTextContent(new RegExp(`^${storyText(context, { en: "Design Consultants LLC", ar: "ديزاين للاستشارات" })}$`));
    await expect(holder.querySelector(".rounded-full, [role=img]")).toBeNull();
    await expect(panelOf(context).querySelector(".sdp-rev")).toBeNull();
    await expect(within(panelOf(context)).getByRole("button", { name: storyText(context, copy.previous) })).toBeDisabled();
  },
};

/**
 * The keyboard (README §1, gap C6): ↓ and ↑ step through the loaded rows and stop at the edge;
 * a click on another row swaps the content in the same panel (nothing re-animates); Esc closes.
 */
export const Keyboard: Story = {
  play: async (context) => {
    const panel = panelOf(context);
    await expect(panel).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(within(panel).getByText("3 / 3", { exact: false })).toBeVisible();
    await expect(within(panel).getByRole("button", { name: storyText(context, copy.next) })).toBeDisabled();
    await userEvent.keyboard("{ArrowDown}");
    await expect(within(panel).getByText("3 / 3", { exact: false })).toBeVisible();
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    await expect(within(panel).getByText("1 / 3", { exact: false })).toBeVisible();

    await userEvent.click(context.canvasElement.querySelector<HTMLElement>('[data-row="r3"]')!);
    await expect(panelOf(context)).toBe(panel);
    await expect(within(panel).getByText("Fan coil units")).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(within(context.canvasElement).queryByRole("dialog")).toBeNull());
  },
};
