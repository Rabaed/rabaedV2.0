import type { FormSchema } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import {
  allSubmittalPanelSectionsCollapsed,
  submittalPanelInternalCount,
  submittalPanelSectionKeys,
  submittalPanelSupplier,
  submittalPanelTab,
  withAllSubmittalPanelSections,
} from "./panel-sections-model.ts";

// A name in both languages, built as data (the package has no translations of its own).
const b = (en: string, ar: string = en) => Object.fromEntries([["en", en], ["ar", ar]]) as { en: string; ar: string };

const classification = {
  key: "classification",
  title: b("Classification"),
  fields: [
    { key: "trade", type: "trade", label: b("Trade"), required: true },
    { key: "location", type: "location", label: b("Location"), required: true },
    { key: "scopes", type: "scopes", label: b("Scopes"), required: false },
  ],
};

/** A material request's Form, as the Rabaed Default MAR has it: an Approved Supplier and an items table. */
const mar = {
  sections: [
    {
      key: "material",
      title: b("Material details"),
      fields: [
        { key: "manufacturer", type: "text", label: b("Manufacturer"), required: true },
        { key: "supplier", type: "approved_supplier", label: b("Approved supplier", "المورّد المعتمد"), required: true },
      ],
    },
    {
      key: "quantities",
      title: b("Items"),
      fields: [
        {
          key: "items",
          type: "table",
          label: b("Items", "البنود"),
          required: true,
          columns: [
            { key: "fixture_type", type: "text", label: b("Fixture type"), required: true },
            { key: "quantity", type: "number", label: b("Quantity"), required: true, decimals: 0 },
          ],
        },
      ],
    },
    classification,
  ],
} as unknown as FormSchema;

/** A drawing request's Form, as the Rabaed Default DAR has it: no supplier and no items. */
const dar = {
  sections: [
    { key: "document_details", title: b("Document details"), fields: [{ key: "document_title", type: "text", label: b("Title"), required: true }] },
    classification,
  ],
} as unknown as FormSchema;

/** A Form that asks no Location (a Project may lay its Form out so). */
const noLocation = {
  sections: [{ key: "details", title: b("Details"), fields: [{ key: "trade", type: "trade", label: b("Trade"), required: true }] }],
} as unknown as FormSchema;

describe("the Submittal Panel's fixed sections (owner decision C5)", () => {
  it("shows every fixed section a material request's Form has data for, in the design's order", () => {
    expect(submittalPanelSectionKeys(mar)).toEqual(["subject", "scope", "location", "supplier", "links"]);
  });

  it("hides Supplier & items for a Type whose Form has no Approved Supplier (a DAR)", () => {
    expect(submittalPanelSectionKeys(dar)).toEqual(["subject", "scope", "location", "links"]);
  });

  it("hides Location for a Form that asks none", () => {
    expect(submittalPanelSectionKeys(noLocation)).toEqual(["subject", "scope", "links"]);
  });
});

describe("Collapse all / Expand all", () => {
  const shown = ["subject", "scope", "links"];

  it("is all collapsed only when every shown section is folded", () => {
    expect(allSubmittalPanelSectionsCollapsed(shown, {})).toBe(false);
    expect(allSubmittalPanelSectionsCollapsed(shown, { subject: true, scope: true })).toBe(false);
    expect(allSubmittalPanelSectionsCollapsed(shown, { subject: true, scope: true, links: true })).toBe(true);
    // A folded section another Type has, not shown here, doesn't count.
    expect(allSubmittalPanelSectionsCollapsed(shown, { subject: true, scope: true, links: true, supplier: false })).toBe(true);
  });

  it("folds or opens every shown section, keeping what was kept for the sections not shown", () => {
    expect(withAllSubmittalPanelSections(shown, { supplier: true }, true)).toEqual({ supplier: true, subject: true, scope: true, links: true });
    expect(withAllSubmittalPanelSections(shown, { supplier: true, subject: true }, false)).toEqual({ supplier: true, subject: false, scope: false, links: false });
  });
});

describe("the open tab", () => {
  it("is the kept tab while the item offers it", () => {
    expect(submittalPanelTab("internal", ["details", "internal"])).toBe("internal");
  });

  it("falls back to Details when this item doesn't offer the kept tab (no Internal Communication for the viewer here)", () => {
    expect(submittalPanelTab("internal", ["details"])).toBe("details");
    expect(submittalPanelTab("chat", ["details", "internal"])).toBe("details");
  });
});

describe("Internal Communication's count (V5)", () => {
  it("counts the internal events of the history the viewer reads", () => {
    const events = [{ audience: "shared" }, { audience: "internal" }, { audience: "internal" }] as const;
    expect(submittalPanelInternalCount(events)).toBe(2);
  });

  it("is 0 for a viewer whose Participant has no internal history on the item: the tab is not offered", () => {
    expect(submittalPanelInternalCount([{ audience: "shared" }])).toBe(0);
  });
});

describe("Supplier & items", () => {
  const suppliers = [
    { id: "s-1", tradeId: "t-1", status: "approved" as const, name: b("Gulf Lighting Co.", "الخليج للإنارة") },
    { id: "s-2", tradeId: "t-1", status: "withdrawn" as const, name: b("Old Supplier") },
  ];

  it("names the Approved Supplier and lists each items table's rows, counting the items", () => {
    const answers = {
      supplier: "s-1",
      items: [
        { fixture_type: "Linear LED 1200", quantity: 240 },
        { fixture_type: "Downlight 150", quantity: 1200 },
      ],
    };
    expect(submittalPanelSupplier(mar, answers, suppliers, "en")).toEqual({
      suppliers: ["Gulf Lighting Co."],
      tables: [
        {
          key: "items",
          label: "Items",
          columns: [
            { key: "fixture_type", label: "Fixture type", numeric: false },
            { key: "quantity", label: "Quantity", numeric: true },
          ],
          rows: [
            ["Linear LED 1200", "240"],
            ["Downlight 150", "1,200"],
          ],
        },
      ],
      itemCount: 2,
    });
    expect(submittalPanelSupplier(mar, answers, suppliers, "ar").suppliers).toEqual(["الخليج للإنارة"]);
  });

  it("leaves out a supplier the list doesn't name, never showing its id", () => {
    expect(submittalPanelSupplier(mar, { supplier: "s-gone" }, suppliers, "en").suppliers).toEqual([]);
  });

  it("is empty for a Draft not answered yet", () => {
    expect(submittalPanelSupplier(mar, {}, suppliers, "en")).toMatchObject({ suppliers: [], itemCount: 0 });
  });

  it("has nothing for a Form with no Approved Supplier, even one with a table (a supplier request's past projects aren't items)", () => {
    const sar = {
      sections: [
        {
          key: "experience",
          title: b("Experience"),
          fields: [{ key: "past_projects", type: "table", label: b("Past projects"), required: false, columns: [{ key: "name", type: "text", label: b("Name"), required: true }] }],
        },
      ],
    } as unknown as FormSchema;
    expect(submittalPanelSupplier(sar, { past_projects: [{ name: "Tower" }] }, suppliers, "en")).toEqual({ suppliers: [], tables: [], itemCount: 0 });
  });
});
