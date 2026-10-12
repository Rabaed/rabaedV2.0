import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { cn } from "../../lib/cn.ts";
import { phone } from "../../storybook/form.ts";
import { focusRing, touchBox } from "../form/control-styles.ts";
import { storyText } from "../../storybook/locale.ts";
import { KeyValues } from "./key-values.tsx";
import { TitledCard } from "./titled-card.tsx";

// The design kit's card and key-value grid (RP-411), as the Project page's
// "Project details" card draws them. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  title: b("Project details", "تفاصيل المشروع"),
  link: b("Set Participant Codes", "تحديد رموز المشاركين"),
  code: b("Project code", "رمز المشروع"),
  number: b("Project Number", "رقم المشروع"),
  host: b("Host Company", "الشركة المضيفة"),
  hostName: b("TMC Constructions", "تي إم سي للإنشاءات"),
  role: b("Your Company's Project Role", "دور شركتك"),
  roleName: b("Contractor · Project Admin", "المقاول · مسؤول المشروع"),
};

const meta = {
  title: "Data/TitledCard",
  component: TitledCard,
  args: { title: "Project details", children: null },
  render: (_args, context) => (
    <TitledCard
      title={storyText(context, copy.title)}
      actions={
        <a href="#codes" className={cn("inline-flex items-center rounded-sm text-[13px] font-semibold text-brand-fg", focusRing, touchBox)}>
          {storyText(context, copy.link)}
        </a>
      }
    >
      <KeyValues
        items={[
          { key: "code", label: storyText(context, copy.code), value: <bdi dir="ltr">TWR</bdi> },
          { key: "number", label: storyText(context, copy.number), value: "1" },
          { key: "host", label: storyText(context, copy.host), value: storyText(context, copy.hostName) },
          { key: "role", label: storyText(context, copy.role), value: storyText(context, copy.roleName) },
        ]}
      />
    </TitledCard>
  ),
} satisfies Meta<typeof TitledCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A titled card, its link at the end of the heading row, and each value under its name. */
export const ProjectDetails: Story = {
  play: async (context) => {
    const card = within(context.canvas.getByRole("region", { name: storyText(context, copy.title) }));
    await expect(card.getByRole("link", { name: storyText(context, copy.link) })).toBeVisible();
    await expect(card.getAllByRole("term").map((t) => t.textContent)).toEqual([copy.code, copy.number, copy.host, copy.role].map((t) => storyText(context, t)));
    await expect(card.getByText(storyText(context, copy.hostName))).toBeVisible();
  },
};

/** Narrow: one value to a row, nothing scrolls sideways. */
export const Narrow: Story = {
  parameters: phone,
  play: async (context) => {
    await expect(context.canvasElement.scrollWidth).toBeLessThanOrEqual(context.canvasElement.clientWidth);
  },
};
