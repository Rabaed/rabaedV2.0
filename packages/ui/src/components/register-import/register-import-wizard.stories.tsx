import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import type { RegisterImportFields, RegisterSheet } from "@rabaed/domain";
import ar from "../../../../../apps/web/messages/ar.json" with { type: "json" };
import en from "../../../../../apps/web/messages/en.json" with { type: "json" };
import { phone } from "../../storybook/form.ts";
import { translator } from "../../storybook/icu.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { LargerScreenBanner } from "../settings/settings-layout.tsx";
import { RegisterImportWizard, type RegisterImportClient } from "./register-import-wizard.tsx";

// The Submittal Register Import (RP-637) at its Map fields step, in the app's own words (apps/web/messages).
// RP-1275 (gap-table row 59, the owner's answer (a)): on a phone the column mapping is read-only under a
// "Continue on a larger screen" banner.

const messages = { en, ar } as const;

const types = [{ code: "MAR", name: { en: "Material Approval Request", ar: "طلب اعتماد مواد" } }];
const trades = [{ id: "7b1c3f1e-2f43-4c1a-9a51-0d3c7e2a1b01", code: "EL", name: { en: "Electrical", ar: "كهرباء" } }];
const fields: RegisterImportFields = {
  types,
  trades,
  locations: [],
  scopes: [],
  formFields: [],
  members: [],
  packages: [],
  mappings: [],
};

/** The register as the api reads it: three columns, each suggested from its heading. */
const sheet: RegisterSheet = {
  sheets: [{ name: "Register", rows: 3 }],
  sheet: "Register",
  headerRow: 1,
  top: [
    { rowNo: 1, cells: ["Subject", "Type", "Trade"] },
    { rowNo: 2, cells: ["Cable trays, level 3", "MAR", "Electrical"] },
    { rowNo: 3, cells: ["Lighting fixtures", "MAR", "Electrical"] },
  ],
  headers: ["Subject", "Type", "Trade"],
  examples: ["Cable trays, level 3", "MAR", "Electrical"],
  dataRows: 2,
  suggestions: [
    { field: "subject", score: 100 },
    { field: "type", score: 100 },
    { field: "trade", score: 100 },
  ],
};

const client: RegisterImportClient = {
  read: async () => ({ ok: true, body: sheet }),
  values: async () => ({ ok: false, error: "unavailable" }),
  preview: async () => ({ ok: false, error: "unavailable" }),
  confirm: async () => ({ ok: false, error: "unavailable" }),
};

const largerScreen = {
  title: { en: en.settings.largerScreen.title, ar: ar.settings.largerScreen.title },
  body: { en: en.settings.largerScreen.mapping, ar: ar.settings.largerScreen.mapping },
};

const meta = {
  title: "RegisterImport/RegisterImportWizard",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

function Wizard({ locale, phoneBanner }: { locale: "en" | "ar"; phoneBanner: boolean }) {
  const t = translator(messages[locale].registerImport, locale);
  return (
    <div className="bg-canvas p-4">
      <RegisterImportWizard
        locale={locale}
        t={t}
        client={client}
        importer={{ id: "3d0b6a3e-6a5b-4a8e-8a3e-1b2c3d4e5f60", name: { en: "Hafiz Hamdan", ar: "حافظ حمدان" } }}
        types={types}
        trades={trades}
        fields={fields}
        sample
        largerScreen={
          phoneBanner ? <LargerScreenBanner title={largerScreen.title[locale]}>{largerScreen.body[locale]}</LargerScreenBanner> : undefined
        }
      />
    </div>
  );
}

/** Upload → the sample register → its sheet → Map fields. */
async function toMapFields(canvas: ReturnType<typeof within>, locale: "en" | "ar") {
  const t = messages[locale].registerImport;
  await userEvent.click(canvas.getByRole("button", { name: t.upload.sample }));
  await userEvent.click(await canvas.findByRole("button", { name: new RegExp(t.next) }));
  await expect(await canvas.findByRole("region", { name: t.map.caption })).toBeVisible();
}

/**
 * On a phone the Map fields step is read-only (RP-1275): the banner says to carry on on a larger screen, the
 * columns' fields and the saved mappings can't be changed, and the import can't go on from here. Back still works.
 */
export const MapFieldsPhone: Story = {
  parameters: { ...phone, layout: "fullscreen" },
  render: (_args, context) => <Wizard locale={storyLocale(context)} phoneBanner />,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const t = messages[locale].registerImport;
    await toMapFields(canvas, locale);
    await expect(canvas.getByRole("note")).toHaveTextContent(largerScreen.title[locale]);
    const table = within(canvas.getByRole("region", { name: t.map.caption }));
    // Disabled on the trigger itself too: Radix opens a select on a mouse's pointerdown, which the fieldset doesn't stop.
    for (const select of canvas.getAllByRole("combobox")) await expect(select).toHaveAttribute("data-disabled");
    for (const box of table.getAllByRole("checkbox")) await expect(box).toBeDisabled();
    for (const radio of canvas.getAllByRole("radio")) await expect(radio).toBeDisabled();
    await expect(canvas.getByRole("button", { name: new RegExp(t.map.nextValues) })).toBeDisabled();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    // Back to the sheet still works.
    await expect(canvas.getByRole("button", { name: t.back })).toBeEnabled();
  },
};

/** Wider than a phone the mapping edits as ever: no banner, the fields can be changed. */
export const MapFields: Story = {
  render: (_args, context) => <Wizard locale={storyLocale(context)} phoneBanner />,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const t = messages[locale].registerImport;
    await toMapFields(canvas, locale);
    await expect(canvas.queryByRole("note")).toBeNull();
    const table = within(canvas.getByRole("region", { name: t.map.caption }));
    for (const select of table.getAllByRole("combobox")) await expect(select).toBeEnabled();
    await expect(canvas.getByRole("button", { name: new RegExp(t.map.nextValues) })).toBeEnabled();
  },
};
