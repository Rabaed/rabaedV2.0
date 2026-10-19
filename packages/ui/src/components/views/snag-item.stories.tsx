import type { Locale, RaisedFromSource } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { RaisedFromCard, SnagResponse, type SnagItemLabels, type SnagPhoto } from "./snag-item.tsx";

// The Snag item page's cards (RP-628, design/reference/claude-design/ui_kits/app/snag-list.html,
// the item detail): where it was raised from, and the Contractor's response beside the "before"
// photos. Story data only.
const b = (en: string, ar: string) => ({ en, ar });

const labels: Record<Locale, SnagItemLabels> = {
  en: {
    raisedFrom: "Raised from",
    raisedManually: "Raised by hand.",
    open: "Open",
    code: (code) => `Code ${code}`,
    comment: "Consultant's comment",
    response: "Response",
    before: "Before",
    after: "After",
    noPhoto: "No photo",
    photoOf: (subject) => `Photo of ${subject}`,
  },
  ar: {
    raisedFrom: "المصدر",
    raisedManually: "أُنشئت يدويًا.",
    open: "فتح",
    code: (code) => `Code ${code}`,
    comment: "ملاحظة الاستشاري",
    response: "الرد",
    before: "قبل",
    after: "بعد",
    noPhoto: "لا صورة",
    photoOf: (subject) => `صورة ${subject}`,
  },
};

const mar041 = "TWR-TMC-EL-MAR-041";
const seen: RaisedFromSource = {
  documentNumber: mar041,
  subject: "Lighting Fixtures",
  workItemId: "00000000-0000-4000-8000-0000000000b1",
  outcome: { code: "B", name: b("Approved with Comments", "معتمد مع ملاحظات"), look: "b" },
};
const hidden: RaisedFromSource = { documentNumber: "TWR-DCL-AR-IR-045", subject: "Riser 01 earthing", workItemId: null, outcome: null };

// A tiny inline image, so a photo renders without the network.
const pixel = (fill: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="${fill}"/></svg>`)}`;
const before: SnagPhoto[] = [
  { id: "p1", url: pixel("slategray"), name: "before-1.jpg" },
  { id: "p2", url: null, name: "before-2.heic" },
];
const after: SnagPhoto[] = [{ id: "p3", url: pixel("darkseagreen"), name: "after-1.jpg" }];

const meta = {
  title: "Views/SnagItem",
  component: RaisedFromCard,
  args: { source: seen, locale: "en", labels: labels.en, itemHref: (id: string) => `#${id}` },
  render: (args, context) => <RaisedFromCard {...args} locale={storyLocale(context)} labels={labels[storyLocale(context)]} />,
} satisfies Meta<typeof RaisedFromCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A Comment raised from a Code B: the source's number (left to right) and Subject, its Code,
 * the reviewer's comment quoted, and "Open".
 */
export const FromCodeB: Story = {
  args: { quote: b("Provide IP65 certificate for corridor fittings", "قدّم شهادة IP65 لتجهيزات الممرات") },
  play: async (context) => {
    const l = labels[storyLocale(context)];
    const card = context.canvas.getByRole("region", { name: l.raisedFrom });
    await expect(within(card).getByText("Lighting Fixtures")).toBeVisible();
    await expect(card.querySelector('[data-outcome="B"]')).toHaveTextContent("Code B");
    await expect(within(card).getByRole("link", { name: l.open })).toHaveAttribute("href", "#00000000-0000-4000-8000-0000000000b1");
    await expect(within(card).getByText(storyLocale(context) === "ar" ? "قدّم شهادة IP65 لتجهيزات الممرات" : "Provide IP65 certificate for corridor fittings", { exact: false })).toBeVisible();
    const number = within(card).getByText(mar041);
    await expect(getComputedStyle(number).direction).toBe("ltr");
    await expectLaidOutLeftToRight(number);
  },
};

/** A source the viewer doesn't see (Link rules, E1): its number and Subject only, no Code and no "Open". */
export const SourceNotSeen: Story = {
  args: { source: hidden },
  play: async (context) => {
    const l = labels[storyLocale(context)];
    const card = context.canvas.getByRole("region", { name: l.raisedFrom });
    await expect(within(card).getByText("TWR-DCL-AR-IR-045")).toBeVisible();
    await expect(within(card).getByText("Riser 01 earthing")).toBeVisible();
    await expect(within(card).queryByRole("link")).toBeNull();
    await expect(card.querySelector("[data-outcome]")).toBeNull();
  },
};

/** Raised by hand: no source. */
export const RaisedByHand: Story = {
  args: { source: null },
  play: async (context) => {
    const l = labels[storyLocale(context)];
    await expect(within(context.canvas.getByRole("region", { name: l.raisedFrom })).getByText(l.raisedManually)).toBeVisible();
  },
};

/** The Contractor's response: what was done, and the "after" photos beside the "before" ones. */
export const Response: Story = {
  render: (_args, context) => (
    <SnagResponse
      resolution={storyLocale(context) === "ar" ? "تم توصيل حامل الكابلات وتأريضه." : "Tray bonded and earthed; continuity tested."}
      before={before}
      after={after}
      subject="Cable tray not bonded"
      labels={labels[storyLocale(context)]}
    />
  ),
  play: async (context) => {
    const l = labels[storyLocale(context)];
    const card = context.canvas.getByRole("region", { name: l.response });
    const beforeGroup = within(card).getByRole("group", { name: l.before });
    const afterGroup = within(card).getByRole("group", { name: l.after });
    await expect(within(beforeGroup).getAllByRole("img")).toHaveLength(2);
    await expect(within(afterGroup).getAllByRole("img")).toHaveLength(1);
    // Side by side: the "before" photos first in the reading direction.
    const [x, y] = [beforeGroup.getBoundingClientRect(), afterGroup.getBoundingClientRect()];
    await expect(Math.abs(x.top - y.top)).toBeLessThan(2);
    await expect(storyLocale(context) === "ar" ? x.left > y.left : x.left < y.left).toBe(true);
  },
};

/** A response with no "after" photo: what was done, and "No photo" beside the "before" ones. */
export const ResponseWithoutPhotos: Story = {
  render: (_args, context) => (
    <SnagResponse resolution="Cleaned." before={[]} after={[]} subject="Rubbish on floor 3" labels={labels[storyLocale(context)]} />
  ),
  play: async (context) => {
    const l = labels[storyLocale(context)];
    const card = context.canvas.getByRole("region", { name: l.response });
    await expect(within(card).getAllByText(l.noPhoto)).toHaveLength(2);
  },
};
