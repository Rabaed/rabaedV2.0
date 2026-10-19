import type { PackageComment } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { packageCommentsLabels } from "../../storybook/package-comments.ts";
import { PackageComments } from "./package-comments.tsx";

// The Package page's Comments (RP-662; spec RP-616 story 35; design/prompts/packages.md "Comments
// (for information)"): the Comments raised from its submittals' Code B, only those the viewer sees,
// as `GET /v1/packages/:id/comments` gives them. Not part of the Package. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const consultant = b("Design Consultants", "المستشارون للتصميم");
const cmt = { code: "CMT", name: b("Comment", "ملاحظة") };
const open = { key: "open", name: b("Open", "مفتوحة"), category: "in_progress" as const };
const closed = { key: "closed", name: b("Closed", "مغلقة"), category: "closed_positive" as const };

const comment = (n: number, title: string, rest: Partial<PackageComment> = {}): PackageComment => ({
  id: `00000000-0000-4000-8000-0000000000c${n}`,
  type: cmt,
  documentNumber: `TWR-CMT-DC-00${n}`,
  title,
  stage: open,
  with: { kind: "company", companyName: consultant },
  outcome: null,
  raisedFrom: { id: "00000000-0000-4000-8000-000000000014", documentNumber: "TWR-MAR-AFC-0014" },
  ...rest,
});
const comments = [
  comment(1, "Fix the mirror lights' IP rating on the datasheet"),
  comment(2, "Show the earthing of the mirror lights", { stage: closed, with: null }),
  comment(3, "Confirm the extract fans' noise level", {
    raisedFrom: { id: "00000000-0000-4000-8000-000000000015", documentNumber: "TWR-MAR-AFC-0015" },
  }),
];

const labelsOf = (context: { globals: Record<string, unknown> }) => packageCommentsLabels[storyLocale(context)];

const meta = {
  title: "Packages/PackageComments",
  component: PackageComments,
  args: { comments, locale: "en", labels: packageCommentsLabels.en, itemHref: (id: string) => `#${id}` },
  render: (args, context) => <PackageComments {...args} locale={storyLocale(context)} labels={labelsOf(context)} />,
  decorators: [(Story) => <div className="max-w-[1100px] bg-canvas p-6">{Story()}</div>],
} satisfies Meta<typeof PackageComments>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Each Comment by its Document Number (left to right), Subject and Stage, with the submittal it
 * was raised from; flagged "for information", with the note that Comments are not part of the Package.
 */
export const ForInformation: Story = {
  play: async (context) => {
    const labels = labelsOf(context);
    const section = context.canvas.getByRole("region", { name: new RegExp(`^${labels.title}`) });
    await expect(within(section).getByText(labels.forInformation)).toBeVisible();
    await expect(within(section).getByText(labels.notPartOf)).toBeVisible();
    const items = within(section).getAllByRole("listitem");
    await expect(items).toHaveLength(3);
    const first = within(items[0]!);
    await expect(first.getByRole("link", { name: /TWR-CMT-DC-001/ })).toHaveAttribute("href", `#${comments[0]!.id}`);
    await expect(first.getByText(open.name[storyLocale(context)])).toBeVisible();
    await expect(first.getByRole("link", { name: /TWR-MAR-AFC-0014/ })).toHaveAttribute("href", `#${comments[0]!.raisedFrom.id}`);
    await expectLaidOutLeftToRight(first.getByText("TWR-CMT-DC-001"));
    await expectLaidOutLeftToRight(first.getByText("TWR-MAR-AFC-0014"));
  },
};

/** The section folds away, and opens again. */
export const Folded: Story = {
  play: async (context) => {
    const labels = labelsOf(context);
    const toggle = context.canvas.getByRole("button", { name: new RegExp(`^${labels.title}`) });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(context.canvas.queryByRole("link", { name: /TWR-CMT-DC-001/ })).toBeNull();
    await userEvent.click(toggle);
    await expect(context.canvas.getByRole("link", { name: /TWR-CMT-DC-001/ })).toBeVisible();
  },
};

/** No Comment the viewer sees: the section says so, still for information. */
export const NoComments: Story = {
  args: { comments: [] },
  play: async (context) => {
    const labels = labelsOf(context);
    await expect(context.canvas.getByText(labels.empty)).toBeVisible();
    await expect(context.canvas.queryAllByRole("listitem")).toHaveLength(0);
  },
};

/** A Comment still a Draft of the viewer's own Company has no number yet. */
export const DraftComment: Story = {
  args: { comments: [comment(4, "Add the fixing details", { documentNumber: null, stage: { key: "draft", name: b("Draft", "مسودة"), category: "draft" } })] },
  play: async (context) => {
    const labels = labelsOf(context);
    await expect(context.canvas.getByRole("link", { name: new RegExp(labels.noNumber) })).toBeVisible();
  },
};
