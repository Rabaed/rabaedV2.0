import type { FlowContext } from "../screens.ts";
import { found } from "./packages-seed.ts";

// pnpm screens --as saeed --steps scripts/screens-examples/withdraw-participant-flow.ts (RP-952)
//
// The Host Company's Project Admin (Saeed, TMC) withdraws a Participant from the Project page, end
// to end in the browser: the Withdraw button, the counts-only confirmation, the withdrawn row, the
// Vacancies card. It checks each step and throws on the first that is wrong, so it doubles as the
// withdrawal's web e2e; withdraw-participant-views.ts (as Ali) then checks "Waiting for a new ‹role›".
//
// A withdrawal has no undo, so each run (per language and width) withdraws a different Participant
// of the demo: run it on a fresh `pnpm demo`, once.

const runs: Record<string, { project: string; company: string }> = {
  "en-1366": { project: "NKD", company: "Design Consultants LLC" },
  "ar-1366": { project: "UAT04", company: "Design Consultants LLC" },
  "en-1920": { project: "UAT10", company: "Design Consultants LLC" },
  "ar-1920": { project: "NKD", company: "Beta Build" },
};

const withdrawLabel = (name: { en: string; ar: string }) => ({ en: `Withdraw ${name.en} from the Project`, ar: `سحب ${name.ar} من المشروع` });
const confirm = { en: "Withdraw", ar: "سحب" };
const cancelledLine = { en: "Cancelled by Rabaed", ar: "ستُلغى من رابض" };
const noUndo = { en: "This can't be undone.", ar: "لا يمكن التراجع عن هذا." };

type Participants = {
  participants: { id: string; company: { legalName: { en: string; ar: string } }; isOwnCompany: boolean }[];
  canWithdraw: boolean;
  withdrawn: { id: string }[];
};

export default async ({ page, api, goto, shot, inLocale, locale, width }: FlowContext) => {
  const run = found(runs[`${locale}-${width}`], `a run for ${locale} at ${width}`);
  const projects = ((await api.request("GET", "/projects")).body as { projects: { id: string; code: string }[] }).projects;
  const project = found(projects.find((p) => p.code === run.project), `Project ${run.project}`);
  const before = (await api.request("GET", `/projects/${project.id}/participants`)).body as Participants;
  if (!before.canWithdraw) throw new Error(`Saeed may not withdraw on ${run.project}: is he its Host Company's Project Admin?`);
  const target = found(
    before.participants.find((p) => p.company.legalName.en === run.company),
    `${run.company} on ${run.project} (already withdrawn? run this on a fresh pnpm demo)`,
  );

  // The Participants card: Withdraw on every row but the Host Company's own.
  await goto(`/projects/${project.id}`);
  const button = page.getByRole("button", { name: inLocale(withdrawLabel(target.company.legalName)) });
  await button.scrollIntoViewIfNeeded();
  await shot("withdraw-project-before");
  const own = found(before.participants.find((p) => p.isOwnCompany), "the Host Company's own row");
  if ((await page.getByRole("button", { name: inLocale(withdrawLabel(own.company.legalName)) }).count()) > 0)
    throw new Error("The Host Company's own row offers Withdraw.");

  // The confirmation: counts only, and no undo.
  await button.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText(inLocale(cancelledLine), { exact: false }).waitFor();
  await dialog.getByText(inLocale(noUndo)).waitFor();
  await shot("withdraw-dialog");

  // Withdrawn: the row moves to the withdrawn list, with no action.
  await dialog.getByRole("button", { name: inLocale(confirm), exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const withdrawn = page.getByTestId("withdrawn-participants");
  await withdrawn.waitFor();
  if ((await withdrawn.getByRole("button").count()) > 0) throw new Error("A withdrawn row offers an action.");
  const after = (await api.request("GET", `/projects/${project.id}/participants`)).body as Participants;
  if (!after.withdrawn.some((w) => w.id === target.id)) throw new Error(`${run.company} is not listed as withdrawn.`);
  if (after.participants.some((p) => p.id === target.id)) throw new Error(`${run.company} is still an active Participant.`);
  await shot("withdraw-project-after");

  // The Vacancies card, where the withdrawn Company held a Step (the Consultant runs).
  if (run.company === "Design Consultants LLC") {
    const vacancies = ((await api.request("GET", `/projects/${project.id}/vacancies`)).body as { vacancies: unknown[] }).vacancies;
    if (vacancies.length === 0) throw new Error(`No Vacancy on ${run.project} after the Consultant's withdrawal.`);
    await page.getByTestId("vacancies").waitFor();
  }
};

