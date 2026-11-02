import { describe, expect, it } from "vitest";
import { newItemFrom, newItemLanding, newSubmittalPanelHref, openIdFrom, sizeFrom, submittalPanelHref } from "./submittal-panel-url.ts";

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
    expect(newItemFrom(new URLSearchParams("new=SAR"))).toEqual({ type: "SAR" });
    expect(newItemFrom(new URLSearchParams("new=1"))).toEqual({ type: null });
    expect(newItemFrom(new URLSearchParams("type=SAR"))).toBeNull();
    // A Type code is a short Document Number segment: anything else opens it on the first Type and asks the api nothing.
    expect(newItemFrom(new URLSearchParams("new=../me"))).toEqual({ type: null });
  });

  it("lands a direct link to the New page on the List with the panel at Normal (decision 1)", () => {
    expect(newItemLanding("p1")).toBe("/projects/p1/work-items?new=1&size=normal");
    expect(newItemLanding("p1", "SAR")).toBe("/projects/p1/work-items?new=SAR&size=normal");
  });
});
