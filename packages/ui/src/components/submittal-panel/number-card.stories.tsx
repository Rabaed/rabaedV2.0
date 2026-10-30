import type { DocumentNumberSegments, Locale } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { Button } from "../button/button.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { StagePill } from "../status/stage-pill.tsx";
import { SubmittalPanelNumberCard, type SubmittalPanelNumberCardLabels } from "./number-card.tsx";
import { submittalNumberPlace, type SubmittalNumberSegment } from "./number-card-model.ts";
import { submittalPanelNumber } from "./panel-model.ts";
import { SubmittalPanel, SubmittalPanelIdentity, useSubmittalPanelIds } from "./submittal-panel.tsx";

// Story data only (RP-1065): the item read decides the segments and what the viewer may know;
// the card draws what it is given.

const copy = {
  title: { en: "How this number is built", ar: "كيف يُبنى هذا الرقم" },
  footnote: {
    en: "Set by the Project's Numbering Pattern. The number never changes; Revisions add Rev 1, Rev 2…",
    ar: "يحدّده نمط الترقيم في المشروع. الرقم لا يتغيّر؛ وتضيف المراجعات «مراجعة 1» و«مراجعة 2»…",
  },
  kinds: {
    project: { en: "Project", ar: "المشروع" },
    type: { en: "Work Item Type", ar: "نوع البند" },
    trade: { en: "Trade", ar: "التخصص" },
    participant: { en: "Participant Code", ar: "رمز المشارك" },
    location: { en: "Location", ar: "الموقع" },
    text: { en: "Fixed text", ar: "نص ثابت" },
    sequence: { en: "Sequence", ar: "التسلسل" },
  },
  close: { en: "Close", ar: "إغلاق" },
  pending: { en: "Pending", ar: "قيد المراجعة" },
};

const tmc = { en: "TMC Constructions", ar: "تي إم سي للمقاولات" };
const place = { en: ["Zone A", "Building 1"], ar: ["المنطقة A", "المبنى 1"] };

const labels = (locale: Locale): SubmittalPanelNumberCardLabels => ({
  title: copy.title[locale],
  footnote: copy.footnote[locale],
  kind: (s: SubmittalNumberSegment) => copy.kinds[s.kind][locale],
  line: (s: SubmittalNumberSegment) =>
    ({
      project: { en: "the Project's code", ar: "رمز المشروع" },
      type: { en: "Material Approval Request", ar: "طلب اعتماد مواد" },
      trade: { en: "Electrical", ar: "الكهرباء" },
      participant: { en: `${tmc.en}' Participant Code`, ar: `رمز المشارك لـ ${tmc.ar}` },
      location: { en: submittalNumberPlace(s.level ?? 1, place.en) ?? "", ar: submittalNumberPlace(s.level ?? 1, place.ar) ?? "" },
      text: { en: "the same on every number", ar: "ثابت في كل رقم" },
      sequence: { en: "the running number, given when it first left Draft", ar: "الرقم التسلسلي، يُعطى عند خروجه من المسودة أول مرة" },
    })[s.kind][locale],
});

const segments: DocumentNumberSegments = {
  separator: "-",
  segments: [
    { kind: "project", value: "TWR" },
    { kind: "participant", value: "TMC" },
    { kind: "trade", value: "EL" },
    { kind: "type", value: "MAR" },
    { kind: "sequence", value: "042" },
  ],
};

type DemoProps = { context: StoryContext; numberSegments?: DocumentNumberSegments; documentNumber: string; revisionNo: number };

function Demo({ context, numberSegments, documentNumber, revisionNo }: DemoProps) {
  const locale = storyLocale(context);
  const ids = useSubmittalPanelIds();
  const [open, setOpen] = useState(true);
  const number = submittalPanelNumber(documentNumber, revisionNo);
  if (!open) return <p className="p-4">—</p>;
  return (
    <SubmittalPanel
      locale={locale}
      labels={{ module: "Submittals", position: (n, total) => `${n} / ${total}`, previous: "Previous", next: "Next", close: copy.close[locale], hint: "Esc" }}
      crumb={number && <DocNo value={number.number} />}
      onClose={() => setOpen(false)}
      labelledBy={ids.labelledBy}
      identity={
        <SubmittalPanelIdentity
          locale={locale}
          number={number}
          noNumber="—"
          subject="Linear LED fixtures"
          numberId={ids.numberId}
          subjectId={ids.subjectId}
          chips={<StagePill stage="pending" label={copy.pending[locale]} />}
          numberInfo={<SubmittalPanelNumberCard segments={numberSegments} labels={labels(locale)} />}
        />
      }
    >
      <div className="p-5">
        <Button variant="secondary">After the number</Button>
      </div>
    </SubmittalPanel>
  );
}

