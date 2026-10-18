// A Checklist Template for the tests that raise WIRs (RP-651): the WIR Form Version 3 asks
// for one of the Project's templates of the WIR's Trade to leave Draft.
import { randomUUID } from "node:crypto";
import type { ChecklistTemplates } from "@rabaed/domain";
import type { Caller } from "./harness.ts";
import { ok } from "./tower.ts";

/**
 * A new active Checklist Template of two checks for Trade `tradeId` on `projectId`, created by
 * `admin` (a Project Admin), and the id of its Version 1, as a `checklist_template` answer names it.
 */
export async function checklistTemplate(admin: Caller, projectId: string, tradeId: string): Promise<string> {
  const name = `Checks ${randomUUID().slice(0, 8)}`;
  const items = [
    { key: "fixings", text: { en: "Fixings as per drawing", ar: "التثبيت حسب المخطط" } },
    { key: "clearances", text: { en: "Clearances kept", ar: "المسافات محفوظة" }, comment: "required_on_negative" },
  ];
  const created = await ok(admin.post(`/v1/projects/${projectId}/checklist-templates`, { name: { en: name, ar: name }, tradeId, items }), 201);
  const list: ChecklistTemplates = (await ok(admin.get(`/v1/projects/${projectId}/checklist-templates`), 200)).json();
  return list.templates.find((t) => t.id === created.json().id)!.versionId;
}
