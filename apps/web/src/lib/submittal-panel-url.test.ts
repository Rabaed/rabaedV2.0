import { describe, expect, it } from "vitest";
import {
  newInspectionLanding,
  newItemFrom,
  newItemLanding,
  newItemModuleFrom,
  newSubmittalPanelHref,
  openIdFrom,
  sizeFrom,
  submittalPanelHref,
} from "./submittal-panel-url.ts";

// RP-1061: the Submittal Panel's state is `?open=<id>` on the List and the Kanban, so a reload
// or a shared link reopens it. Every other part of the URL (filters, page, view) is kept.

const id = "6f1c1c3e-2d0b-4c1e-9a43-3b1f1f0a2b11";

describe("the Submittal Panel's URL", () => {
  it("adds the open item to the page's own query", () => {
    expect(submittalPanelHref("/en/projects/p/submittals", "?view=kanban&stage=pending", id)).toBe(`/en/projects/p/submittals?view=kanban&stage=pending&open=${id}`);
  });

  it("swaps the open item in place", () => {
    expect(submittalPanelHref("/en/projects/p/submittals", `?open=${id}&page=2`, "0a0b0c0d-0000-4000-8000-000000000001")).toBe(
      "/en/projects/p/submittals?open=0a0b0c0d-0000-4000-8000-000000000001&page=2",
    );
  });

  it("drops it on close, leaving the rest", () => {
    expect(submittalPanelHref("/en/projects/p/submittals", `?page=2&open=${id}`, null)).toBe("/en/projects/p/submittals?page=2");
    expect(submittalPanelHref("/en/projects/p/submittals", `?open=${id}`, null)).toBe("/en/projects/p/submittals");
  });

  it("drops the link's size with it on close, so the next item opened is an ordinary view", () => {
    expect(submittalPanelHref("/en/projects/p/submittals", `?open=${id}&size=wide&page=2`, null)).toBe("/en/projects/p/submittals?page=2");
    expect(submittalPanelHref("/en/projects/p/submittals", `?open=${id}&size=wide`, "0a0b0c0d-0000-4000-8000-000000000001")).toBe(
      "/en/projects/p/submittals?open=0a0b0c0d-0000-4000-8000-000000000001&size=wide",
    );
  });

  // RP-1063: a link that sets the panel's size (`?open=<id>&size=wide`) opens it at that size,
  // and never keeps it as the viewer's own (README §2).
  it("reads a size the link sets: one of the four presets, nothing else", () => {
    expect(sizeFrom(new URLSearchParams(`open=${id}&size=compact`))).toBe(440);
    expect(sizeFrom(new URLSearchParams(`open=${id}&size=normal`))).toBe(640);
    expect(sizeFrom(new URLSearchParams(`open=${id}&size=wide`))).toBe(960);
    expect(sizeFrom(new URLSearchParams(`open=${id}&size=full`))).toBe("full");
    expect(sizeFrom(new URLSearchParams(`open=${id}&size=9999`))).toBeNull();
    expect(sizeFrom(new URLSearchParams(`open=${id}`))).toBeNull();
  });

  it("reads only an id that can be an item's (a uuid), so an edited link asks the api nothing odd", () => {
    expect(openIdFrom(new URLSearchParams(`open=${id}`))).toBe(id);
    expect(openIdFrom(new URLSearchParams("open=../members"))).toBeNull();
    expect(openIdFrom(new URLSearchParams(""))).toBeNull();
  });
});

