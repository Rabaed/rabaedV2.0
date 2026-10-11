import type { StageCategory } from "./chain-bucket.ts";
import type { BilingualText } from "./company.ts";
import type { ModuleKey } from "./module.ts";
import type { WorkflowDefinition } from "./workflow-definition.ts";
import type { PositionOption } from "./workflow-rules-edit.ts";

// Project → Settings → Workflows (RP-441, WF-18; spec RP-423, RP-511; ADR 0016, 0019).
// What the page reads: for each Work Item Type of the Project, the Workflow its new
// items run and its exceptions, and the Workflows an admin may bind or copy. Every
// Project Member reads the Project's Workflows and which one each Type runs (V20); an
// exception only its Participant's Members and the Project Admins (V15).

/** A Workflow as the settings list shows it: its name and its latest published Version (null before its first). */
export type WorkflowSettingsWorkflow = { id: string; name: BilingualText; versionNo: number | null };

/** One Work Item Type of the Project and the Workflow its new items run. */
export type WorkflowSettingsType = {
  id: string;
  code: string;
  name: BilingualText;
  moduleKey: ModuleKey;
  /** The Workflow new items run for every raiser without an exception. */
  workflow: WorkflowSettingsWorkflow & {
    /** "Rabaed Default" while the Project binds none of its own, else "Project copy". */
    source: "rabaed_default" | "project_copy";
  };
  /** Exceptions for one raising Participant, as the viewer may read them (V15); the Participant's name as a Project Admin or that Participant's Member reads it. */
  exceptions: { participantId: string; companyName: BilingualText; workflow: WorkflowSettingsWorkflow }[];
  /** For Project Admins: the Project's own Workflows made for the Type, published or not, which they may bind or keep editing. */
  copies: (WorkflowSettingsWorkflow & { bound: boolean; hasDraft: boolean })[];
};

/** The page's read. `canEdit` is for Project Admins, who also get `library`. */
export type WorkflowSettings = {
  canEdit: boolean;
  types: WorkflowSettingsType[];
  /** For Project Admins: published Workflows in their own Company's Library, per Type, to copy into the Project. */
  library: (WorkflowSettingsWorkflow & { workItemTypeId: string })[];
};

/** A published Workflow Version read whole, for the read-only canvas of "View versions". */
export type WorkflowVersionRead = {
  name: BilingualText;
  versionNo: number;
  publishedVersions: number[];
  /**
   * Every published Version, newest first, as the Versions history lists it (RP-555): when it
   * was published, its change note (null for one published before Change Notes), and how many items
   * the reader sees still run on it (scenario RP-555-1).
   */
  history: { versionNo: number; publishedAt: string; changeNote: string | null; running: number }[];
  definition: WorkflowDefinition;
  stages: { key: string; name: BilingualText; category: StageCategory }[];
  positions: PositionOption[];
};

/** Which published Workflow Versions pin which Screen Version, for a Project's Screens (ADR 0019). */
export type ScreenPins = {
  pins: {
    screenId: string;
    screenKey: string;
    screenVersionNo: number;
    workflowId: string;
    workflowName: BilingualText;
    workflowVersionNo: number;
  }[];
};
