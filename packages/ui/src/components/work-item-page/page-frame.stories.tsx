import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { Button } from "../button/button.tsx";
import { WorkItemPageFrame, WorkItemTopBarButton } from "./page-frame.tsx";

// The Work Item page's frame (RP-1151, gap table rows 1–2, 28, 66–68): top bar, main column, rail and
// the bottom bar, laid out by the page's own width, as the owner's design does at 1366, 820 and 402.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  back: b("Submittals", "التقديمات"),
  watch: b("Watch", "متابعة"),
  workflow: b("View workflow", "عرض سير العمل"),
  rail: b("Transitions and History", "الانتقالات والسجل"),
  bar: b("Transitions", "الانتقالات"),
  approve: b("Approve – Code A", "اعتماد – الرمز A"),
  subject: b("LED light fixtures — Tower 2 typical floors", "وحدات إنارة LED — الطوابق النموذجية للبرج 2"),
};

function Frame({ context, width }: { context: StoryContext; width: number }) {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  return (
    <div style={{ width, height: 640 }} className="flex flex-col overflow-hidden border border-border">
      <WorkItemPageFrame
        locale={storyLocale(context)}
        back={{ href: "#list", label: t(copy.back) }}
        crumb={<bdi dir="ltr">TWR-TMC-EL-MAR-0003</bdi>}
        topBarEnd={
          <>
            <WorkItemTopBarButton icon="eye" label={t(copy.watch)} />
            <WorkItemTopBarButton icon="route" label={t(copy.workflow)} />
          </>
        }
        identity={<h1 className="px-5 pt-5 text-[20px] font-bold">{t(copy.subject)}</h1>}
        railLabel={t(copy.rail)}
        rail={<p>{t(copy.rail)}</p>}
        bar={{ label: t(copy.bar), transitions: <Button>{t(copy.approve)}</Button> }}
      >
        <div className="h-[900px] px-5">…</div>
      </WorkItemPageFrame>
    </div>
  );
}

const meta = { title: "Work Item page/Frame", render: (_args, context) => <Frame context={context} width={1200} /> } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
type Ctx = Parameters<NonNullable<Story["play"]>>[0];

const rail = (context: Ctx) => context.canvas.getByRole("complementary", { name: storyText(context, copy.rail) });
const bar = (context: Ctx) => context.canvas.queryByRole("region", { name: storyText(context, copy.bar) });

/** Desktop: the rail beside the main column; the Transitions are the rail's, so no bottom bar. */
export const Desktop: Story = {
  play: async (context) => {
    await expect(rail(context)).toBeVisible();
    await expect(bar(context)).toBeNull();
    await expect(context.canvas.getByRole("link", { name: storyText(context, copy.back) })).toBeVisible();
    // The body scrolls inside the page; the top bar stays.
    const body = context.canvasElement.querySelector<HTMLElement>(".sdp-body")!;
    await expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
  },
};

/** Tablet (820): no rail; the Transitions sit in the bar at the bottom. */
export const Tablet: Story = {
  render: (_args, context) => <Frame context={context} width={820} />,
  play: async (context) => {
    await expect(context.canvas.queryByRole("complementary", { name: storyText(context, copy.rail) })).toBeNull();
    const transitions = bar(context)!;
    await expect(within(transitions).getByRole("button", { name: storyText(context, copy.approve) })).toBeVisible();
  },
};

/** Phone (402): the top bar's buttons by their icons, still named by their labels. */
export const Phone: Story = {
  render: (_args, context) => <Frame context={context} width={402} />,
  play: async (context) => {
    const watch = context.canvas.getByRole("button", { name: storyText(context, copy.watch) });
    await expect(watch.getBoundingClientRect().width).toBeLessThan(60);
    await expect(bar(context)).not.toBeNull();
  },
};
