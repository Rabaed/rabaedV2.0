import { demoPdf } from "../../apps/api/src/demo/demo-pdf.ts";
import type { SetupApi } from "../screens.ts";

// Shared by the Packages examples of `pnpm screens --setup` (RP-968): on a fresh `pnpm demo`,
// Hafiz raises complete MARs on Riyadh Gate Tower with their Datasheets, puts them in a new
// Package of TMC's and sends each for review; Ali picks each up, so the Package is ready to Submit.

const bi = (en: string, ar: string) => ({ en, ar });

/** The Package's id and number, and its items' ids in the order of `titles`. */
export type ReadyPackage = { id: string; number: string; items: string[] };

export async function readyPackage(api: SetupApi, name: { en: string; ar: string }, titles: string[]): Promise<ReadyPackage> {
  const hafiz = await api.as("hafiz");
  const ali = await api.as("ali");
  const { body: list } = (await hafiz.request("GET", "/projects")) as { body: { projects: { id: string; code: string }[] } };
  const projectId = list.projects.find((p) => p.code === "TWR")!.id;
  const { body: dims } = (await hafiz.request("GET", `/projects/${projectId}/dimensions`)) as {
    body: { trade: { id: string; code: string }[]; location: { id: string; code: string }[] };
  };
  const electrical = dims.trade.find((t) => t.code === "EL")!.id;
  const location = dims.location.find((l) => l.code === "T1F01")!.id;
  const { body: approved } = (await hafiz.request("GET", `/projects/${projectId}/approved-suppliers?tradeId=${electrical}`)) as {
    body: { suppliers: { id: string; name: { en: string } }[] };
  };
  const supplier = approved.suppliers.find((s) => s.name.en === "Najd Electrical Supplies")!.id;

  const items: string[] = [];
  for (const title of titles) {
    const { body } = (await hafiz.request("POST", `/projects/${projectId}/work-items`, {
      type: "MAR",
      title,
      answers: {
        manufacturer: "Demo Manufacturer",
        supplier,
        model: "DM-100",
        specification_section: "26 51 00",
        description: `${title}, as the specification.`,
        items: [{ fixture_type: title, description: "As drawing", quantity: 10, unit: "pcs" }],
        trade: electrical,
        location,
      },
    })) as { body: { id: string } };
    await hafiz.upload(body.id, "datasheet", {
      fileName: `${title.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`,
      contentType: "application/pdf",
      body: demoPdf([title, "Demo datasheet: made up for the Rabaed demo."]),
    });
    items.push(body.id);
  }
  const { body: pkg } = (await hafiz.request("POST", `/projects/${projectId}/packages`, { name: bi(name.en, name.ar) })) as { body: { id: string; number: string } };
  for (const id of items) await hafiz.request("POST", `/packages/${pkg.id}/items`, { workItemId: id });
  for (const id of items) await hafiz.transition(id, "send_for_review");
  for (const id of items) await ali.request("POST", `/work-items/${id}/pick-up`);
  return { id: pkg.id, number: pkg.number, items };
}
