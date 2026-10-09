import type { Locale } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { storyLocale } from "../../storybook/locale.ts";
import { KanbanCard, type KanbanCardProps } from "./kanban-card.tsx";

// The Kanban card's states (RP-410, the owner's Kanban Card Anatomy): default,
// hover (lifts, shows the Step Age dots), dragging (2px tomato ring), 4+ weeks
// (warm border and red dots, no wording), Code A (green card, solid pill) and
// the Revision badge, in English and Arabic. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const text = {
  title: b("Fire Suppression System", "نظام إطفاء الحريق"),
  drainage: b("Drainage System", "نظام الصرف"),
  concrete: b("Concrete Mix Design", "تصميم خلطة الخرسانة"),
  hvac: b("HVAC Ducting", "مجاري التكييف"),
  electrical: b("Electrical Works", "أعمال كهربائية"),
  civil: b("Civil Works", "أعمال مدنية"),
  mechanical: b("Mechanical Works", "أعمال ميكانيكية"),
  zone: b("Zone A", "المنطقة A"),
  zoneB: b("Zone B", "المنطقة B"),
  building: b("Building 2", "المبنى 2"),
  building1: b("Building 1", "المبنى 1"),
  floor: b("Floor 5", "الطابق 5"),
  floorG: b("Floor G", "الطابق G"),
  nasser: b("Nasser Al Kaabi", "ناصر الكعبي"),
  abdullah: b("Abdullah Al Saadi", "عبدالله السعدي"),
  shamsi: b("Mohammed Al Shamsi", "محمد الشامسي"),
  contractor: b("Al Futtaim Contracting", "شركة الفطيم للمقاولات"),
  consultant: b("Design Consultants", "المستشارون للتصميم"),
  created: b("Created Sep 8", "أُنشئ في 8 سبتمبر"),
  approved: b("Approved", "معتمد"),
  rejected: b("Rejected", "مرفوض"),
  approvedNoted: b("Approved with Comments", "معتمد مع ملاحظات"),
  revise: b("Revise and Resubmit", "يُعدَّل ويُعاد تقديمه"),
  date: b("Sep 8", "8 سبتمبر"),
};

const props = (locale: Locale, rest: Partial<KanbanCardProps> = {}): KanbanCardProps => ({
  number: "12789331",
  noNumberLabel: locale === "en" ? "No number yet" : "بلا رقم بعد",
  title: text.title[locale],
  href: "#item",
  trade: { code: "EL", name: text.electrical[locale] },
  typeCode: "MAR",
  place: [
    { depth: 1, name: text.zone[locale] },
    { depth: 2, name: text.building[locale] },
    { depth: 3, name: text.floor[locale] },
  ],
  owner: { kind: "person", name: text.nasser[locale] },
  date: { text: text.date[locale], label: text.created[locale] },
  stepAgeWeeks: 2,
  locale,
  ...rest,
});

// Each story names what differs from the default card by a key below; the render builds it in the story's language.
type Variant = "default" | "revision" | "codeA" | "codeB" | "codeC" | "codeD" | "aged" | "company" | "pool" | "contractor" | "noNumber";
type StoryArgs = KanbanCardProps & { variant?: Variant };

const meta = {
  title: "Views/KanbanCard",
  args: props("en"),
  render: (args: StoryArgs, context) => (
    <div className="w-[318px] bg-canvas p-3">
      <KanbanCard {...args} {...props(storyLocale(context), argsFor(args, storyLocale(context)))} />
    </div>
  ),
} satisfies Meta<StoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

function argsFor(args: StoryArgs, locale: Locale): Partial<KanbanCardProps> {
  const variant = args.variant ?? "default";
  const civil = { trade: { code: "CV", name: text.civil[locale] }, typeCode: "SAR" };
  const shared = { selected: args.selected, hovered: args.hovered };
  switch (variant) {
    case "revision":
      return { ...shared, badge: { kind: "revision", label: "R2" } };
    case "codeA":
      return {
        ...civil,
        number: "12789320",
        title: text.concrete[locale],
        badge: { kind: "outcome", look: "a", label: "Code A", name: text.approved[locale] },
        owner: undefined,
        stepAgeWeeks: null,
      };
    case "codeB":
      return { number: "12789320", badge: { kind: "outcome", look: "b", label: "Code B", name: text.approvedNoted[locale] }, owner: undefined, stepAgeWeeks: null };
    case "codeC":
      return { number: "12789320", badge: { kind: "outcome", look: "c", label: "Code C", name: text.revise[locale] }, owner: undefined, stepAgeWeeks: null };
    case "codeD":
      return { number: "12789320", badge: { kind: "outcome", look: "d", label: "Code D", name: text.rejected[locale] }, owner: undefined, stepAgeWeeks: null };
    case "aged":
      return {
        number: "12789319",
        title: text.hvac[locale],
        trade: { code: "ME", name: text.mechanical[locale] },
        owner: { kind: "person", name: text.abdullah[locale] },
        stepAgeWeeks: 5,
      };
    case "company":
      return { ...civil, title: text.drainage[locale], owner: { kind: "company", name: text.consultant[locale] }, badge: { kind: "revision", label: "R1" } };
    case "pool":
      return { owner: { kind: "pool", name: locale === "en" ? "Contractor review · unclaimed" : "مراجعة المقاول · لم تُستلَم" } };
    case "contractor":
      return { ...shared, badge: { kind: "revision", label: "R2" }, contractorName: text.contractor[locale] };
    case "noNumber":
      return { number: null, place: [], date: undefined, stepAgeWeeks: null };
    default:
      return shared;
  }
}

