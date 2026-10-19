import { z } from "zod";
import { bilingualText, engineerReason } from "./company.ts";
import { formKey } from "./form.ts";
import { workItemTypeCode } from "./work-item.ts";

/**
 * The Submittal Register Import (RP-637, spec RP-631): a Member uploads their
 * Company's register (.xlsx or .csv), picks the sheet and its header row, maps the
 * columns to Subject, Type and Trade, previews every row with every reason a bad one
 * is bad, and confirms: a Draft for every good row, none for the bad. Only Members of
 * the importing Participant read an import (visibility.md RP-589-1).
 */

/** The largest register read (the api's spreadsheet reader refuses a larger one): 10 MB. */
export const registerImportMaxBytes = 10 * 1024 * 1024;

/** An uploaded register: its name (whose extension says how to read it) and its bytes, base64. */
export const registerImportFile = z.object({
  fileName: z.string().trim().min(1).max(255),
  // 10 MB as base64, with room for the padding.
  content: z.base64().max(Math.ceil(registerImportMaxBytes / 3) * 4 + 4),
});
export type RegisterImportFile = z.infer<typeof registerImportFile>;

/** Read a register: its sheets, and one sheet from one header row (the first sheet, row 1, when left out). */
export const readRegisterRequest = z.object({
  file: registerImportFile,
  sheet: z.string().optional(),
  headerRow: z.int().min(1).optional(),
});
export type ReadRegisterRequest = z.infer<typeof readRegisterRequest>;

/** A row of a sheet as read: its number in the sheet, and every cell as text, as stored in the file. */
export const registerSheetRow = z.object({ rowNo: z.int().min(1), cells: z.array(z.string()) });
export type RegisterSheetRow = z.infer<typeof registerSheetRow>;

/** How many top rows of a sheet the header-row step shows. */
export const registerTopRows = 12;

/** A register as read, for the sheet and header-row step and the mapping step. */
export const registerSheet = z.object({
  /** Every sheet, with how many non-empty rows it has (a .csv has one, named after the file). */
  sheets: z.array(z.object({ name: z.string(), rows: z.int().min(0) })),
  sheet: z.string(),
  headerRow: z.int().min(1),
  /** The sheet's first rows, empty ones too, to pick the header row from. */
  top: z.array(registerSheetRow),
  /** The header row's cells: the columns to map. */
  headers: z.array(z.string()),
  /** The first data row's cell under each header ("" when none): the mapping step's examples. */
  examples: z.array(z.string()),
  /** How many non-empty rows lie below the header row. */
  dataRows: z.int().min(0),
  /**
   * A field suggested for each column from its heading, in English or Arabic, with how
   * alike they are (0–100): a RegisterFieldId; null where nothing is (RP-639, story 8).
   */
  suggestions: z.array(z.object({ field: z.string(), score: z.int().min(0).max(100) }).nullable()),
});
export type RegisterSheet = z.infer<typeof registerSheet>;

/** A column of the header row, from 0. */
const column = z.object({ column: z.int().min(0) });

/** The longest Paper ref: the old paper number of a submittal still under review on paper (story 27). */
export const paperRefMaxLength = 100;

/**
 * The fields a column can fill (the Map fields step's choices, and the suggestions):
 * these, and `field:<key>` for a Form field of a mapped Type (registerFormFieldId).
 */
export const registerFieldIds = ["subject", "type", "trade", "scopes", "location", "paperRef", "assignTo"] as const;
export type RegisterFieldId = (typeof registerFieldIds)[number] | `field:${string}`;
/** A Form field's id among the fields a column can fill. */
export const registerFormFieldId = (key: string): RegisterFieldId => `field:${key}`;

/**
 * The Form field types a register fills (spec RP-631, "Values"): plain text, numbers,
 * dates, choices, and a Member or Participant named unambiguously. Every other field
 * is left for the raiser.
 */
export const registerFormFieldTypes = ["text", "textarea", "number", "date", "select", "multi_select", "option_list", "member", "participant"] as const;
export type RegisterFormFieldType = (typeof registerFormFieldTypes)[number];

