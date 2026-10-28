import { describe, expect, it } from "vitest";
import { openIdFrom, submittalPanelHref } from "./submittal-panel-url.ts";

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

  it("reads only an id that can be an item's (a uuid), so an edited link asks the api nothing odd", () => {
    expect(openIdFrom(new URLSearchParams(`open=${id}`))).toBe(id);
    expect(openIdFrom(new URLSearchParams("open=../members"))).toBeNull();
    expect(openIdFrom(new URLSearchParams(""))).toBeNull();
  });
});
