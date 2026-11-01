// Settings › Workflows rows (RP-1178): one button per row and the rest in the row's "⋯" menu,
// as the owner's page shows (`Rabaed Settings Workflows.html` › `.wrow`: one `.cb.sm` button,
// then the `.cb.sm.ter.ic` menu), so every action stays inside its card at 1366.

export type TypeRowAction = "duplicate" | "library" | "exception" | "versions" | "saveToLibrary" | "back";

/**
 * A Work Item Type row: a Project Admin's button is Duplicate and edit; using a Library Workflow,
 * an exception, the Versions, Save to my Company's Library (the Authorized Person's only, RP-442)
 * and Back to the Rabaed Default (a Project copy's only) are in the menu, in that order.
 */
export function typeRowActions(row: {
  source: "rabaed_default" | "project_copy";
  /** The Company's Library has a Workflow for the Type. */
  hasLibrary: boolean;
  canEdit: boolean;
  isAuthorizedPerson: boolean;
}): { primary: "duplicate" | null; menu: TypeRowAction[] } {
  const menu: TypeRowAction[] = [];
  if (row.canEdit) {
    if (row.hasLibrary) menu.push("library");
    menu.push("exception", "versions");
  }
  if (row.isAuthorizedPerson) menu.push("saveToLibrary");
  if (row.canEdit && row.source === "project_copy") menu.push("back");
  return { primary: row.canEdit ? "duplicate" : null, menu };
}

/** A published Version's number, or null; whether the Type already runs this Workflow. */
type WorkflowRow = { versionNo: number | null; bound: boolean };

/** A Rabaed Default (a Project Admin's): Use for the Type is the button while it can be used; Duplicate and edit and the Versions are in the menu. */
export function defaultRowActions(row: WorkflowRow): { primary: "useFor" | null; menu: ("duplicate" | "versions")[] } {
  const published = row.versionNo !== null;
  return { primary: published && !row.bound ? "useFor" : null, menu: published ? ["duplicate", "versions"] : ["duplicate"] };
}

/** A Project's own Workflow: Edit is the button (the owner's "Open"); Use for the Type and the Versions are in the menu. */
export function copyRowActions(row: WorkflowRow): { primary: "edit"; menu: ("useFor" | "versions")[] } {
  if (row.versionNo === null) return { primary: "edit", menu: [] };
  return { primary: "edit", menu: row.bound ? ["versions"] : ["useFor", "versions"] };
}
