import type { FlowContext } from "../screens.ts";
import { found } from "./packages-seed.ts";

// pnpm screens --as ali --steps scripts/screens-examples/withdraw-participant-views.ts (RP-952)
//
// After withdraw-participant-flow.ts withdrew Design Consultants from Al Nakheel (NKD), TMC's
// Project Manager reads "Waiting for a new Consultant" where the Consultant held a Step: on the List,
// the Kanban and the item; never the withdrawn Company as its holder. It throws on the first that is
// wrong, so it is the second half of the withdrawal's web e2e. It changes nothing.

const waitingFor = { en: "Waiting for a new Consultant", ar: "بانتظار الاستشاري الجديد" };

type Row = { id: string; documentNumber: string | null; with: unknown; vacancy?: { projectRole: { baseRole: string } } | null };

export default async ({ page, api, goto, shot, inLocale }: FlowContext) => {
  const projects = ((await api.request("GET", "/projects")).body as { projects: { id: string; code: string }[] }).projects;
  const project = found(projects.find((p) => p.code === "NKD"), "Project NKD");
  const rows: Row[] = [];
  for (let p = 1; p <= 10; p += 1) {
    const items = ((await api.request("GET", `/projects/${project.id}/work-items?page=${p}`)).body as { items: Row[] }).items;
    rows.push(...items);
    if (items.length === 0) break;
  }
  const vacant = found(
    rows.find((r) => r.vacancy?.projectRole.baseRole === "consultant"),
    "an item whose Step is a Vacancy (run withdraw-participant-flow.ts as saeed first)",
  );
  if (vacant.with !== null) throw new Error("A Vacancy's row still names a holder.");

  // Searched to its number, so its row or card is on screen.
  const q = encodeURIComponent(found(vacant.documentNumber ?? undefined, "its Document Number"));
  for (const view of ["list", "kanban"] as const) {
    await goto(`/projects/${project.id}/work-items?view=${view}&q=${q}`);
    await page.getByText(inLocale(waitingFor)).first().waitFor();
    if ((await page.getByText(/Design Consultants/).count()) > 0) throw new Error(`The ${view} names the withdrawn Company.`);
    await shot(`withdraw-${view}`);
  }

  // A Submittal opens in the Submittal Panel (its With fact); another item on its page (its With line).
  await goto(`/work-items/${vacant.id}`);
  await page.locator('[data-fact="with"], [data-testid="with-line"]').filter({ hasText: inLocale(waitingFor) }).first().waitFor();
  await shot("withdraw-item");
};