/** Values matched by hand once, by the cell's registerMatchKey, applying to every row with it (story 10). */
const matchesOf = <T extends z.ZodType<string>>(value: T) =>
  z.record(z.string().max(500), value).refine((matches) => Object.keys(matches).length <= 2000, "At most 2,000 matches");

/**
 * Who raises a row's Draft (RP-640, story 24), besides its email in the "Assign to"
 * column: the first rule naming the row's Trade (an id) or Type (a code), else the
 * default; each a Member of the importer's own Participant on the Project (their id).
 * Neither: the importer.
 */
export const registerImportAssign = z.object({
  default: z.uuid().optional(),
  rules: z
    .array(z.object({ by: z.enum(["trade", "type"]), value: z.string().min(1).max(64), member: z.uuid() }))
    .max(200)
    .optional(),
});
export type RegisterImportAssign = z.infer<typeof registerImportAssign>;

/**
 * Which column gives each field: the Subject from a column, the Type and the Trade
 * each from a column or one value for every row (a Type code; a Trade's id), and the
 * optional Scopes, Location, Paper ref, "Assign to" (each row's assignee by email) and
 * Form fields (a Form field's `label` is filled in by the preview, as the Form names
 * it). `values` holds the values matched by hand: a Type code, an id, or an option's
 * value. `assign` picks the assignee of the rows the "Assign to" column leaves empty
 * (RP-640). Columns not mapped are ignored.
 */
export const registerImportMapping = z.object({
  subject: column,
  type: z.union([column, z.object({ value: workItemTypeCode })]),
  trade: z.union([column, z.object({ value: z.uuid() })]),
  scopes: column.optional(),
  location: column.optional(),
  paperRef: column.optional(),
  assignTo: column.optional(),
  fields: z
    .array(column.extend({ key: formKey, label: bilingualText.optional() }))
    .max(100)
    .refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, "Each Form field once")
    .optional(),
  values: z
    .object({
      type: matchesOf(workItemTypeCode),
      trade: matchesOf(z.uuid()),
      location: matchesOf(z.uuid()),
      scopes: matchesOf(z.uuid()),
      fields: z.record(formKey, matchesOf(z.string().max(64))),
    })
    .partial()
    .optional(),
  assign: registerImportAssign.optional(),
});
export type RegisterImportMapping = z.infer<typeof registerImportMapping>;

/** Preview a register: read the sheet from the header row, apply the mapping and check every row. Nothing is created. */
export const previewRegisterImportRequest = z.object({
  file: registerImportFile,
  sheet: z.string(),
  headerRow: z.int().min(1),
  mapping: registerImportMapping,
});
export type PreviewRegisterImportRequest = z.infer<typeof previewRegisterImportRequest>;

/**
 * Every reason a row is bad, in this order. A row has all of its reasons, not only
 * the first. The database checks the same list (submittal_register_import_row).
 */
export const registerImportRowReasons = [
  "subject_missing",
  "subject_too_long",
  "type_missing",
  "type_unknown",
  "type_not_allowed",
  "trade_missing",
  "trade_unknown",
  "trade_outside_visibility",
  "scope_unknown",
  "scope_not_under_trade",
  "location_unknown",
  "location_outside_visibility",
  "field_invalid",
  "paper_ref_too_long",
  "paper_ref_repeated",
  "paper_ref_taken",
  "assignee_unknown",
  "assignee_cannot_create",
  "assignee_outside_visibility",
] as const;
export const registerImportRowReason = z.enum(registerImportRowReasons);
export type RegisterImportRowReason = z.infer<typeof registerImportRowReason>;

