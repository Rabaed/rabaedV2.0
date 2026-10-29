import type { Locale } from "@rabaed/domain";
import { directionOf } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { Button } from "../button/button.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { StagePill } from "../status/stage-pill.tsx";
import { SubmittalPanelGrip, SubmittalPanelSizeSwitch, useSubmittalPanelSize, type SubmittalPanelSizeLabels } from "./panel-resize.tsx";
import type { SubmittalPanelWidth } from "./panel-size.ts";
import { SubmittalPanel, SubmittalPanelFacts, SubmittalPanelIdentity, useSubmittalPanelIds } from "./submittal-panel.tsx";

/*
 * The Submittal Panel's sizes (RP-1063, README §2 and §3): the size switch, the drag edge and the
 * layout bands, which follow the panel's own width (a container query), live while it is dragged.
 */

const copy = {
  module: { en: "Submittals", ar: "التقديمات" },
  previous: { en: "Previous submittal", ar: "التقديم السابق" },
  next: { en: "Next submittal", ar: "التقديم التالي" },
  close: { en: "Close", ar: "إغلاق" },
  hint: { en: "Esc to close · ↑ ↓ to move through the list", ar: "Esc للإغلاق · ↑ ↓ للتنقل في القائمة" },
  with: { en: "With", ar: "لدى" },
  stepAge: { en: "Step Age", ar: "عمر الخطوة" },
  location: { en: "Location", ar: "الموقع" },
  pending: { en: "Pending", ar: "قيد المراجعة" },
  sendForReview: { en: "Send for review", ar: "إرسال للمراجعة" },
  group: { en: "Size", ar: "الحجم" },
  compact: { en: "Compact", ar: "مضغوط" },
  normal: { en: "Normal", ar: "عادي" },
  wide: { en: "Wide", ar: "عريض" },
  full: { en: "Full", ar: "كامل" },
  grip: { en: "Drag to resize · double-click to switch Normal and Wide", ar: "اسحب لتغيير الحجم · انقر مرتين للتبديل بين عادي وعريض" },
};

const sizeLabels = (locale: Locale): SubmittalPanelSizeLabels => ({
  group: copy.group[locale],
  sizes: { compact: copy.compact[locale], normal: copy.normal[locale], wide: copy.wide[locale], full: copy.full[locale] },
  grip: copy.grip[locale],
});

const bi = (en: string, ar: string) => ({ en, ar });

function SizesDemo({ context, initial = 640 }: { context: StoryContext; initial?: SubmittalPanelWidth }) {
  const locale = storyLocale(context);
  const ids = useSubmittalPanelIds();
  const [kept, setKept] = useState<SubmittalPanelWidth[]>([]);
  const size = useSubmittalPanelSize({ initial, dir: directionOf(locale), onKeep: (w) => setKept((all) => [...all, w]) });
  return (
    <div className="p-4">
      {/* What the viewer's browser would keep, in order. */}
      <output data-kept={kept.join(",")} />
      <SubmittalPanel
        locale={locale}
        labels={{
          module: copy.module[locale],
          position: (n, total) => `${n} / ${total}`,
          previous: copy.previous[locale],
          next: copy.next[locale],
          close: copy.close[locale],
          hint: copy.hint[locale],
        }}
        crumb={<DocNo value="TWR-TMC-EL-MAR-042" rev={1} locale={locale} />}
        position={{ index: 1, total: 3 }}
        onPrevious={() => {}}
        onNext={() => {}}
        onClose={() => {}}
        width={size.width}
        resizing={size.resizing}
        edge={<SubmittalPanelGrip size={size} locale={locale} labels={sizeLabels(locale)} />}
        topBarEnd={<SubmittalPanelSizeSwitch size={size} labels={sizeLabels(locale)} />}
        labelledBy={ids.labelledBy}
        identity={
          <SubmittalPanelIdentity
            locale={locale}
            number={{ number: "TWR-TMC-EL-MAR-042", revisionNo: 1 }}
            noNumber="—"
            subject={locale === "ar" ? "وحدات إضاءة LED خطية" : "Linear LED fixtures"}
            numberId={ids.numberId}
            subjectId={ids.subjectId}
            chips={<StagePill stage="pending" label={copy.pending[locale]} />}
          />
        }
        facts={
          <SubmittalPanelFacts
            locale={locale}
            labels={{ with: copy.with[locale], stepAge: copy.stepAge[locale], location: copy.location[locale], more: (n) => `+${n}`, none: "—" }}
            with={{ kind: "company", name: bi("Design Consultants LLC", "ديزاين للاستشارات")[locale] }}
            stepAgeWeeks={2}
            place={locale === "ar" ? ["المنطقة A", "المبنى 1", "الطابق 3"] : ["Zone A", "Building 1", "Floor 3"]}
          />
        }
        actions={<Button>{copy.sendForReview[locale]}</Button>}
      />
    </div>
  );
}

