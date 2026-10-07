import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { revisionPickerLabels } from "../../storybook/revision.ts";
import { workItemListLabels } from "../../storybook/views.ts";
import { RevisionPicker, type RevisionPickerProps } from "./revision-picker.tsx";

// The Revision drop-down on the item page (RP-318, spec RP-311): the Revisions
// of the chain the viewer may see, as the API lists them. Story data only.
const copy = {
  noNumber: { en: "Revision 2: no number yet", ar: "المراجعة 2: بلا رقم بعد" },
};

const original = { id: "00000000-0000-4000-8000-000000000000", documentNumber: "TWR-MAR-CCM-0001", revisionNo: 0 };
const rev1 = { id: "00000000-0000-4000-8000-000000000001", documentNumber: "TWR-MAR-CCM-0001 Rev 1", revisionNo: 1 };
const draftRev2 = { id: "00000000-0000-4000-8000-000000000002", documentNumber: null, revisionNo: 2 };

const meta = {
  title: "Work Items/RevisionPicker",
  component: RevisionPicker,
  args: {
    locale: "en",
    labels: revisionPickerLabels.en,
    revisions: [original, rev1],
    currentId: rev1.id,
    revisionNoNumber: workItemListLabels.en.revisionNoNumber,
    onOpen: fn<RevisionPickerProps["onOpen"]>(),
  },
  render: (args, context) => (
    <RevisionPicker {...args} locale={storyLocale(context)} labels={revisionPickerLabels[storyLocale(context)]} revisionNoNumber={workItemListLabels[storyLocale(context)].revisionNoNumber} />
  ),
  decorators: [(Story) => <div className="max-w-sm">{Story()}</div>],
} satisfies Meta<typeof RevisionPicker>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const picker = (context: PlayContext) => context.canvas.getByRole("combobox", { name: revisionPickerLabels[storyLocale(context)].label });

/**
 * The Consultant on Rev 1 (scenario 52): the drop-down shows Rev 1, the one
 * open, and lists the original and Rev 1 in order, the current one marked.
 * Choosing the original opens it.
 */
export const OnRev1: Story = {
  play: async (context) => {
    const { args } = context;
    const trigger = picker(context);
    await expect(trigger).toHaveTextContent(rev1.documentNumber);
    await userEvent.click(trigger);
    const list = await screen.findByRole("listbox");
    const options = within(list).getAllByRole("option");
    await expect(options.map((o) => o.textContent)).toEqual([original.documentNumber, rev1.documentNumber]);
    await expect(options[1]).toHaveAttribute("aria-selected", "true");
    await expect(options[0]).toHaveAttribute("aria-selected", "false");
    await userEvent.click(options[0]!);
    await expect(args.onOpen).toHaveBeenCalledOnce();
    await expect(args.onOpen).toHaveBeenCalledWith(original.id);
  },
};

/** Choosing the one already open does nothing. */
export const ChoosingTheCurrentOne: Story = {
  play: async (context) => {
    await userEvent.click(picker(context));
    await userEvent.click(within(await screen.findByRole("listbox")).getAllByRole("option")[1]!);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await expect(context.args.onOpen).not.toHaveBeenCalled();
  },
};

/**
 * Document Numbers read left to right whole, " Rev 1" included, in Arabic too
 * (CLAUDE.md), in the closed drop-down and in its list.
 */
export const NumbersLeftToRight: Story = {
  play: async (context) => {
    const inTrigger = within(picker(context)).getByText(rev1.documentNumber);
    await expect(getComputedStyle(inTrigger).direction).toBe("ltr");
    await expectLaidOutLeftToRight(inTrigger);
    await userEvent.click(picker(context));
    const list = await screen.findByRole("listbox");
    for (const number of [original.documentNumber, rev1.documentNumber]) {
      const el = within(list).getByText(number);
      await expect(getComputedStyle(el).direction).toBe("ltr");
      await expectLaidOutLeftToRight(el);
    }
    await userEvent.keyboard("{Escape}");
  },
};

/** C1 on its own Draft Rev 2: it has no number yet, and the list says which Revision it is. */
export const DraftRevision: Story = {
  args: { revisions: [original, rev1, draftRev2], currentId: draftRev2.id },
  play: async (context) => {
    await expect(picker(context)).toHaveTextContent(storyText(context, copy.noNumber));
    await userEvent.click(picker(context));
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    await expect(options).toHaveLength(3);
    await expect(options[2]).toHaveTextContent(storyText(context, copy.noNumber));
    await userEvent.keyboard("{Escape}");
  },
};

/** An item without Revisions the viewer may see (K1 on the original while Rev 1 is C1's Draft, scenario 51): no drop-down. */
export const NoOtherRevision: Story = {
  args: { revisions: [original], currentId: original.id },
  play: async (context) => {
    await expect(context.canvas.queryByRole("combobox")).toBeNull();
  },
};

/** At phone width: the drop-down is touch-sized. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    await expectTouchTarget(picker(context));
  },
};