// RP-1152: the create panel's place in the URL is `?new=1`, or `?new=SAR` once a Type is picked, with
// the link's size. `type` is the List's own Type filter, so the picked Type never goes there. The
// panel and an open item never share the URL: opening one closes the other.
describe("the create panel's URL", () => {
  it("opens the create panel at the link's size, keeping the List's own query", () => {
    expect(newSubmittalPanelHref("/en/projects/p/work-items", "?view=kanban", { size: "wide" })).toBe("/en/projects/p/work-items?view=kanban&new=1&size=wide");
    expect(newSubmittalPanelHref("/en/projects/p/work-items", "", {})).toBe("/en/projects/p/work-items?new=1");
  });

  it("names the picked Type in place, leaving the List's Type filter alone", () => {
    expect(newSubmittalPanelHref("/en/projects/p/work-items", "?new=1&size=wide", { type: "SAR" })).toBe("/en/projects/p/work-items?new=SAR&size=wide");
    expect(newSubmittalPanelHref("/en/projects/p/work-items", "?type=MAR&new=SAR", { type: "DAR" })).toBe("/en/projects/p/work-items?type=MAR&new=DAR");
    expect(newSubmittalPanelHref("/en/projects/p/work-items", "?new=SAR", { size: "wide" })).toBe("/en/projects/p/work-items?new=SAR&size=wide");
  });

  it("closes an open item when it opens", () => {
    expect(newSubmittalPanelHref("/en/projects/p/work-items", `?open=${id}&size=full&page=2`, { size: "wide" })).toBe("/en/projects/p/work-items?page=2&new=1&size=wide");
  });

  it("drops itself and its size on close, keeping the List's filters", () => {
    expect(newSubmittalPanelHref("/en/projects/p/work-items", "?page=2&type=MAR&new=SAR&size=wide", null)).toBe("/en/projects/p/work-items?page=2&type=MAR");
  });

  it("is closed when an item opens, keeping the List's Type filter", () => {
    expect(submittalPanelHref("/en/projects/p/work-items", "?new=SAR&size=wide&type=MAR", id)).toBe(`/en/projects/p/work-items?size=wide&type=MAR&open=${id}`);
  });

  it("reads whether the create panel is open and its Type", () => {
    expect(newItemFrom(new URLSearchParams("new=SAR"))).toEqual({ type: "SAR", draft: null });
    expect(newItemFrom(new URLSearchParams("new=1"))).toEqual({ type: null, draft: null });
    expect(newItemFrom(new URLSearchParams("type=SAR"))).toBeNull();
    // A Type code is a short Document Number segment: anything else opens it on the first Type and asks the api nothing.
    expect(newItemFrom(new URLSearchParams("new=../me"))).toEqual({ type: null, draft: null });
  });

  // Row 38: after the first save the URL holds the new Draft (`&draft=<id>`), so a reload keeps it.
  it("holds the saved Draft beside its Type, keeping the size and the List's query", () => {
    expect(newSubmittalPanelHref("/en/projects/p/work-items", "?page=2&new=MAR&size=wide", { type: "MAR", draft: id })).toBe(
      `/en/projects/p/work-items?page=2&new=MAR&size=wide&draft=${id}`,
    );
  });

  it("drops the Draft with the panel on close, and when an item opens", () => {
    expect(newSubmittalPanelHref("/en/projects/p/work-items", `?page=2&new=MAR&draft=${id}&size=wide`, null)).toBe("/en/projects/p/work-items?page=2");
    expect(submittalPanelHref("/en/projects/p/work-items", `?new=MAR&draft=${id}`, "0a0b0c0d-0000-4000-8000-000000000001")).toBe(
      "/en/projects/p/work-items?open=0a0b0c0d-0000-4000-8000-000000000001",
    );
  });

  it("reads the saved Draft: only an id that can be an item's, and only with the panel open", () => {
    expect(newItemFrom(new URLSearchParams(`new=MAR&draft=${id}`))).toEqual({ type: "MAR", draft: id });
    expect(newItemFrom(new URLSearchParams("new=MAR&draft=../members"))).toEqual({ type: "MAR", draft: null });
    expect(newItemFrom(new URLSearchParams(`draft=${id}`))).toBeNull();
  });

  it("lands a direct link to the New page on the List with the panel at Normal (decision 1)", () => {
    expect(newItemLanding("p1")).toBe("/projects/p1/work-items?new=1&size=normal");
    expect(newItemLanding("p1", "SAR")).toBe("/projects/p1/work-items?new=SAR&size=normal");
  });
});

// RP-1221 (gap row 2): a New Inspection opens over the tab the Project shows Inspections in. On
// the Inspections tab the tab names the Module; on the Submittals tab, when the Project shows them
// there (ADR 0025), `&newModule=inspections` does.
describe("the create panel's URL for another Module", () => {
  it("names the Module beside `new`, and drops it on close", () => {
    expect(newSubmittalPanelHref("/en/projects/p/work-items", "?page=2", { size: "wide", module: "inspections" })).toBe(
      "/en/projects/p/work-items?page=2&new=1&size=wide&newModule=inspections",
    );
    expect(newSubmittalPanelHref("/en/projects/p/work-items", "?new=WIR&newModule=inspections&size=wide", null)).toBe("/en/projects/p/work-items");
  });

  it("keeps the Module through a Type pick and a save", () => {
    expect(newSubmittalPanelHref("/en/projects/p/work-items", "?new=1&newModule=inspections", { type: "WIR" })).toBe(
      "/en/projects/p/work-items?new=WIR&newModule=inspections",
    );
    expect(newSubmittalPanelHref("/en/projects/p/work-items", "?new=WIR&newModule=inspections", { draft: id })).toBe(
      `/en/projects/p/work-items?new=WIR&newModule=inspections&draft=${id}`,
    );
  });

  it("opening the tab's own Module's panel (module null) drops it, and the other Module's Type with it", () => {
    expect(newSubmittalPanelHref("/en/projects/p/work-items", "?page=2&new=WIR&newModule=inspections&size=wide", { size: "wide", module: null })).toBe(
      "/en/projects/p/work-items?page=2&new=1&size=wide",
    );
    // Switching to another Module starts on its first Type too.
    expect(newSubmittalPanelHref("/en/projects/p/work-items", "?new=SAR", { module: "inspections" })).toBe("/en/projects/p/work-items?new=1&newModule=inspections");
    // The same Module, named again, keeps its Type.
    expect(newSubmittalPanelHref("/en/projects/p/work-items", "?new=WIR&newModule=inspections", { module: "inspections" })).toBe(
      "/en/projects/p/work-items?new=WIR&newModule=inspections",
    );
  });

  it("is dropped when an item opens", () => {
    expect(submittalPanelHref("/en/projects/p/work-items", "?new=WIR&newModule=inspections", id)).toBe(`/en/projects/p/work-items?open=${id}`);
  });

  it("reads the Module only with the panel open, and only a Module's key", () => {
    expect(newItemModuleFrom(new URLSearchParams("new=1&newModule=inspections"))).toBe("inspections");
    expect(newItemModuleFrom(new URLSearchParams("new=1"))).toBeNull();
    expect(newItemModuleFrom(new URLSearchParams("newModule=inspections"))).toBeNull();
    expect(newItemModuleFrom(new URLSearchParams("new=1&newModule=../me"))).toBeNull();
  });

  it("lands a direct link to the New Inspection on the tab the Project shows Inspections in, at Normal", () => {
    expect(newInspectionLanding("p1", { inSubmittals: false })).toBe("/projects/p1/inspections?new=1&size=normal");
    expect(newInspectionLanding("p1", { inSubmittals: false }, "WIR")).toBe("/projects/p1/inspections?new=WIR&size=normal");
    expect(newInspectionLanding("p1", { inSubmittals: true })).toBe("/projects/p1/work-items?new=1&size=normal&newModule=inspections");
  });
});