const meta = {
  title: "Views/Submittal Panel/Sizes",
  parameters: overlay,
  render: (_args, context) => <SizesDemo context={context} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const panelOf = (context: PlayContext) => within(context.canvasElement).getByRole("dialog");
const sizeButton = (context: PlayContext, key: "compact" | "normal" | "wide" | "full") =>
  within(panelOf(context)).getByRole("button", { name: storyText(context, copy[key]) });
const gripOf = (context: PlayContext) => panelOf(context).querySelector<HTMLElement>(".sdp-grip")!;
const keptOf = (context: PlayContext) => context.canvasElement.querySelector<HTMLElement>("[data-kept]")!.dataset.kept;
const shown = (el: Element | null) => el !== null && getComputedStyle(el).display !== "none";

/** The checks every size passes: With is shown, nothing scrolls sideways, every button is 32px at least. */
async function expectSound(context: PlayContext) {
  const panel = panelOf(context);
  await expect(panel.querySelector('[data-fact="with"]')).toBeVisible();
  const body = panel.querySelector(".sdp-body")!;
  await expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  for (const button of within(panel).getAllByRole("button")) {
    if (!shown(button)) continue;
    const { width, height } = button.getBoundingClientRect();
    await expect({ button: button.getAttribute("aria-label") ?? button.textContent, size: Math.min(width, height) >= 32 }).toEqual({
      button: button.getAttribute("aria-label") ?? button.textContent,
      size: true,
    });
  }
  await expect(within(panel).queryByText(/due|overdue|استحقاق/i)).toBeNull();
}

async function choose(context: PlayContext, key: "compact" | "normal" | "wide" | "full", width: number) {
  await userEvent.click(sizeButton(context, key));
  await waitFor(() => expect(panelOf(context).getBoundingClientRect().width).toBe(width));
  for (const other of ["compact", "normal", "wide", "full"] as const) {
    await expect(sizeButton(context, other)).toHaveAttribute("aria-pressed", String(other === key));
  }
}

/**
 * Normal (640px), the default: the size switch is a named group of four buttons, each named and
 * pressed or not, with a glyph only (no text below 880px). The grip is on the inline-start edge,
 * the left in English and the right in Arabic. The breadcrumb's label and the hint are shown.
 */
export const Normal: Story = {
  play: async (context) => {
    const panel = panelOf(context);
    await expect(within(panel).getByRole("group", { name: storyText(context, copy.group) })).toBeVisible();
    await expect(sizeButton(context, "normal")).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getBoundingClientRect().width).toBe(640);
    await expect(shown(panel.querySelector(".sdp-size-text"))).toBe(false);
    await expect(shown(panel.querySelector(".sdp-hint"))).toBe(true);
    await expect(shown(panel.querySelector(".sdp-crumb-label"))).toBe(true);
    await expect(shown(panel.querySelector(".sdp-rail"))).toBe(false);
    const grip = gripOf(context).getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const edge = storyLocale(context) === "ar" ? box.right : box.left;
    await expect(Math.abs(grip.left + grip.width / 2 - edge)).toBeLessThanOrEqual(1);
    await expect(grip.width).toBe(14);
    await expectSound(context);
  },
};

/**
 * Compact (440px): one column; previous / next, the breadcrumb's label and the hint are hidden;
 * the number is 21px. With is still shown. The choice is kept.
 */
export const Compact: Story = {
  play: async (context) => {
    await choose(context, "compact", 440);
    const panel = panelOf(context);
    await expect(shown(panel.querySelector(".sdp-nav"))).toBe(false);
    await expect(shown(panel.querySelector(".sdp-hint"))).toBe(false);
    await expect(shown(panel.querySelector(".sdp-crumb-label"))).toBe(false);
    await expect(getComputedStyle(panel.querySelector(".sdp-number")!).fontSize).toBe("21px");
    await expect(keptOf(context)).toBe("440");
    await expectSound(context);
  },
};

/**
 * Wide (960px): two panes, the main column and a 300px side rail (an empty slot here); the size
 * buttons show their names; the number is 32px.
 */