/** One row of an import: as read, what it matched, why it is bad, and the Draft it created. */
export const registerImportRow = z.object({
  rowNo: z.int().min(1),
  /** Every cell of the row, one per header, as read. */
  cells: z.array(z.string()),
  /** The mapped values as read ("" for an empty cell); a fixed Type or Trade as its code. */
  subject: z.string(),
  type: z.object({ text: z.string(), match: z.object({ code: workItemTypeCode, name: bilingualText }).nullable() }),
  trade: z.object({ text: z.string(), match: z.object({ id: z.uuid(), code: z.string(), name: bilingualText }).nullable() }),
  /** The Location cell as read ("" when not mapped) and the Location it matched. */
  location: z.object({ text: z.string(), match: z.object({ id: z.uuid(), code: z.string(), name: bilingualText }).nullable() }),
  /** The Scopes cell as read ("" when not mapped) and the Scopes and Sub-scopes it matched. */
  scopes: z.object({ text: z.string(), matches: z.array(z.object({ id: z.uuid(), name: bilingualText })) }),
  /** The Paper ref as read, trimmed ("" when none). */
  paperRef: z.string(),
  /** The mapped Form fields of the row's Type, each cell as read, and whether its value doesn't fit the field. */
  fields: z.array(z.object({ key: formKey, text: z.string(), invalid: z.boolean() })),
  /**
   * Who raises its Draft (RP-640): the "Assign to" cell as read ("" when the Member was
   * picked, or none), and the Member of the importer's own Company it is assigned to;
   * null for the importer, or when the cell names nobody who may take it.
   */
  assignee: z.object({ text: z.string(), match: z.object({ id: z.uuid(), name: bilingualText }).nullable() }),
  /** Empty for a good row. */
  reasons: z.array(registerImportRowReason),
  /** Whether confirm created a Draft from it. */
  created: z.boolean(),
  /** That Draft, only when the caller sees it (not after it was Deleted, nor outside their Visibility). */
  workItemId: z.uuid().nullable(),
});
export type RegisterImportRow = z.infer<typeof registerImportRow>;

/** An import, as the Imports page lists it. No time: when it was confirmed is when its Drafts were started (scenario 61). */
export const registerImportSummary = z.object({
  id: z.uuid(),
  fileName: z.string(),
  status: z.enum(["previewed", "created"]),
  /**
   * Who imported it: a Member of the caller's own Company; null when a Rabaed Engineer
   * imported it for the Company in Rabaed Admin (RP-645), which the Company reads as
   * "Rabaed", never the Engineer's name.
   */
  runBy: z.object({ id: z.uuid(), name: bilingualText }).nullable(),
  rowsTotal: z.int().min(0),
  rowsRejected: z.int().min(0),
  /** Null until confirmed. */
  rowsCreated: z.int().min(0).nullable(),
});
export type RegisterImportSummary = z.infer<typeof registerImportSummary>;

export const registerImports = z.object({ imports: z.array(registerImportSummary) });
export type RegisterImports = z.infer<typeof registerImports>;

/** One import with its rows: the preview before confirm, the record after. */
export const registerImport = registerImportSummary.extend({
  projectId: z.uuid(),
  /**
   * Who raises every row nobody else is assigned (RP-640, RP-645): the importing Member,
   * or for a Rabaed Engineer's import the default Member of the Company they chose.
   */
  defaultRaiser: z.object({ id: z.uuid(), name: bilingualText }),
  sheet: z.string(),
  headerRow: z.int().min(1),
  headers: z.array(z.string()),
  mapping: registerImportMapping,
  rows: z.array(registerImportRow),
});
export type RegisterImport = z.infer<typeof registerImport>;

/**
 * What a register may fill on the Project, for the Map fields and Map values steps: the
 * Submittals Types the Member may raise, the Project's Trades, Locations (with their
 * path) and active Scopes, and the simple Form fields of those Types' Forms, editable
 * at the Draft, with their choices (registerFormFieldTypes). Matching takes any of the
 * Project's values; the preview then refuses one outside the Member's Visibility.
 */
export const registerImportFields = z.object({
  types: z.array(z.object({ code: workItemTypeCode, name: bilingualText })),
  trades: z.array(z.object({ id: z.uuid(), code: z.string(), name: bilingualText })),
  locations: z.array(z.object({ id: z.uuid(), code: z.string(), name: bilingualText, path: bilingualText })),
  scopes: z.array(z.object({ id: z.uuid(), tradeId: z.uuid(), parentId: z.uuid().nullable(), name: bilingualText })),
  formFields: z.array(
    z.object({
      key: formKey,
      label: bilingualText,
      type: z.enum(registerFormFieldTypes),
      /** The Types whose Form has it. */
      types: z.array(workItemTypeCode),
      /** A choice field's options (an Option List's by their path); empty for any other. */
      options: z.array(z.object({ value: z.string(), label: bilingualText })),
    }),
  ),
  /** The active Members of the Member's own Participant on the Project: whom rows may be assigned to (RP-640). */
  members: z.array(z.object({ id: z.uuid(), name: bilingualText, email: z.string() })),
});
export type RegisterImportFields = z.infer<typeof registerImportFields>;

