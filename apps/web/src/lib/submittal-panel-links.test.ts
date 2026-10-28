import type { WorkItemLink } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { submittalPanelLinks } from "./submittal-panel-links.ts";

// The Submittal Panel's Links section (RP-1066) follows the Links row of docs/visibility.md (E1,
// RP-521): a linked item the viewer can't see reaches the browser as its number and Subject only,
// without its id, and opens on the Link's own page by the Link's id.

const item = "11111111-1111-4111-8111-111111111111";
const seenTarget = "22222222-2222-4222-8222-222222222222";

/** A Link as the Links read gives it. */
const link = (over: Partial<WorkItemLink>): WorkItemLink => ({
  id: "33333333-3333-4333-8333-333333333333",
  kind: "related",
  fieldKey: null,
  documentNumber: "TWR-TMC-EL-DAR-031",
  subject: "Lighting layout",
  workItemId: seenTarget,
  ...over,
});

describe("the Submittal Panel's Links (Links row)", () => {
  it("opens a linked item the viewer sees on its own page (the positive control)", () => {
    expect(submittalPanelLinks(item, [link({})])).toEqual([
      { id: "33333333-3333-4333-8333-333333333333", documentNumber: "TWR-TMC-EL-DAR-031", subject: "Lighting layout", href: `/work-items/${seenTarget}` },
    ]);
  });

  it("shows a linked item the viewer can't see by its number and Subject only, opening on the Link's own page", () => {
    const hidden = link({ id: "44444444-4444-4444-8444-444444444444", documentNumber: "TWR-DCL-EL-QST-007", subject: "Emergency lux levels", workItemId: null });
    const [shown] = submittalPanelLinks(item, [hidden]);
    expect(shown).toEqual({
      id: "44444444-4444-4444-8444-444444444444",
      documentNumber: "TWR-DCL-EL-QST-007",
      subject: "Emergency lux levels",
      href: `/work-items/${item}/links/44444444-4444-4444-8444-444444444444`,
    });
    // Only these four: nothing else of the hidden item reaches the panel.
    expect(Object.keys(shown!).sort()).toEqual(["documentNumber", "href", "id", "subject"]);
  });

  it("lists each Link once, in the read's order, a field's Links too", () => {
    const fieldLink = link({ id: "55555555-5555-4555-8555-555555555555", kind: "relies_on", fieldKey: "related_submittals", documentNumber: "TWR-TMC-EL-MAR-040" });
    expect(submittalPanelLinks(item, [link({}), fieldLink]).map((l) => l.documentNumber)).toEqual(["TWR-TMC-EL-DAR-031", "TWR-TMC-EL-MAR-040"]);
  });
});
