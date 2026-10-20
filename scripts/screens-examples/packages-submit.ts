import type { SetupApi } from "../screens.ts";
import { readyPackage } from "./packages-seed.ts";

// pnpm screens --as ali --setup scripts/screens-examples/packages-submit.ts (RP-968)
//
// The Package page as TMC's Project Manager, with an Open Package ready to Submit, then with
// its Submit Package dialog open. Run on a fresh `pnpm demo`; each run adds a Package.

export default async (api: SetupApi) => {
  const pkg = await readyPackage(api, { en: "Tower 1 lighting (screens example)", ar: "إنارة البرج 1 (مثال اللقطات)" }, [
    "Recessed downlights – Tower 1 Floor 01",
    "Corridor luminaires – Tower 1 Floor 01",
  ]);
  return { packageId: pkg.id };
};

const submitPackage = { en: "Submit Package", ar: "تقديم الحزمة" };

export const screens = [
  { name: "package-open", route: "/packages/{packageId}" },
  {
    name: "package-submit-dialog",
    route: "/packages/{packageId}",
    actions: [{ click: "button", name: submitPackage }, { waitFor: "dialog" }],
  },
];