/** The fields whose values Map values matches: these, and `field:<key>` for a choice field. */
export const registerValueFields = ["type", "trade", "location", "scopes"] as const;

/**
 * Each mapped column whose values are matched (Type, Trade, Location, Scopes, choice
 * fields): every different value in it, once by registerMatchKey, with how many rows
 * hold it, and what it matches: `exact` by code or name, `manual` by the mapping's
 * `values`, or `suggested` (the most alike value, with its score, which the importer
 * confirms); null when nothing. The "Assign to" column (`assignTo`, RP-640) too: each
 * email and the Member it names exactly (never suggested), for the Assign step's counts.
 */
export const registerValues = z.object({
  fields: z.array(
    z.object({
      field: z.string(),
      column: z.int().min(0),
      values: z.array(
        z.object({
          key: z.string(),
          text: z.string(),
          rows: z.int().min(1),
          match: z.string().nullable(),
          how: z.enum(["exact", "manual", "suggested"]).nullable(),
          score: z.int().min(0).max(100).nullable(),
        }),
      ),
    }),
  ),
});
export type RegisterValues = z.infer<typeof registerValues>;

export const confirmedRegisterImport = z.object({ rowsCreated: z.int().min(0) });
export type ConfirmedRegisterImport = z.infer<typeof confirmedRegisterImport>;

/*
 * Rabaed Admin (RP-645, stories 38–41): a Rabaed Engineer runs the same import for a
 * Participant, with a default Member of it who raises every row nobody else is assigned
 * (the importer's place), and a reason. Every call carries the reason: each is an
 * admin_action (V9). The Company reads the import as "Rabaed"'s.
 */

/** Whom an Engineer imports for, and why. */
export const adminRegisterImportFor = z.object({
  projectId: z.uuid(),
  participantId: z.uuid(),
  /** The Member of the Participant who raises every row nobody else is assigned. */
  defaultMemberId: z.uuid(),
  reason: engineerReason,
});
export type AdminRegisterImportFor = z.infer<typeof adminRegisterImportFor>;

export const adminReadRegisterRequest = readRegisterRequest.extend({ for: adminRegisterImportFor });
export type AdminReadRegisterRequest = z.infer<typeof adminReadRegisterRequest>;
export const adminRegisterImportFieldsRequest = z.object({ for: adminRegisterImportFor });
export type AdminRegisterImportFieldsRequest = z.infer<typeof adminRegisterImportFieldsRequest>;
export const adminPreviewRegisterImportRequest = previewRegisterImportRequest.extend({ for: adminRegisterImportFor });
export type AdminPreviewRegisterImportRequest = z.infer<typeof adminPreviewRegisterImportRequest>;
/** Reading or confirming an Engineer's own preview: only the reason (its Participant and default Member are the preview's). */
export const adminRegisterImportReason = z.object({ reason: engineerReason });

/** The Projects an Engineer may import for, by name. */
export const adminRegisterImportProjects = z.object({
  projects: z.array(z.object({ id: z.uuid(), name: bilingualText, code: z.string() })),
});
export type AdminRegisterImportProjects = z.infer<typeof adminRegisterImportProjects>;

/**
 * A Project's active Participants, each with its active Members, and whether each may
 * import there (a Submittals Type they may raise): a Participant none of whose Members may
 * (a Consultant, the Client) raises no submittals.
 */
export const adminRegisterImportParticipants = z.object({
  participants: z.array(
    z.object({
      id: z.uuid(),
      companyName: bilingualText,
      roleName: bilingualText,
      mayImport: z.boolean(),
      members: z.array(z.object({ id: z.uuid(), name: bilingualText, email: z.string(), mayImport: z.boolean() })),
    }),
  ),
});
export type AdminRegisterImportParticipants = z.infer<typeof adminRegisterImportParticipants>;
