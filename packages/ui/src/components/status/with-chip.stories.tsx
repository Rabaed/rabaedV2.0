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
  // Each story renders its own holders, so each can be one member of the union; these args only satisfy Meta.
  args: { kind: "company", companyName: "", inViewerCompany: true },
} satisfies Meta<typeof WithChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Held by someone in the viewer's own Company: the person, by name. */
export const PersonInViewerCompany: Story = {
  render: (_args, context) => (
    <WithChip kind="person" inViewerCompany name={storyText(context, person)} companyName={storyText(context, ownCompany)} />
  ),
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, person))).toBeVisible();
  },
};

/**
 * Held by someone in another Company: the Company's name only (visibility
 * V14). Their name and photo are forced through here, past the typecheck, and
 * nothing of the person reaches the page, not even in an attribute.
 */
export const PersonInAnotherCompany: Story = {
  render: (_args, context) => (
    // @ts-expect-error Another Company's person has no name or photo here (V14).
    <WithChip
      kind="person"
      inViewerCompany={false}
      name={storyText(context, person)}
      photoSrc="/people/faisal.png"
      companyName={storyText(context, otherCompany)}
    />
  ),
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, otherCompany))).toBeVisible();
    for (const secret of [person.en, person.ar, "faisal"]) {
      await expect(context.canvasElement.outerHTML.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  },
};

/** Held by a Company as a whole (nobody has picked up the Step yet): the Company's name, in either Company. */
export const Company: Story = {
  render: (_args, context) => (
    <div className="flex flex-wrap gap-2">
      <WithChip kind="company" inViewerCompany companyName={storyText(context, ownCompany)} />
      <WithChip kind="company" inViewerCompany={false} companyName={storyText(context, otherCompany)} />
    </div>
  ),
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, ownCompany))).toBeVisible();
    await expect(context.canvas.getByText(storyText(context, otherCompany))).toBeVisible();
  },
};

/** A Step of the viewer's own Company that nobody has picked up: the Step, then "not picked up"; no person, no avatar. */
export const NotPickedUpOwnStep: Story = {
  render: (_args, context) => (
    <WithChip
      kind="pool"
      inViewerCompany
      companyName={storyText(context, ownCompany)}
      stepName={storyText(context, { en: "Contractor review", ar: "مراجعة المقاول" })}
      notPickedUpLabel={storyText(context, { en: "not picked up", ar: "لم تُستلَم" })}
    />
  ),
  play: async (context) => {
    await expect(context.canvasElement).toHaveTextContent(storyText(context, { en: "Contractor review · not picked up", ar: "مراجعة المقاول · لم تُستلَم" }));
    await expect(context.canvasElement.querySelector("img")).toBeNull();
  },
};
