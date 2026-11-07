import type { Locale, WorkItemDetail } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { revisionPickerLabels } from "../../storybook/revision.ts";
import { overlay } from "../../storybook/overlay.ts";
import { Button } from "../button/button.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Icon } from "../icon/icon.tsx";
import { StagePill } from "../status/stage-pill.tsx";
import { SubmittalPanelCodeMenu, SubmittalPanelWaiting, type SubmittalPanelBarChipLabels } from "./action-bar.tsx";
import { submittalPanelBar } from "./action-bar-model.ts";
import { submittalPanelWith } from "./panel-model.ts";
import { SubmittalPanel, SubmittalPanelFacts, SubmittalPanelIdentity, useSubmittalPanelIds } from "./submittal-panel.tsx";

/*
 * The Submittal Panel's action bar (RP-1237, gap table v3 rows 22–27 and 48–51; the owner's Submittal
 * Panel Anatomy V3, part 9). One design at every size: the Work Item page is the panel at Full. Download
 * PDF is always there; then exactly what the engine offers the viewer (`submittalPanelBar`), the code
 * Transitions in the "Issue Review Code ▾" menu, or the chip saying where it waits. Story data only:
 * each holder says no more than the item read gives (V14).
 */

type Actions = WorkItemDetail["actions"];
type Transition = Actions["transitions"][number];
const bi = (en: string, ar: string) => ({ en, ar });

const copy = {
  module: bi("Submittals", "التقديمات"),
  close: bi("Close", "إغلاق"),
  previous: bi("Previous submittal", "التقديم السابق"),
  next: bi("Next submittal", "التقديم التالي"),
  hint: bi("Esc to close · ↑ ↓ to move through the list", "Esc للإغلاق · ↑ ↓ للتنقل في القائمة"),
  hintClose: bi("Esc to close", "Esc للإغلاق"),
  download: bi("Download PDF", "تنزيل PDF"),
  menu: bi("Issue Review Code", "إصدار رمز المراجعة"),
  returnToPool: bi("Return to pool", "إعادة إلى المجموعة"),
  pickUp: bi("Pick up", "استلام"),
  viewOnly: bi("View only", "للعرض فقط"),
  pending: bi("Pending Approval", "بانتظار الاعتماد"),
};

const transition = (key: string, kind: Transition["kind"], en: string, ar: string): Transition => ({ key, kind, label: bi(en, ar), actionForm: null }) as Transition;
const reviewTransitions = [
  transition("approve", "close", "Approved", "معتمد"),
  transition("approve_noted", "close", "Approved as noted", "معتمد مع ملاحظات"),
  transition("revise", "close", "Revise & resubmit", "يُعدّل ويُعاد تقديمه"),
  transition("reject", "close", "Rejected", "مرفوض"),
  transition("send_back", "send_back", "Return for more information", "إعادة لطلب معلومات"),
];
const codes: Record<string, string> = { approve: "A", approve_noted: "B", revise: "C", reject: "D" };
const looks = { A: "a", B: "b", C: "c", D: "d" } as const;
const lines: Record<string, ReturnType<typeof bi>> = {
  approve: bi("Closes it. TMC Constructions is told.", "يُغلقه. يُبلَّغ تي إم سي للمقاولات."),
  approve_noted: bi("Closes it. Your Comments continue in the Snag List.", "يُغلقه. تستمر ملاحظاتك في قائمة الملاحظات."),
  revise: bi("Back to TMC Constructions for a new Revision.", "يعود إلى تي إم سي للمقاولات لمراجعة جديدة."),
  reject: bi("Closes it. TMC Constructions is told.", "يُغلقه. يُبلَّغ تي إم سي للمقاولات."),
  send_back: bi("Back to TMC Constructions, with no code.", "يعود إلى تي إم سي للمقاولات بلا رمز."),
};

const none = {
  pickUp: false,
  returnToPool: false,
  saveAnswers: false,
  createRevision: false,
  createReplacement: false,
  discardRevision: false,
  transitions: [],
} as unknown as Actions;

const ownCompany = bi("Design Consultants LLC", "ديزاين للاستشارات");
const ahmed = bi("Ahmed bin Said", "أحمد بن سعيد");
const cases: Record<string, { actions: Actions; heldBy: WorkItemDetail["heldBy"] }> = {
  review: { actions: { ...none, returnToPool: true, transitions: reviewTransitions }, heldBy: { companyName: ownCompany, memberName: ahmed, pool: null } },
  pool: {
    actions: { ...none, pickUp: true },
    heldBy: { companyName: ownCompany, memberName: null, pool: { names: [ahmed, bi("Sara Ali", "سارة علي"), bi("Omar Khan", "عمر خان")] } },
  },
  pickedUp: { actions: none, heldBy: { companyName: ownCompany, memberName: ahmed, pool: null } },
  // Another Company holds it: the read gives its name only (V14).
  anotherCompany: { actions: none, heldBy: { companyName: bi("TMC Constructions", "تي إم سي للمقاولات"), memberName: null, pool: null } },
};

