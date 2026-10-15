/* eslint-disable rabaed/no-avoid-terms -- PROTOTYPE, throwaway (RP-19). */
// PROTOTYPE, throwaway (RP-19). Drives the Puck form builder story with a real
// mouse (Playwright), in English and Arabic: drags within and between sections,
// inserts from the palette, saves, and screenshots each language. Needs the
// prototype's Storybook running (`pnpm prototype:puck`, port 6116).
// Run: node packages/ui/scripts/puck-prototype-check.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, type Locator } from "playwright";

const base = "http://localhost:6116/iframe.html?id=prototypes-puck-form-builder--builder&viewMode=story";
const out = new URL("../src/components/form-engine/form-builder.prototype-screens/", import.meta.url);
mkdirSync(out, { recursive: true });
const file = (name: string) => fileURLToPath(new URL(name, out));

const browser = await chromium.launch();
const report: Record<string, unknown> = {};

for (const locale of ["en", "ar"] as const) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(`${base}&globals=locale:${locale}`);
  const canvas = page.frameLocator("iframe").first();
  await canvas.locator('[data-puck-component="trade-trade"]').waitFor();
  await page.waitForTimeout(1500);

  const block = (id: string) => canvas.locator(`[data-puck-component="${id}"]`).first();
  const schema = async () => {
    const s = JSON.parse(await page.getByTestId("schema").innerText()) as { sections: { key: string; fields: { key: string }[] }[] };
    return s.sections.map((x) => `${x.key}: ${x.fields.map((f) => f.key).join(", ")}`).join(" | ");
  };
  const state = async () => (await page.getByTestId("state").innerText()).split("\n").slice(2, 6).join(" / ");
  const point = async (target: Locator, edge: "top" | "bottom") => {
    const b = (await target.boundingBox())!;
    return { x: b.x + b.width / 2, y: edge === "top" ? b.y + 6 : b.y + b.height - 6 };
  };
  async function drag(from: Locator, to: Locator, edge: "top" | "bottom") {
    const b = (await from.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + Math.min(20, b.height / 2));
    await page.mouse.down();
    await page.waitForTimeout(300);
    // Aim again as the layout moves under the dragged block.
    for (let i = 0; i < 3; i++) {
      const p = await point(to, edge);
      await page.mouse.move(p.x, p.y, { steps: 15 });
      await page.waitForTimeout(200);
    }
    await page.mouse.up();
    await page.waitForTimeout(800);
    return schema();
  }

  const steps: Record<string, string> = { start: await schema() };
  steps.withinUp_locationAboveTrade = await drag(block("location-location"), block("trade-trade"), "top");
  steps.withinDown_tradeBelowScopes = await drag(block("trade-trade"), block("scopes-scopes"), "bottom");
  steps.betweenDown_referenceUnderChecklist = await drag(block("text-subject_note"), block("checklist-pour_check"), "bottom");
  steps.betweenUp_gradeAboveScopes = await drag(block("select-concrete_grade"), block("scopes-scopes"), "top");
  const drawerSelect = page.getByText(locale === "ar" ? "قائمة اختيار" : "Select", { exact: true }).first();
  steps.insert_selectAboveChecklist = await drag(drawerSelect, block("checklist-pour_check"), "top");
  await page.getByTestId("save").click();
  await page.waitForTimeout(500);
  steps.saved = await state();

  // Screenshots: the checklist selected (our item editor in the panel), then the canvas in the other language.
  await block("checklist-pour_check").click({ position: { x: 40, y: 10 } });
  await page.waitForTimeout(600);
  console.log(locale, steps);
  await page.screenshot({ path: file(`${locale}-1-builder.png`) });
  await block("select-concrete_grade").click({ position: { x: 40, y: 10 } });
  await page.waitForTimeout(600);
  await page.screenshot({ path: file(`${locale}-2-select-options.png`) });
  await page.getByTestId("preview-locale").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: file(`${locale}-3-preview-other-language.png`) });
  await page.getByTestId("state").scrollIntoViewIfNeeded();
  await page.getByTestId("state").screenshot({ path: file(`${locale}-4-state.png`) });
  report[locale] = steps;
  await page.close();
}

await browser.close();
writeFileSync(file("report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