const card = (context: { canvasElement: HTMLElement }) => context.canvasElement.querySelector<HTMLElement>("[data-kanban-card]")!;

/** Resting in a column: number, Subject, Trade chip and Type code, plan location, owner and date; the Step Age dots wait for a hover. */
export const Default: Story = {
  play: async (context) => {
    const c = card(context);
    await expect(within(c).getByRole("link", { name: text.title[storyLocale(context)] })).toBeVisible();
    await expect(within(c).getByText("12789331")).toBeVisible();
    // The dots are there for screen readers, hidden until a hover.
    await expect(getComputedStyle(within(c).getByRole("img")).opacity).toBe("0");
  },
};

/** Hover: lifts 1px with a soft shadow, and the Step Age dots appear (drawn here without a pointer). */
export const Hover: Story = {
  args: { hovered: true },
  play: async (context) => {
    await waitFor(() => expect(getComputedStyle(within(card(context)).getByRole("img")).opacity).toBe("1"));
    // The Subject turns tomato.
    await expect(within(card(context)).getByRole("link")).toHaveClass("group-data-hovered/card:text-brand-fg");
  },
};

/** Selected or being dragged: the 2px tomato ring. */
export const Dragging: Story = { args: { selected: true } };

/** 4+ weeks at its step: a warm border and red dots, always shown, with no wording (Rabaed shows age only). */
export const FourWeeksOrMore: Story = {
  args: { variant: "aged" },
  play: async (context) => {
    const c = card(context);
    await expect(c).toHaveAttribute("data-aged");
    await expect(getComputedStyle(within(c).getByRole("img")).opacity).toBe("1");
    await expect(c.querySelectorAll("[data-filled]")).toHaveLength(4);
  },
};

/** The Revision badge, pinned to the left corner in both languages; the number reads from the start. */
export const RevisionBadge: Story = {
  args: { variant: "revision" },
  play: async (context) => {
    const c = card(context);
    const badge = within(c).getByText("R2").getBoundingClientRect();
    const number = within(c).getByText("12789331").getBoundingClientRect();
    await expect(badge.left).toBeLessThan(number.left);
    await expect(badge.left - c.getBoundingClientRect().left).toBeLessThan(20);
  },
};

/** Code A: the only outcome that turns the whole card green, with its solid pill. */
export const CodeA: Story = {
  args: { variant: "codeA" },
  play: async (context) => {
    const c = card(context);
    await expect(c).toHaveAttribute("data-approved");
    // Named in full for screen readers.
    await expect(within(c).getByText(text.approved[storyLocale(context)])).toHaveClass("sr-only");
    // A closed item doesn't age, and nobody holds it.
    await expect(within(c).queryByRole("img")).toBeNull();
  },
};

/** Code B, C and D keep a white card. */
export const CodeB: Story = { args: { variant: "codeB" } };
export const CodeC: Story = { args: { variant: "codeC" } };
export const CodeD: Story = {
  args: { variant: "codeD" },
  play: async (context) => {
    await expect(card(context)).not.toHaveAttribute("data-approved");
  },
};

/** Another Company holds it: the Company's avatar and name only, never its people (V14). */
export const HeldByAnotherCompany: Story = { args: { variant: "company" } };

/** My own Company's Step nobody has claimed yet. */
export const Unclaimed: Story = { args: { variant: "pool" } };

/** With the Contractor name switched on: one muted line with the company icon, between the tags and the plan location. */
export const WithContractorName: Story = {
  args: { variant: "contractor" },
  play: async (context) => {
    const c = card(context);
    const name = within(c).getByText(text.contractor[storyLocale(context)]).getBoundingClientRect();
    const tags = within(c).getByText("MAR").getBoundingClientRect();
    const place = within(c).getByText(text.zone[storyLocale(context)]).getBoundingClientRect();
    await expect(name.top).toBeGreaterThan(tags.top);
    await expect(name.top).toBeLessThan(place.top);
  },
};

/** A Draft with no number yet: says so, and has no date or Step Age (nobody sees when it was started). */
export const NoNumberYet: Story = { args: { variant: "noNumber" } };