export const Wide: Story = {
  play: async (context) => {
    await choose(context, "wide", 960);
    const panel = panelOf(context);
    const rail = panel.querySelector<HTMLElement>(".sdp-rail")!;
    await expect(shown(rail)).toBe(true);
    await expect(rail.getBoundingClientRect().width).toBe(300);
    await expect(shown(panel.querySelector(".sdp-size-text"))).toBe(true);
    await expect(getComputedStyle(panel.querySelector(".sdp-number")!).fontSize).toBe("32px");
    await expect(keptOf(context)).toBe("960");
    await expectSound(context);
  },
};

/** Full: to the sidebar's edge (the whole screen in a story, which has no sidebar). */
export const Full: Story = {
  play: async (context) => {
    await choose(context, "full", innerWidth);
    await expect(keptOf(context)).toBe("full");
    await expectSound(context);
  },
};

/** Where the pointer must be for the panel to be `width` wide: mirrored in Arabic. */
const pointerFor = (context: PlayContext, width: number) => (storyLocale(context) === "ar" ? width : innerWidth - width);

/**
 * Dragging the edge: the width follows the pointer (mirrored in Arabic), snaps to a preset within
 * 12px and becomes Full near the most it can be; a tooltip says the width and its preset or band;
 * the bands change live, before the pointer is let go; the width is kept once, when it is.
 */
export const Drag: Story = {
  play: async (context) => {
    const grip = gripOf(context);
    const panel = panelOf(context);
    const tip = () => panel.querySelector(".sdp-grip-tip");
    fireEvent.pointerDown(grip, { clientX: pointerFor(context, 640), button: 0, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: pointerFor(context, 700), pointerId: 1 });
    await waitFor(() => expect(panel.getBoundingClientRect().width).toBe(700));
    await expect(panel).toHaveAttribute("data-resizing");
    await expect(tip()).toHaveTextContent(`700px · ${storyText(context, copy.normal)}`);
    for (const key of ["compact", "normal", "wide", "full"] as const) await expect(sizeButton(context, key)).toHaveAttribute("aria-pressed", "false");

    // Within 12px of Wide: Wide, and the rail shows while still dragging.
    fireEvent.pointerMove(grip, { clientX: pointerFor(context, 951), pointerId: 1 });
    await waitFor(() => expect(panel.getBoundingClientRect().width).toBe(960));
    await expect(tip()).toHaveTextContent(`960px · ${storyText(context, copy.wide)}`);
    await expect(shown(panel.querySelector(".sdp-rail"))).toBe(true);

    // Narrow: the Compact band, live.
    fireEvent.pointerMove(grip, { clientX: pointerFor(context, 500), pointerId: 1 });
    await waitFor(() => expect(panel.getBoundingClientRect().width).toBe(500));
    await expect(tip()).toHaveTextContent(`500px · ${storyText(context, copy.compact)}`);
    await expect(shown(panel.querySelector(".sdp-hint"))).toBe(false);

    // Never below 380px.
    fireEvent.pointerMove(grip, { clientX: pointerFor(context, 200), pointerId: 1 });
    await waitFor(() => expect(panel.getBoundingClientRect().width).toBe(380));

    // Near the most it can be: Full.
    fireEvent.pointerMove(grip, { clientX: pointerFor(context, innerWidth - 10), pointerId: 1 });
    await waitFor(() => expect(panel.getBoundingClientRect().width).toBe(innerWidth));
    await expect(sizeButton(context, "full")).toHaveAttribute("aria-pressed", "true");
    await expect(keptOf(context)).toBe("");

    fireEvent.pointerUp(grip, { clientX: pointerFor(context, innerWidth - 10), pointerId: 1 });
    await waitFor(() => expect(panel).not.toHaveAttribute("data-resizing"));
    await expect(tip()).toBeNull();
    await expect(keptOf(context)).toBe("full");
    await expectSound(context);
  },
};

/** A double-click on the edge switches Normal and Wide; each is kept. */
export const DoubleClick: Story = {
  play: async (context) => {
    const panel = panelOf(context);
    await userEvent.dblClick(gripOf(context));
    await waitFor(() => expect(panel.getBoundingClientRect().width).toBe(960));
    await userEvent.dblClick(gripOf(context));
    await waitFor(() => expect(panel.getBoundingClientRect().width).toBe(640));
    await expect(keptOf(context)).toBe("960,640");
  },
};

/** A kept width that the screen can't fit is drawn as wide as it can be, and is not rewritten. */
export const WiderThanTheScreen: Story = {
  render: (_args, context) => <SizesDemo context={context} initial={1500} />,
  play: async (context) => {
    await expect(panelOf(context).getBoundingClientRect().width).toBe(innerWidth);
    await expect(keptOf(context)).toBe("");
    await expectSound(context);
  },
};