const meta = {
  title: "Views/Submittal Panel/Number card",
  parameters: overlay,
  render: (_args, context) => <Demo context={context} numberSegments={segments} documentNumber="TWR-TMC-EL-MAR-042 Rev 1" revisionNo={1} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const panelOf = (context: PlayContext) => within(context.canvasElement).getByRole("dialog");
const infoOf = (context: PlayContext) => within(panelOf(context)).getByRole("button", { name: storyText(context, copy.title) });
const cardOf = (context: PlayContext) => panelOf(context).querySelector<HTMLElement>("[data-number-card]")!;

/**
 * The ⓘ next to the number (README §4.3, gaps A15 and A16): named "How this number is built",
 * keyboard-reachable, its card hidden until hover. On hover the card shows the number coloured
 * by part, left to right in Arabic too, one line per part (the Participant Code, not "Company"),
 * and the footnote. The headline number stays monochrome; Esc closes the card, not the panel.
 */
export const WithSegments: Story = {
  play: async (context) => {
    const info = infoOf(context);
    const card = cardOf(context);
    await expect(card).not.toBeVisible();
    // The card describes the ⓘ; the panel's own name is still the number and the Subject.
    await expect(info).toHaveAttribute("aria-describedby", card.id);
    await expect(panelOf(context)).toHaveAccessibleName(/^TWR-TMC-EL-MAR-042 .* Linear LED fixtures$/);

    await userEvent.hover(info);
    await waitFor(() => expect(card).toBeVisible());
    await expect(card).toHaveTextContent(storyText(context, copy.title));
    await expect(card).toHaveTextContent(storyText(context, copy.footnote));
    const coloured = within(card).getByTestId("pattern-number");
    await expect(coloured).toHaveTextContent("TWR-TMC-EL-MAR-042");
    await expect(getComputedStyle(coloured).direction).toBe("ltr");
    await expect([...card.querySelectorAll("[data-segment]")].map((l) => l.getAttribute("data-segment"))).toEqual(["project", "participant", "trade", "type", "sequence"]);
    await expect(card.querySelector('[data-segment="participant"]')).toHaveTextContent(
      storyText(context, { en: "Participant CodeTMC: TMC Constructions' Participant Code", ar: "رمز المشاركTMC: رمز المشارك لـ تي إم سي للمقاولات" }),
    );
    // The colours are the card's only: the headline number has no segment colour.
    const headline = panelOf(context).querySelector<HTMLElement>(".sdp-number")!;
    await expect(headline.querySelector("[class*='bg-segment'], [class*='text-segment']")).toBeNull();

    // Esc closes the card first; the panel stays open.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(card).not.toBeVisible());
    await expect(within(context.canvasElement).getByRole("dialog")).toBeVisible();
  },
};

/** The keyboard: Tab reaches the ⓘ and its focus opens the card; Esc closes the card, then the panel. */
export const Keyboard: Story = {
  play: async (context) => {
    const card = cardOf(context);
    await expect(panelOf(context)).toHaveFocus();
    // The top bar's Close first (Previous and Next are off at the edges), then the ⓘ.
    await userEvent.tab();
    await expect(within(panelOf(context)).getByRole("button", { name: storyText(context, copy.close) })).toHaveFocus();
    await userEvent.tab();
    await expect(infoOf(context)).toHaveFocus();
    await waitFor(() => expect(card).toBeVisible());
    const { width, height } = infoOf(context).getBoundingClientRect();
    await expect(Math.min(width, height)).toBeGreaterThanOrEqual(32);
    // The card stays inside the panel, nothing scrolls sideways.
    await expect(card.getBoundingClientRect().width).toBeLessThanOrEqual(360);
    await expect(panelOf(context).querySelector(".sdp-body")!.scrollWidth).toBeLessThanOrEqual(panelOf(context).querySelector(".sdp-body")!.clientWidth);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(card).not.toBeVisible());
    await expect(infoOf(context)).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(within(context.canvasElement).queryByRole("dialog")).toBeNull());
  },
};

/** The card open, as a screenshot shows it (focus opens it). */
export const CardOpen: Story = {
  play: async (context) => {
    infoOf(context).focus();
    await waitFor(() => expect(cardOf(context)).toBeVisible());
  },
};

/** A number with no segments (one brought in, or a Draft): no ⓘ at all. */
export const WithoutSegments: Story = {
  render: (_args, context) => <Demo context={context} documentNumber="OLD-REG-17" revisionNo={0} />,
  play: async (context) => {
    await expect(within(panelOf(context)).queryByRole("button", { name: storyText(context, copy.title) })).toBeNull();
    await expect(panelOf(context).querySelector("[data-number-card]")).toBeNull();
  },
};
