import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { storyText } from "../../storybook/locale.ts";
import { WithChip } from "./with-chip.tsx";

const person = { en: "Faisal Al Harbi", ar: "فيصل الحربي" };
const ownCompany = { en: "Tamkeen Contracting", ar: "تمكين للمقاولات" };
const otherCompany = { en: "Al Waha PMC", ar: "الواحة لإدارة المشاريع" };

const meta = {
  title: "Status/WithChip",
  component: WithChip,
  args: { kind: "person", companyName: "", inViewerCompany: true },
} satisfies Meta<typeof WithChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Held by someone in the viewer's own Company: the person, by name. */
export const PersonInViewerCompany: Story = {
  render: (args, context) => (
    <WithChip {...args} name={storyText(context, person)} companyName={storyText(context, ownCompany)} />
  ),
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, person))).toBeVisible();
  },
};

/**
 * Held by someone in another Company: the Company's name only, even though a
 * person's name was passed in (visibility V14). Nothing of the person reaches
 * the page, not even in an attribute.
 */
export const PersonInAnotherCompany: Story = {
  args: { inViewerCompany: false },
  render: (args, context) => (
    <WithChip {...args} name={storyText(context, person)} photoSrc="/people/faisal.png" companyName={storyText(context, otherCompany)} />
  ),
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, otherCompany))).toBeVisible();
    for (const secret of [person.en, person.ar, "faisal"]) {
      await expect(context.canvasElement.outerHTML.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  },
};

/** Held by a Company as a whole (nobody has claimed the Step yet): the Company's name, in either Company. */
export const Company: Story = {
  args: { kind: "company" },
  render: (args, context) => (
    <div className="flex flex-wrap gap-2">
      <WithChip {...args} companyName={storyText(context, ownCompany)} />
      <WithChip {...args} companyName={storyText(context, otherCompany)} inViewerCompany={false} />
    </div>
  ),
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, ownCompany))).toBeVisible();
    await expect(context.canvas.getByText(storyText(context, otherCompany))).toBeVisible();
  },
};
