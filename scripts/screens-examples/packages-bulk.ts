import { randomUUID } from "node:crypto";
import type { SetupApi } from "../screens.ts";
import { readyPackage } from "./packages-seed.ts";

// pnpm screens --as mohammed --setup scripts/screens-examples/packages-bulk.ts (RP-968)
//
// The Package page as Design Consultants' Project Manager, holding three MARs of an In Progress
// Package at the same Step: two rows selected with the bar's shared Codes, then Code A's bulk
// Action Form open. Run on a fresh `pnpm demo`; each run adds a Package.

const titles = ["Lighting control modules – Tower 1 Floor 01", "Final distribution boards – Tower 1 Floor 01", "Small power outlets – Tower 1 Floor 01"];

export default async (api: SetupApi) => {
  const pkg = await readyPackage(api, { en: "Tower 1 power (screens example)", ar: "طاقة البرج 1 (مثال اللقطات)" }, titles);
  const ali = await api.as("ali");
  await ali.request("POST", `/packages/${pkg.id}/submit`, { confirmed: true, idempotencyKey: randomUUID() });
  // Ahmed recommends Code A on each; Mohammed, who issues the Code, picks each up.
  const ahmed = await api.as("ahmed");
  for (const id of pkg.items) {
    await ahmed.request("POST", `/work-items/${id}/pick-up`);
    await ahmed.transition(id, "send_to_manager", { answers: { sample_checked: true, matches_specification: true }, recommendedCode: "A", internalNote: "Recommend A." });
    await api.request("POST", `/work-items/${id}/pick-up`);
  }
  return { packageId: pkg.id };
};

// Rows are found by their Subject, the same in both languages; the Code's name is the Workflow's own.
const select = [{ check: titles[0]! }, { check: titles[1]! }];

export const screens = [
  { name: "package-bulk-selected", route: "/packages/{packageId}", actions: select },
  {
    name: "package-bulk-action-form",
    route: "/packages/{packageId}",
    actions: [...select, { click: "button", name: { en: "Approve · A", ar: "اعتماد · A" } }, { waitFor: "dialog", name: { en: "Approve · A", ar: "اعتماد · A" } }],
  },
];
