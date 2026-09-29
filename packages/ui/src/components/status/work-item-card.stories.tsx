import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";
import photo from "../../storybook/fixtures/site-photo.svg";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { reviewCodes } from "../../tokens/themes.ts";
import { WorkItemCard, type WorkItemCardProps } from "./work-item-card.tsx";

const text = {
  title: { en: "Cable tray support bracket at level 3 riser", ar: "دعامة حامل الكابلات عند الصاعد في الطابق 3" },
  longTitle: {
    en: "Shop drawing for the main low-voltage switchboard, busbar trunking and cable tray routes in the basement plant room",
    ar: "مخططات تنفيذية للوحة التوزيع الرئيسية للجهد المنخفض ومجاري القضبان ومسارات حوامل الكابلات في غرفة المعدات بالقبو",
  },
  trade: { en: "Electrical", ar: "كهرباء" },
  location: { en: "Tower 1 · Level 3", ar: "البرج 1 · الطابق 3" },
  person: { en: "Faisal Al Harbi", ar: "فيصل الحربي" },
  ownCompany: { en: "Tamkeen Contracting", ar: "تمكين للمقاولات" },
  otherCompany: { en: "Al Waha PMC", ar: "الواحة لإدارة المشاريع" },
};
const number = "TWR-TMC-EL-MAR-041";

type Context = { globals: Record<string, unknown> };

/** An open item held by someone in the viewer's own Company. */
function openItem(context: Context): Omit<WorkItemCardProps, "href" | "onClick"> {
  return {
    number,
    rev: 1,
    title: storyText(context, text.title),
    trade: storyText(context, text.trade),
    location: storyText(context, text.location),
    state: {
      open: true,
      holder: {
        kind: "person",
        name: storyText(context, text.person),
        companyName: storyText(context, text.ownCompany),
        inViewerCompany: true,
      },
      stepAgeWeeks: 2,
    },
    locale: storyLocale(context),
  };
}

/** A closed item: its Issued Code instead of a holder and Step Age. */
function closedItem(context: Context, code: (typeof reviewCodes)[number]): Omit<WorkItemCardProps, "href" | "onClick"> {
  return { ...openItem(context), number: `TWR-TMC-EL-MAR-04${reviewCodes.indexOf(code) + 2}`, state: { open: false, code } };
}

const meta = {
  title: "Status/WorkItemCard",
  component: WorkItemCard,
  args: { number, title: "", locale: "en", href: "#item", density: "comfortable" },
  decorators: [(Story) => <div className="w-72">{Story()}</div>],
} satisfies Meta<typeof WorkItemCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * An open item: Document Number and Revision, Step Age, title, Trade,
 * Location and who it is with. The whole card is one link, named by its
 * number and title only; the rest is its description.
 */
export const Open: Story = {
  render: (args, context) => <WorkItemCard {...args} {...openItem(context)} />,
  play: async (context) => {
    const card = context.canvas.getByRole("link", { name: `${number} Rev 1 ${storyText(context, text.title)}` });
    await expect(context.canvas.getAllByRole("link")).toHaveLength(1);
    await expect(card).toHaveAccessibleDescription(new RegExp(storyText(context, text.person)));
    await userEvent.tab();
    await expect(card).toHaveFocus();
  },
};

/** Held by someone in another Company: the card shows that Company's name only (visibility V14). */
export const WithAnotherCompany: Story = {
  render: (args, context) => (
    <WorkItemCard
      {...args}
      {...openItem(context)}
      state={{
        open: true,
        holder: {
          kind: "person",
          name: storyText(context, text.person),
          photoSrc: "/people/faisal.png",
          companyName: storyText(context, text.otherCompany),
          inViewerCompany: false,
        },
        stepAgeWeeks: 2,
      }}
    />
  ),
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, text.otherCompany))).toBeVisible();
    const html = context.canvasElement.outerHTML.toLowerCase();
    for (const secret of [text.person.en, text.person.ar, "faisal"]) await expect(html).not.toContain(secret.toLowerCase());
  },
};

/** Closed items, one per Issued Code: the Code badge replaces the holder and Step Age. */
export const Closed: Story = {
  render: (args, context) => (
    <div className="flex flex-col gap-3">
      {reviewCodes.map((code) => (
        <WorkItemCard key={code} {...args} {...closedItem(context, code)} />
      ))}
    </div>
  ),
  play: async (context) => {
    const cards = context.canvas.getAllByRole("link");
    await expect(cards).toHaveLength(4);
    for (const [i, code] of reviewCodes.entries()) {
      await expect(cards[i]!.querySelector(`[data-code=${code}]`)).not.toBeNull();
      await expect(cards[i]!.querySelector("[role=img]")).toBeNull();
    }
  },
};

/** With a photo thumbnail, which is decorative: the card's name stays its number and title. */
export const WithPhoto: Story = {
  render: (args, context) => <WorkItemCard {...args} {...openItem(context)} photoSrc={photo} />,
  play: async (context) => {
    const card = context.canvas.getByRole("link", { name: `${number} Rev 1 ${storyText(context, text.title)}` });
    const img = card.querySelector("img")!;
    await expect(img).toHaveAttribute("alt", "");
  },
};

/** Compact, for dense boards: less padding, a one-line title and a smaller photo. */
export const Compact: Story = {
  args: { density: "compact" },
  render: (args, context) => (
    <div className="flex flex-col gap-2">
      <WorkItemCard {...args} {...openItem(context)} photoSrc={photo} />
      <WorkItemCard {...args} {...closedItem(context, "b")} />
    </div>
  ),
  play: async (context) => {
    const [open] = context.canvas.getAllByRole("link");
    await expect(open!.querySelector("img")!.getBoundingClientRect().width).toBe(36);
    const title = open!.querySelector("[data-title]")!;
    await expect(title.getBoundingClientRect().height).toBeLessThan(24);
  },
};

/**
 * A long title is cut at two lines with an ellipsis, at the end of the text:
 * the left in English, the right in Arabic. The Document Number stays left to
 * right in both.
 */
export const LongTitle: Story = {
  render: (args, context) => (
    <WorkItemCard {...args} {...openItem(context)} rev={12} title={storyText(context, text.longTitle)} />
  ),
  play: async (context) => {
    const card = context.canvas.getByRole("link");
    const title = card.querySelector<HTMLElement>("[data-title]")!;
    await expect(title.scrollHeight).toBeGreaterThan(title.clientHeight);
    await expect(getComputedStyle(title).direction).toBe(storyLocale(context) === "ar" ? "rtl" : "ltr");
    const docNo = card.querySelector("bdi")!;
    await expect(getComputedStyle(docNo).direction).toBe("ltr");
    await expect(docNo).toHaveTextContent(`${number} Rev 12`);
    // The number starts at the card's start edge.
    const box = card.getBoundingClientRect();
    const num = docNo.getBoundingClientRect();
    const rtl = storyLocale(context) === "ar";
    await expect(rtl ? box.right - num.right : num.left - box.left).toBeLessThan(24);
  },
};

/** Without `href`, the card is a button: for boards that open the item in a side panel. */
export const AsButton: Story = {
  args: { href: undefined, onClick: fn() },
  render: (args, context) => <WorkItemCard {...args} {...openItem(context)} />,
  play: async (context) => {
    const card = context.canvas.getByRole("button", { name: `${number} Rev 1 ${storyText(context, text.title)}` });
    await userEvent.tab();
    await expect(card).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(context.args.onClick).toHaveBeenCalledOnce();
  },
};