const chipLabels = (locale: Locale): SubmittalPanelBarChipLabels => ({
  pool: (count) => (locale === "ar" ? `في مجموعة المراجعة · ${count}` : `In the review pool · ${count}`),
  pickedUp: (name) => (locale === "ar" ? `استلمه ${name}` : `Picked up by ${name}`),
  viewOnly: copy.viewOnly[locale],
  pastRevision: (revision) => `${revision} · ${locale === "ar" ? "للقراءة فقط" : "read only"}`,
  revision: revisionPickerLabels[locale].revision,
});

function BarDemo({ context, state, width, pastRevision = null }: { context: StoryContext; state: keyof typeof cases; width: number; pastRevision?: number | null }) {
  const locale = storyLocale(context);
  const ids = useSubmittalPanelIds();
  const [opened, setOpened] = useState<string | null>(null);
  const { actions, heldBy } = cases[state]!;
  const bar = submittalPanelBar({ actions, codes, heldBy, stepAgeWeeks: 1, pastRevision });
  const item = (tr: Transition) => ({ key: tr.key, code: codes[tr.key], look: codes[tr.key] ? looks[codes[tr.key] as keyof typeof looks] : undefined, title: tr.label[locale], line: lines[tr.key]?.[locale] });
  return (
    <div className="p-4">
      <p role="status">{opened ?? ""}</p>
      <SubmittalPanel
        locale={locale}
        labels={{ module: copy.module[locale], position: (n, total) => `${n} / ${total}`, previous: copy.previous[locale], next: copy.next[locale], close: copy.close[locale], hint: copy.hint[locale], hintClose: copy.hintClose[locale] }}
        crumb={<DocNo value="TWR-TMC-EL-MAR-280" />}
        position={{ index: 0, total: 42 }}
        onClose={() => setOpened("closed")}
        width={width}
        labelledBy={ids.labelledBy}
        identity={
          <SubmittalPanelIdentity
            locale={locale}
            number={{ number: "TWR-TMC-EL-MAR-280", revisionNo: null }}
            noNumber="—"
            subject={locale === "ar" ? "نظام إطفاء الحريق" : "Fire Suppression System"}
            numberId={ids.numberId}
            subjectId={ids.subjectId}
            chips={<StagePill stage="pending" label={copy.pending[locale]} />}
          />
        }
        facts={
          <SubmittalPanelFacts
            locale={locale}
            labels={{ with: locale === "ar" ? "لدى" : "With", stepAge: locale === "ar" ? "عمر الخطوة" : "Step Age", location: locale === "ar" ? "الموقع" : "Location", more: (n) => `+${n}`, none: "—" }}
            with={submittalPanelWith(heldBy, locale)}
            stepAgeWeeks={1}
            place={["BLK-A", "TWR-A", "A06"]}
          />
        }
        actions={
          <>
            <Button variant="secondary" className="gap-2">
              <Icon name="download" size={17} />
              {copy.download[locale]}
            </Button>
            {bar.chip && <SubmittalPanelWaiting chip={bar.chip} labels={chipLabels(locale)} locale={locale} />}
            {bar.returnToPool && (
              <Button variant="secondary" className="gap-2" onClick={() => setOpened("return-to-pool")}>
                <Icon name="arrow-back-up" size={17} />
                {copy.returnToPool[locale]}
              </Button>
            )}
            {bar.pickUp && <Button onClick={() => setOpened("pick-up")}>{copy.pickUp[locale]}</Button>}
            {bar.menu && <SubmittalPanelCodeMenu label={copy.menu[locale]} codes={bar.menu.codes.map(item)} others={bar.menu.others.map(item)} onSelect={setOpened} />}
          </>
        }
      />
    </div>
  );
}

