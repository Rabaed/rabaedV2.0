// A Checklist Template for the tests that raise WIRs (RP-651): the WIR Form Version 3 asks
// for one of the Project's templates of the WIR's Trade to leave Draft; and its checklist,
// answered by the Consultant Engineer before Send to Manager (RP-86).
import { randomUUID } from "node:crypto";
import type { ChecklistTemplates, WorkItemDetail } from "@rabaed/domain";
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

/**
 * `by`, a Member of the Participant holding WIR `id` at a Step that fills its reply checklists
 * (RP-86: the Consultant Engineer), answers every check item Pass (or Yes), as the inspector
 * does on site, so the WIR moves on.
 */
export async function passChecklists(by: Caller, id: string): Promise<void> {
  const item: WorkItemDetail = (await ok(by.get(`/v1/work-items/${id}`), 200)).json();
  for (const checklist of item.replyChecklists) {
    const answers = Object.fromEntries(checklist.items.map((i) => [i.key, { answer: i.answers === "yes_no_na" ? "yes" : "pass" }]));
    await ok(by.request("PUT", `/v1/work-items/${id}/reply-checklists/${checklist.fieldKey}`, { answers }), 204);
  }
}
