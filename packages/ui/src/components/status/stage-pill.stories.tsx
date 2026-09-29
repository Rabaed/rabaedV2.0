import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { storyText } from "../../storybook/locale.ts";
import { stageKeys } from "../../tokens/themes.ts";
import { StagePill } from "./stage-pill.tsx";

// The Rabaed Default Stages (CONTEXT.md).
const stages = {
  draft: { en: "Drafts", ar: "المسودات" },
  internal: { en: "Internal Review", ar: "مراجعة داخلية" },
  resubmitted: { en: "Revised & Resubmitted", ar: "مُعدَّل ومُعاد تقديمه" },
  pending: { en: "Pending Approval", ar: "بانتظار الاعتماد" },
  approved: { en: "Approved", ar: "معتمد" },
  rejected: { en: "Rejected", ar: "مرفوض" },
  cancelled: { en: "Cancelled", ar: "ملغى" },
};

const meta = {
  title: "Status/StagePill",
  component: StagePill,
  args: { stage: "draft", label: "" },
} satisfies Meta<typeof StagePill>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One colour per default Stage, shared by every Module. The Stage's name says what the colour means. */
export const Stages: Story = {
  render: (args, context) => (
    <div className="flex flex-wrap gap-2">
      {stageKeys.map((stage) => (
        <StagePill key={stage} {...args} stage={stage} label={storyText(context, stages[stage])} />
      ))}
    </div>
  ),
  play: async (context) => {
    for (const stage of stageKeys) {
      const pill = context.canvas.getByText(storyText(context, stages[stage])).closest("[data-stage]");
      await expect(pill).toHaveAttribute("data-stage", stage);
    }
  },
};

/** With a count, as on a Kanban column or a list's Stage filter. The count follows the name in both directions. */
export const WithCount: Story = {
  render: (args, context) => (
    <div className="flex flex-wrap gap-2">
      <StagePill {...args} stage="internal" label={storyText(context, stages.internal)} count={12} />
      <StagePill {...args} stage="pending" label={storyText(context, stages.pending)} count={3} />
    </div>
  ),
  play: async (context) => {
    const pill = context.canvas.getByText(storyText(context, stages.internal)).closest("[data-stage]")!;
    await expect(pill).toHaveTextContent(new RegExp(`^${storyText(context, stages.internal)}\\s*12$`));
  },
};