const meta = {
  title: "Views/Submittal Panel/Action bar",
  parameters: overlay,
  render: (_args, context) => <BarDemo context={context} state="review" width={640} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const panelOf = (context: PlayContext) => within(context.canvasElement).getByRole("dialog");
const barOf = (context: PlayContext) => panelOf(context).querySelector<HTMLElement>(".sdp-actions")!;

/**
 * The reviewer holds it, at Normal (rows 22–25, 49): Download PDF, Return to pool, then the menu as
 * the primary, last. It opens upward with Codes A–D, each with its tile and a line, a divider, then
 * the Send Back. Esc closes the menu first and leaves the panel open; a choice opens its Action Form.
 */
export const ReviewCodeMenu: Story = {
  play: async (context) => {
    const bar = within(barOf(context));
    const buttons = barOf(context).querySelectorAll("button");
    await expect(buttons[0]).toHaveTextContent(storyText(context, copy.download));
    await expect(buttons[buttons.length - 1]).toHaveTextContent(storyText(context, copy.menu));
    await expect(bar.getByRole("button", { name: storyText(context, copy.returnToPool) })).toBeVisible();

    await userEvent.click(bar.getByRole("button", { name: storyText(context, copy.menu) }));
    const menu = await within(document.body).findByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    await expect(items).toHaveLength(5);
    await expect(items[0]).toHaveTextContent(storyText(context, bi("Approved", "معتمد")));
    await expect(items[1]).toHaveTextContent(storyText(context, lines.approve_noted!));
    await expect(within(menu).getByRole("separator")).toBeInTheDocument();
    await expect(items[4]).toHaveTextContent(storyText(context, bi("Return for more information", "إعادة لطلب معلومات")));
    // The bar keeps one row at Normal (no hint below Wide), and the menu opens above it.
    await expect(barOf(context).getBoundingClientRect().height).toBeLessThan(80);
    await expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(barOf(context).getBoundingClientRect().top + 1);
    await expect(within(menu).queryByText(/due|overdue|stamp|clock/i)).toBeNull();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(within(document.body).queryByRole("menu")).toBeNull());
    await expect(panelOf(context)).toBeVisible();

    await userEvent.click(bar.getByRole("button", { name: storyText(context, copy.menu) }));
    await userEvent.click(within(await within(document.body).findByRole("menu")).getAllByRole("menuitem")[2]!);
    await expect(within(context.canvasElement).getByRole("status")).toHaveTextContent("revise");
  },
};

/** The page is the panel at Full (row 1): the same bar, with the hint; opened from outside the List, ↑ ↓ move nowhere, so it reads "Esc to close" alone (row 41). */
export const AtFull: Story = {
  render: (_args, context) => <BarDemo context={context} state="review" width={1400} />,
  play: async (context) => {
    await expect(panelOf(context).querySelector(".sdp-hint")).toBeVisible();
    await expect(panelOf(context).querySelector(".sdp-hint")).toHaveTextContent(new RegExp(`^${storyText(context, copy.hintClose)}$`));
    const bar = within(barOf(context));
    await userEvent.click(bar.getByRole("button", { name: storyText(context, copy.menu) }));
    await expect(await within(document.body).findByRole("menu")).toBeVisible();
    await userEvent.keyboard("{Escape}");
  },
};

/** It waits in the viewer's own Step Pool (row 48): the pool's chip and Pick up, the primary; no code menu until picked up. */
export const InTheReviewPool: Story = {
  render: (_args, context) => <BarDemo context={context} state="pool" width={640} />,
  play: async (context) => {
    const bar = barOf(context);
    await expect(bar.querySelector('[data-bar-chip="pool"]')).toHaveTextContent(storyText(context, bi("In the review pool · 3", "في مجموعة المراجعة · 3")));
    const buttons = bar.querySelectorAll("button");
    await expect(buttons[buttons.length - 1]).toHaveTextContent(storyText(context, copy.pickUp));
    await expect(within(bar).queryByRole("button", { name: storyText(context, copy.menu) })).toBeNull();
  },
};

/** Someone of the viewer's own Company picked it up (row 51): named, with its Step Age in weeks, never days; read and download only. */
export const PickedUpByAnother: Story = {
  render: (_args, context) => <BarDemo context={context} state="pickedUp" width={640} />,
  play: async (context) => {
    const bar = barOf(context);
    const chip = bar.querySelector<HTMLElement>('[data-bar-chip="pickedUp"]')!;
    await expect(chip).toHaveTextContent(storyText(context, bi("Picked up by Ahmed bin Said", "استلمه أحمد بن سعيد")));
    // Its Step Age as everywhere: the shared dots and words, in weeks.
    await expect(chip).toHaveTextContent(storyText(context, bi("1 week at this step", "أسبوع واحد في هذه الخطوة")));
    await expect(bar.querySelectorAll("button")).toHaveLength(1);
    await expect(bar).not.toHaveTextContent(/\b\d+ ?d\b|days?/);
  },
};

/** Another Company holds it (row 26, V14): "View only", and no person's name anywhere in the bar. */
export const ViewOnly: Story = {
  render: (_args, context) => <BarDemo context={context} state="anotherCompany" width={640} />,
  play: async (context) => {
    const bar = barOf(context);
    await expect(bar.querySelector('[data-bar-chip="viewOnly"]')).toHaveTextContent(storyText(context, copy.viewOnly));
    await expect(bar).not.toHaveTextContent(storyText(context, ahmed));
    await expect(bar.querySelectorAll("button")).toHaveLength(1);
  },
};

/** An earlier Revision open (RP-1253, gap row 24): "Rev 1 · read only" and Download PDF, nothing else, whatever the engine offers. */
export const EarlierRevisionReadOnly: Story = {
  render: (_args, context) => <BarDemo context={context} state="review" width={640} pastRevision={1} />,
  play: async (context) => {
    const bar = barOf(context);
    await expect(bar.querySelector('[data-bar-chip="pastRevision"]')).toHaveTextContent(storyLocale(context) === "ar" ? "Rev 1 · للقراءة فقط" : "Rev 1 · read only");
    await expect(bar.querySelectorAll("button")).toHaveLength(1);
  },
};
