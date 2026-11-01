import { describe, expect, it } from "vitest";
import { copyRowMenu, defaultRowActions, typeRowActions } from "./workflow-row-actions.ts";

describe("a Work Item Type row's actions on Settings › Workflows (RP-1178)", () => {
  const rabaedDefault = { source: "rabaed_default" as const, hasLibrary: false };

  it("gives a Project Admin one button, Duplicate and edit, and the rest in the row's menu", () => {
    expect(typeRowActions({ ...rabaedDefault, canEdit: true, isAuthorizedPerson: false })).toEqual({
      primary: "duplicate",
      menu: ["exception", "versions"],
    });
  });

  it("puts Save to my Company's Library in the menu, not beside the button, for the Authorized Person", () => {
    expect(typeRowActions({ ...rabaedDefault, canEdit: true, isAuthorizedPerson: true })).toEqual({
      primary: "duplicate",
      menu: ["exception", "versions", "saveToLibrary"],
    });
  });

  it("offers a Library Workflow first when the Library has one for the Type, and Back to the Rabaed Default last on a Project copy", () => {
    expect(typeRowActions({ source: "project_copy", hasLibrary: true, canEdit: true, isAuthorizedPerson: true })).toEqual({
      primary: "duplicate",
      menu: ["library", "exception", "versions", "saveToLibrary", "back"],
    });
  });

  it("gives an Authorized Person who is not a Project Admin only the menu, holding Save to my Company's Library", () => {
    expect(typeRowActions({ ...rabaedDefault, canEdit: false, isAuthorizedPerson: true })).toEqual({ primary: null, menu: ["saveToLibrary"] });
  });

  it("gives everyone else no actions", () => {
    expect(typeRowActions({ source: "project_copy", hasLibrary: true, canEdit: false, isAuthorizedPerson: false })).toEqual({ primary: null, menu: [] });
  });
});

describe("a Rabaed Default Workflow row's actions (RP-1178)", () => {
  it("has one button, Use for the Type, with Duplicate and edit and the Versions in the menu", () => {
    expect(defaultRowActions({ versionNo: 1, bound: false })).toEqual({ primary: "useFor", menu: ["duplicate", "versions"] });
  });

  it("has no button on the Workflow the Type already runs: the menu only", () => {
    expect(defaultRowActions({ versionNo: 2, bound: true })).toEqual({ primary: null, menu: ["duplicate", "versions"] });
  });

  it("offers neither Use for nor the Versions before a Version is published", () => {
    expect(defaultRowActions({ versionNo: null, bound: false })).toEqual({ primary: null, menu: ["duplicate"] });
  });
});

describe("a Project's own Workflow row's actions (RP-1178)", () => {
  it("keeps Use for the Type and the Versions in the menu, Edit (the owner's Open) being the button", () => {
    expect(copyRowMenu({ versionNo: 1, bound: false })).toEqual(["useFor", "versions"]);
  });

  it("drops Use for once the Type runs it, and both before a Version is published", () => {
    expect(copyRowMenu({ versionNo: 3, bound: true })).toEqual(["versions"]);
    expect(copyRowMenu({ versionNo: null, bound: false })).toEqual([]);
  });
});
