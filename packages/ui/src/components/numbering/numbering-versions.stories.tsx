import type { NumberingVersion } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { storyLocale } from "../../storybook/locale.ts";
import { numberingText } from "../../storybook/numbering.ts";
import { phone } from "../../storybook/form.ts";
import { expectFocusTrapped, overlay } from "../../storybook/overlay.ts";
import { NumberingVersions, type NumberingVersionsProps } from "./numbering-versions.tsx";

// The Versions card of Document Numbering (RP-412 rebuild, owner decision
// 2026-10-09): each saved version with who saved it as the reader may know it
// (V14, V15), and the compare drawer. Story data only.

const tmc = { en: "TMC Constructions", ar: "تي إم سي للإنشاءات" };
const sar = "00000000-0000-4000-8000-000000000402";
const versions: NumberingVersion[] = [
  {
    workItemTypeId: null,
    version: 3,
    effectiveFrom: "2026-10-05T09:00:00.000Z",
    pattern: { segments: [{ kind: "project" }, { kind: "participant" }, { kind: "trade" }, { kind: "type" }], separator: "-", seqDigits: 3, countedBy: [0, 1, 2, 3] },
    savedBy: { rabaed: false, company: tmc, member: { en: "Saeed Al Qahtani", ar: "سعيد القحطاني" } },
  },
  {
    workItemTypeId: null,
    version: 2,
    effectiveFrom: "2026-09-20T09:00:00.000Z",
    pattern: { segments: [{ kind: "project" }, { kind: "type" }, { kind: "participant" }], separator: "/", seqDigits: 4, countedBy: [0, 1, 2] },
    savedBy: { rabaed: true, company: null, member: null },
  },
  {
    workItemTypeId: null,
    version: 1,
    effectiveFrom: "2026-09-01T09:00:00.000Z",
    pattern: { segments: [{ kind: "project" }, { kind: "type" }, { kind: "participant" }], separator: "-", seqDigits: 4, countedBy: [0, 1, 2] },
    savedBy: { rabaed: false, company: null, member: null },
  },
  { workItemTypeId: sar, version: 2, effectiveFrom: "2026-10-06T09:00:00.000Z", pattern: null, savedBy: { rabaed: false, company: tmc, member: null } },
  {
    workItemTypeId: sar,
    version: 1,
    effectiveFrom: "2026-09-25T09:00:00.000Z",
    pattern: { segments: [{ kind: "project" }, { kind: "type" }, { kind: "location", level: 2 }], separator: "-", seqDigits: 4, countedBy: [1, 2] },
    savedBy: { rabaed: false, company: tmc, member: null },
  },
];

const meta = {
  title: "Numbering/NumberingVersions",
  component: NumberingVersions,
  args: {
    t: numberingText("en"),
    locale: "en",
    versions,
    types: [
      { id: "00000000-0000-4000-8000-000000000401", code: "MAR", name: "Material Approval Request" },
      { id: sar, code: "SAR", name: "Shop Drawing" },
    ],
    example: { projectCode: "TWR", tradeCode: "EL", participant: { code: "TMC", ordinal: 1 }, locationPath: ["ZA", "T1", "F01"] },
  } satisfies NumberingVersionsProps,
  render: (args, context) => (
    <div className="max-w-[1056px]">
      <NumberingVersions {...args} t={numberingText(storyLocale(context))} locale={storyLocale(context)} />
    </div>
  ),
} satisfies Meta<typeof NumberingVersions>;

export default meta;
type Story = StoryObj<typeof meta>;

const text = (context: { globals: Record<string, unknown> }) => numberingText(storyLocale(context));
/** The elements showing a text: the table from a tablet up, the list on a phone (the other is display: none). */
const shown = (elements: HTMLElement[]) => elements.filter((element) => element.checkVisibility());

/** Each version, newest first, per scope: the Company by name, the person only when they are the reader's own, "Rabaed", or "A Project Admin". */
export const Default: Story = {
  play: async (context) => {
    const { canvas } = context;
    const t = text(context);
    const en = storyLocale(context) === "en";
    await expect(canvas.getAllByTestId("numbering-version")).toHaveLength(5);
    await expect(shown(canvas.getAllByText(t("savedByMember", { member: en ? "Saeed Al Qahtani" : "سعيد القحطاني", company: en ? tmc.en : tmc.ar })))).toHaveLength(1);
    await expect(shown(canvas.getAllByText(t("savedByRabaed")))).toHaveLength(1);
    await expect(shown(canvas.getAllByText(t("savedByAdmin")))).toHaveLength(1);
    await expect(shown(canvas.getAllByText(t("current")))).toHaveLength(2);
  },
};

/** Compare puts version 1 beside the current one, the differences marked. */
export const Compare: Story = {
  parameters: overlay,
  play: async (context) => {
    const { canvas } = context;
    const t = text(context);
    await userEvent.click(canvas.getByRole("button", { name: t("compareWith", { n: 1, scope: t("projectScope") }) }));
    const drawer = await within(document.body).findByTestId("numbering-compare-drawer");
    const [old, current] = within(drawer).getAllByTestId("version-card");
    await expect(within(old!).getByTestId("pattern-number")).toHaveTextContent("TWR-MAR-TMC-0001");
    await expect(within(current!).getByTestId("pattern-number")).toHaveTextContent("TWR-TMC-EL-MAR-001");
    await expect(within(old!).getAllByTestId("version-changed").length).toBeGreaterThan(0);
    await expect(within(current!).queryByTestId("version-changed")).toBeNull();
    await expectFocusTrapped(drawer);
  },
};

/** Before any save: the Rabaed Default, no versions. */
export const None: Story = {
  args: { versions: [] },
  play: async (context) => {
    await expect(context.canvas.getByText(text(context)("versionsNone"))).toBeVisible();
  },
};

/** On a phone, one block per version: the sample number and Compare in reach without scrolling sideways. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    const { canvas } = context;
    const t = text(context);
    const items = canvas.getAllByTestId("numbering-version-item");
    await expect(items).toHaveLength(5);
    for (const item of items) await expect(item).toBeVisible();
    const compare = canvas.getByRole("button", { name: t("compareWith", { n: 1, scope: t("projectScope") }) });
    const box = compare.getBoundingClientRect();
    await expect(box.right).toBeLessThanOrEqual(document.documentElement.clientWidth);
    await expect(box.left).toBeGreaterThanOrEqual(0);
  },
};
