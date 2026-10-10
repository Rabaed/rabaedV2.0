import type { WorkItemLink } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { hiddenLinkHrefs } from "./link-search.ts";

const item = "00000000-0000-4000-8000-000000000001";
const link = (id: string, documentNumber: string, workItemId: string | null, fieldKey: string | null = null): WorkItemLink => ({
  id: `00000000-0000-4000-8000-00000000000${id}`,
  kind: fieldKey ? "relies_on" : "related",
  fieldKey,
  documentNumber,
  subject: `Subject of ${documentNumber}`,
  workItemId,
});

describe("hiddenLinkHrefs", () => {
  it("opens each hidden item on its first Link's page, by the Link's own id, through the item it is linked from; never one the viewer sees", () => {
    const links = [
      link("a", "TWR-MAR-01-0001", null, "related_submittals"),
      link("b", "TWR-MAR-01-0002", "00000000-0000-4000-8000-000000000099"),
      link("c", "TWR-MAR-01-0001", null),
      link("d", "TWR-MAR-01-0003", null),
    ];
    expect(hiddenLinkHrefs(item, links)).toEqual({
      "TWR-MAR-01-0001": `/work-items/${item}/links/00000000-0000-4000-8000-00000000000a`,
      "TWR-MAR-01-0003": `/work-items/${item}/links/00000000-0000-4000-8000-00000000000d`,
    });
  });
});
