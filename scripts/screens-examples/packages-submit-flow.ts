import type { StepContext } from "../screens.ts";
import { readyPackage } from "./packages-seed.ts";

// pnpm screens --as ali --steps scripts/screens-examples/packages-submit-flow.ts (RP-991)
//
// A Package Submitted through its dialog, as TMC's Project Manager: ready, the dialog open, then
// Submitted. Submitting changes the Package, so each run (per language and width) makes its own
// first. Run on a fresh `pnpm demo`; each run adds four Packages (two with --phone).

const submitPackage = { en: "Submit Package", ar: "تقديم الحزمة" };

export default async ({ page, api, goto, shot, inLocale, locale, width }: StepContext) => {
  const pkg = await readyPackage(api, { en: `Tower 1 lighting (flow, ${locale} ${width})`, ar: `إنارة البرج 1 (تدفق، ${locale} ${width})` }, [
    `Recessed downlights – flow ${locale} ${width}`,
    `Corridor luminaires – flow ${locale} ${width}`,
  ]);
  await goto(`/packages/${pkg.id}`);
  await shot("flow-package-ready");

  await page.getByRole("button", { name: inLocale(submitPackage), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await shot("flow-submit-dialog");

  await dialog.getByRole("button", { name: inLocale(submitPackage), exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await shot("flow-package-submitted");
};
