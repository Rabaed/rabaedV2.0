import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { RevisionMenu, type RevisionMenuLabels } from "./revision-menu.tsx";

// The Work Item page's Revision pill (RP-1151, gap table rows 10–11): always shown beside the
// number, opening the Revisions of the chain the viewer may see. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  title: b("Revisions you can see", "المراجعات المتاحة لك"),
  original: b("Original", "الأصل"),
  revision1: b("Revision 1", "المراجعة 1"),
  draft: b("Draft", "مسودة"),
  open: b("Open", "مفتوح"),
  noNumber: b("No number yet: Revision 1", "لا رقم بعد: المراجعة 1"),
  // The Project's Stage names, as the API gives each Revision's Stage (RP-1188, gap table row 10).
  closedAtC: b("Revise & Resubmit", "مراجعة وإعادة تقديم"),
  drafts: b("Drafts", "المسودات"),
};

const chain = [
  { id: "0190a1b2-0000-7000-8000-000000000001", documentNumber: "TWR-TMC-EL-MAR-0003", revisionNo: 0, stage: { name: copy.closedAtC } },
  { id: "0190a1b2-0000-7000-8000-000000000002", documentNumber: null, revisionNo: 1, stage: { name: copy.drafts } },
];

const labels = (context: StoryContext): RevisionMenuLabels => ({
  title: storyText(context, copy.title),
  open: storyText(context, copy.open),
  name: (revisionNo, hasNumber) =>
    revisionNo === 0 ? storyText(context, hasNumber ? copy.original : copy.draft) : storyText(context, copy.revision1),
  noNumber: () => storyText(context, copy.noNumber),
});

const onOpen = fn();

function Menu({ context, currentId }: { context: StoryContext; currentId: string }) {
  const [current] = useState(currentId);
  return (
    <div className="p-4">
      <RevisionMenu locale={storyLocale(context)} labels={labels(context)} revisions={chain} currentId={current} onOpen={onOpen} />
    </div>
  );
}

const meta = {
  title: "Revision/Revision menu",
  render: (_args, context) => <Menu context={context} currentId={chain[0]!.id} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** On the original: the pill reads "Original"; the menu lists both, the open one ticked, numbers left to right. Left open for the screenshot. */
export const Open: Story = {
  parameters: overlay,
  play: async (context) => {
    onOpen.mockClear();
    const pill = context.canvas.getByRole("button", { name: new RegExp(storyText(context, copy.original)) });
    await expect(pill).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(pill);
    const menu = await screen.findByRole("dialog", { name: storyText(context, copy.title) });
    const current = within(menu).getByRole("button", { current: true });
    await expect(current).toHaveTextContent(storyText(context, copy.open));
    await expect(within(menu).getByText("TWR-TMC-EL-MAR-0003").closest("bdi")).toHaveAttribute("dir", "ltr");
    await expect(within(menu).getByText(storyText(context, copy.noNumber))).toBeVisible();
    // Each Revision's line names it and its Stage (RP-1188, gap table row 10).
    await expect(within(menu).getByText(`${storyText(context, copy.original)} · ${storyText(context, copy.closedAtC)}`)).toBeVisible();
    await expect(within(menu).getByText(`${storyText(context, copy.revision1)} · ${storyText(context, copy.drafts)}`)).toBeVisible();
  },
};

/** Choosing another Revision opens it; the open one does nothing. */
export const Choose: Story = {
  play: async (context) => {
    onOpen.mockClear();
    const pill = context.canvas.getByRole("button", { name: new RegExp(storyText(context, copy.original)) });
    await userEvent.click(pill);
    let menu = await screen.findByRole("dialog", { name: storyText(context, copy.title) });
    await userEvent.click(within(menu).getByRole("button", { current: true }));
    await expect(onOpen).not.toHaveBeenCalled();
    // Choosing closes the menu; open it again for the other one.
    await userEvent.click(pill);
    menu = await screen.findByRole("dialog", { name: storyText(context, copy.title) });
    await userEvent.click(within(menu).getByText(storyText(context, copy.noNumber)));
    await expect(onOpen).toHaveBeenCalledWith(chain[1]!.id);
  },
};

/** One Revision only, a Draft: the pill still shows, as the design draws it. */
export const OnlyTheDraft: Story = {
  render: (_args, context) => (
    <div className="p-4">
      <RevisionMenu locale={storyLocale(context)} labels={labels(context)} revisions={[{ id: chain[0]!.id, documentNumber: null, revisionNo: 0, stage: { name: copy.drafts } }]} currentId={chain[0]!.id} onOpen={onOpen} />
    </div>
  ),
  play: async (context) => {
    await expect(context.canvas.getByRole("button", { name: new RegExp(storyText(context, copy.draft)) })).toBeVisible();
  },
};
