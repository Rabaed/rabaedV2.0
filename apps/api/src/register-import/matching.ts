import type { Database } from "@rabaed/db";
import {
  answerFields,
  isBuiltInField,
  matchRegisterValue,
  registerFormFieldId,
  registerFormFieldKey,
  registerFormFieldTypes,
  registerMatchKey,
  splitRegisterValues,
  suggestRegisterValue,
  validateAnswers,
  type AnswerField,
  type BilingualText,
  type FormToFill,
  type OptionList,
  type OptionNode,
  type RegisterCandidate,
  type RegisterFieldId,
  type RegisterFieldTarget,
  type RegisterFormFieldType,
  type RegisterImportFields,
  type RegisterImportMapping,
  type RegisterImportPackage,
  type RegisterImportSavedMapping,
  type RegisterValues,
  type ScopeChoice,
  packageNumber,
  registerImportMapping,
  type ValidationContext,
} from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import { draftOf, formChoices, formToFillAt, newItemForm, optionListsFor, projectScopes, storedAnswers } from "../work-items/work-items.ts";
import type { SheetTable } from "./spreadsheet.ts";

// What a register's cells match on the Project (RP-639, spec RP-631 "Values"): the
// Submittals Types, the Project's Trades, Locations and Scopes, and the simple Form
// fields of the Types the Member may raise, each with its choices. Matching is
// `@rabaed/domain` register-import-match: by code or name in either language, ignoring
// case and spaces, or by the mapping's values matched by hand. The database checks every
// id it is handed again (app.preview_register_import), and the Form's own validator
// checks the answers, as for a Draft made by hand.

type Trx = Transaction<Database>;

/** A Form field a register can fill, with every Type whose Form has it. */
type FillableField = { field: AnswerField & { type: RegisterFormFieldType }; types: string[] };

/** One Type's Form, as a new Draft of it is filled at its Draft Step, with what its answers are checked against. */
type DraftForm = { form: FormToFill; editable: Set<string>; context: ValidationContext };

export type RegisterContext = {
  /** What the wizard shows (registerImportFields). */
  fields: RegisterImportFields;
  types: RegisterCandidate[];
  trades: RegisterCandidate[];
  locations: RegisterCandidate[];
  /** The Project's active Scopes. */
  scopes: (ScopeChoice & { name: BilingualText })[];
  /** Each Type the Member may raise, by code: its Form at the Draft. */
  forms: Map<string, DraftForm>;
  /** The Form fields a register can fill, by key. */
  fillable: Map<string, FillableField>;
  /** The Members and Participants a `member` or `participant` field may name, by email or name. */
  members: RegisterCandidate[];
  participants: RegisterCandidate[];
  optionLists: OptionList[];
  /** Whom rows may be assigned to (RP-640): the active Members of the Member's own Participant on the Project, by email. */
  assignees: RegisterCandidate[];
  /** The Packages of the Member's own Participant on the Project (RP-644), by number. */
  packages: RegisterImportPackage[];
};

const fillableTypes: readonly string[] = registerFormFieldTypes;
const isFillable = (field: AnswerField): field is AnswerField & { type: RegisterFormFieldType } =>
  fillableTypes.includes(field.type) && !isBuiltInField(field);

const named = (name: BilingualText) => [name.en, name.ar];

/** An Option List's choosable options down to `depth`, each with its path. */
function listOptions(list: OptionList | undefined, depth: number): { value: string; label: BilingualText }[] {
  const out: { value: string; label: BilingualText }[] = [];
  const walk = (nodes: OptionNode[], trail: OptionNode[]) => {
    for (const node of nodes) {
      if (node.retired) continue;
      const path = [...trail, node];
      out.push({ value: node.value, label: { en: path.map((n) => n.label.en).join(" / "), ar: path.map((n) => n.label.ar).join(" / ") } });
      if (path.length < depth) walk(node.options, path);
    }
  };
  walk(list?.options ?? [], []);
  return out;
}

/** A choice field's options as the wizard offers them: its own, or its Option List's by path. */
function optionsOf(field: AnswerField, lists: readonly OptionList[]): { value: string; label: BilingualText }[] {
  if (field.type === "select" || field.type === "multi_select") return field.options;
  if (field.type === "option_list") return listOptions(lists.find((l) => l.id === field.list), field.depth);
  return [];
}

/** The Project as the Member may import into it (one of their Projects, checked by the caller). */
export async function registerContext(trx: Trx, projectId: string): Promise<RegisterContext> {
  const { rows: types } = await sql<{ code: string; name: BilingualText; raisable: boolean }>`
    select t.code, t.name, t.id in (select r.work_item_type_id from app.register_import_raisable_types(${projectId}::uuid) r) as raisable
    from work_item_type t where t.owner_kind = 'rabaed' and t.module_key = 'submittals'
    order by t.code
  `.execute(trx);
  const { rows: values } = await sql<{ id: string; kind: string; parent_id: string | null; code: string; name: BilingualText }>`
    select v.id, d.kind, v.parent_id, v.code, v.name
    from dimension_value v join visibility_dimension d on d.id = v.dimension_id
    where d.project_id = ${projectId}::uuid and d.kind in ('trade', 'location')
    order by v.sort, v.code
  `.execute(trx);
  const { rows: scopes } = await sql<{ id: string; trade_value_id: string; parent_id: string | null; name: BilingualText }>`
    select id, trade_value_id, parent_id, name from scope where project_id = ${projectId}::uuid and status = 'active' order by depth, sort
  `.execute(trx);

  const byId = new Map(values.map((v) => [v.id, v]));
  const pathOf = (id: string, lang: "en" | "ar"): string => {
    const v = byId.get(id)!;
    return v.parent_id && byId.has(v.parent_id) ? `${pathOf(v.parent_id, lang)} / ${v.name[lang]}` : v.name[lang];
  };
  const trades = values.filter((v) => v.kind === "trade");
  const locations = values.filter((v) => v.kind === "location").map((v) => ({ ...v, path: { en: pathOf(v.id, "en"), ar: pathOf(v.id, "ar") } }));

  const raisable = types.filter((t) => t.raisable);
  const forms = new Map<string, DraftForm>();
  const fillable = new Map<string, FillableField>();
  const allScopes = await projectScopes(trx, projectId);
  const choices = await formChoices(trx, projectId, null);
  let optionLists: OptionList[] = [];
  for (const type of raisable) {
    const form = await newItemForm(trx, projectId, type.code);
    const draft = form && (await draftOf(trx, projectId, type.code));
    if (!form || !draft) continue;
    const toFill = formToFillAt(form, ...draft);
    const editable = new Set(toFill.editableSections);
    const lists = (await optionListsFor(trx, form.schema)) ?? [];
    if (lists.length > 0) optionLists = lists;
    forms.set(type.code, {
      form: toFill,
      editable,
      context: {
        scopes: allScopes,
        offered: { members: new Set(choices.members.map((m) => m.id)), participants: new Set(choices.participants.map((p) => p.id)) },
        ...(lists.length > 0 ? { optionLists: lists } : {}),
      },
    });
    for (const section of form.schema.sections.filter((s) => editable.has(s.key))) {
      for (const field of answerFields({ sections: [section] }).filter(isFillable)) {
        const known = fillable.get(field.key);
        if (!known) fillable.set(field.key, { field, types: [type.code] });
        else if (known.field.type === field.type) known.types.push(type.code);
      }
    }
  }

  const { rows: emails } = await sql<{ id: string; email: string }>`
    select id, email from member where id = any(${choices.members.map((m) => m.id)}::uuid[])
  `.execute(trx);
  const emailOf = new Map(emails.map((e) => [e.id, e.email]));

  // RP-640: whom rows may be assigned to. The preview checks each again.
  const { rows: assignees } = await sql<{ id: string; name: BilingualText; email: string }>`
    select m.id, m.full_name as name, m.email
    from project_member pm join member m on m.id = pm.member_id
    where pm.project_id = ${projectId}::uuid and pm.status = 'active' and m.status = 'active'
      and pm.participant_id in (select app.current_participant_ids())
    order by m.full_name ->> 'en', m.email
  `.execute(trx);

  // RP-644: the Member's own Participant's Packages and saved mappings, each said for the
  // acting Member by its function (Rabaed Admin reads past row-level security).
  const { rows: packages } = await sql<{ package_id: string; seq: number; name: BilingualText; status: RegisterImportPackage["status"] }>`
    select package_id, seq, name, status from app.register_import_packages(${projectId}::uuid)
  `.execute(trx);
  const ownPackages = packages.map((k) => ({ id: k.package_id, number: packageNumber(k.seq), name: k.name, status: k.status }));

  return {
    fields: {
      types: raisable.map((t) => ({ code: t.code, name: t.name })),
      trades: trades.map((t) => ({ id: t.id, code: t.code, name: t.name })),
      locations: locations.map((l) => ({ id: l.id, code: l.code, name: l.name, path: l.path })),
      scopes: scopes.map((s) => ({ id: s.id, tradeId: s.trade_value_id, parentId: s.parent_id, name: s.name })),
      formFields: [...fillable.values()].map(({ field, types: of }) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        types: of,
        options: optionsOf(field, optionLists),
      })),
      members: assignees,
      packages: ownPackages,
      mappings: await savedMappingsOf(trx, projectId),
    },
    types: types.map((t) => ({ id: t.code, names: [t.code, ...named(t.name)] })),
    trades: trades.map((t) => ({ id: t.id, names: [t.code, ...named(t.name)] })),
    locations: locations.map((l) => ({ id: l.id, names: [l.code, ...named(l.name), ...named(l.path)] })),
    scopes: scopes.map((s) => ({ id: s.id, tradeId: s.trade_value_id, parentId: s.parent_id, name: s.name })),
    forms,
    fillable,
    members: choices.members.map((m) => ({ id: m.id, names: [emailOf.get(m.id) ?? "", ...named(m.name)].filter((n) => n !== "") })),
    participants: choices.participants.map((p) => ({ id: p.id, names: named(p.name) })),
    optionLists,
    assignees: assignees.map((a) => ({ id: a.id, names: [a.email] })),
    packages: ownPackages,
  };
}

/**
 * The mappings saved for the Member's own Participant on the Project, by name (RP-644), said
 * for the acting Member by app.register_import_mappings. One saved before a field changed
 * shape is left out, never refused.
 */
export async function savedMappingsOf(trx: Trx, projectId: string): Promise<RegisterImportSavedMapping[]> {
  const { rows } = await sql<{ mapping_id: string; name: string; mapping: unknown }>`
    select mapping_id, name, mapping from app.register_import_mappings(${projectId}::uuid)
  `.execute(trx);
  return rows.flatMap((m) => {
    const parsed = registerImportMapping.safeParse(m.mapping);
    return parsed.success ? [{ id: m.mapping_id, name: m.name, mapping: parsed.data }] : [];
  });
}

/** The headings that name each field a column can fill, in English and Arabic: the Built-in ones first. */
const builtInTargets: RegisterFieldTarget<RegisterFieldId>[] = [
  { field: "subject", names: ["Subject", "Description", "Submittal", "Item", "الموضوع", "الوصف", "البند", "العنوان"] },
  { field: "type", names: ["Type", "Submittal type", "Work Item Type", "النوع", "نوع التقديم"] },
  // eslint-disable-next-line rabaed/no-avoid-terms -- a heading registers use for the Trade, matched to it, never shown
  { field: "trade", names: ["Trade", "Discipline", "التخصص", "الاختصاص"] },
  { field: "scopes", names: ["Scope", "Scopes", "Scope of work", "النطاق", "نطاق العمل"] },
  { field: "location", names: ["Location", "Zone", "Building", "Floor", "الموقع", "المكان"] },
  { field: "package", names: ["Package", "Packages", "Group", "Submittal package", "الحزمة", "حزمة", "المجموعة"] },
  { field: "paperRef", names: ["Paper ref", "Ref", "Reference", "Ref no", "Reference no", "Paper number", "المرجع", "رقم المرجع"] },
  { field: "assignTo", names: ["Assign to", "Assigned to", "Assignee", "Responsible", "Email", "مسند إلى", "المسؤول", "البريد الإلكتروني"] },
];

/** Every field a column can fill on the Project, with the headings that name it. */
export function fieldTargets(context: RegisterContext): RegisterFieldTarget<RegisterFieldId>[] {
  return [
    ...builtInTargets,
    ...[...context.fillable.values()].map(({ field }) => ({
      field: registerFormFieldId(field.key),
      names: [...named(field.label), field.key.replaceAll("_", " ")],
    })),
  ];
}

/** Each mapped column, as a row's cell. */
const cellOf = (values: readonly string[], column: { column: number } | undefined) => (column ? (values[column.column] ?? "") : "");

/** What one row of the register matched, as app.preview_register_import takes it. */
export type MappedRow = {
  row_no: number;
  cells: string[];
  subject: string;
  type: string;
  type_code: string | null;
  trade: string;
  trade_id: string | null;
  location: string;
  location_id: string | null;
  scopes: string;
  scope_ids: string[];
  scope_reason: "scope_unknown" | "scope_not_under_trade" | null;
  paper_ref: string;
  fields: Record<string, string>;
  invalid_fields: string[];
  form_version_id: string | null;
  answers: Record<string, unknown>;
  /** The "Assign to" cell as read ("" when the Member was picked, or none), and the Member it names or was picked (RP-640). */
  assignee: string;
  assignee_member_id: string | null;
  /**
   * Its Package (RP-644): the Package cell as read and trimmed, and either the existing
   * Package it goes to (matched by name, or chosen) or the name of a new one.
   */
  package: string;
  package_id: string | null;
  package_name: string | null;
};

/**
 * The Package a register's name matches (RP-644, story 29): one of the Member's own
 * Participant's, by its name in either language or its number, ignoring case and spaces;
 * an Open one first, then the earliest. Null when none.
 */
export function matchRegisterPackage(text: string, packages: readonly RegisterImportPackage[]): RegisterImportPackage | null {
  const key = registerMatchKey(text);
  if (key === "") return null;
  const named = packages.filter((k) => [k.name.en, k.name.ar, k.number].some((n) => registerMatchKey(n) === key));
  return named.find((k) => k.status === "open") ?? named[0] ?? null;
}

/**
 * Where each row of the register goes (RP-644): one Package for every row (`packages`), or
 * each row's Package column: the choice made by hand for its name (an existing Package, or
 * `new`), else the Package its name matches, else a new one named as the name first reads
 * in the register. The preview checks every Package again.
 */
function packagesOf(table: SheetTable, mapping: RegisterImportMapping, context: RegisterContext): (row: string[]) => Pick<MappedRow, "package" | "package_id" | "package_name"> {
  const none = { package: "", package_id: null, package_name: null };
  const whole = mapping.packages;
  if (whole) {
    return () => ("new" in whole ? { ...none, package_name: whole.new.trim() } : { ...none, package_id: whole.existing });
  }
  const column = mapping.package;
  if (!column) return () => none;
  const firstText = new Map<string, string>();
  for (const row of table.rows) {
    const text = (row.values[column.column] ?? "").trim();
    const key = registerMatchKey(text);
    if (key !== "" && !firstText.has(key)) firstText.set(key, text);
  }
  const byHand = mapping.values?.package ?? {};
  return (values) => {
    const text = (values[column.column] ?? "").trim();
    const key = registerMatchKey(text);
    if (key === "") return none;
    const chosen = byHand[key];
    const id = chosen === "new" ? null : (chosen ?? matchRegisterPackage(text, context.packages)?.id ?? null);
    return id ? { package: text, package_id: id, package_name: null } : { package: text, package_id: null, package_name: firstText.get(key)! };
  };
}

/**
 * A Scopes cell's Scopes under the row's Trade, each by name (or by the match made by
 * hand), a Sub-scope with its Scope; and the one reason it is bad: a name that is no
 * Scope of the Project (or two under its Trade), or a Scope under another Trade.
 */
function matchScopes(
  text: string,
  tradeId: string | null,
  context: RegisterContext,
  manual: Readonly<Record<string, string>>,
): { ids: string[]; reason: MappedRow["scope_reason"] } {
  const ids: string[] = [];
  let unknown = false;
  let elsewhere = false;
  for (const piece of splitRegisterValues(text)) {
    const key = registerMatchKey(piece);
    const byHand = manual[key];
    const byName = context.scopes.filter((s) => (byHand !== undefined ? s.id === byHand : scopeNamed(s.name, key)));
    const under = byName.filter((s) => s.tradeId === tradeId);
    if (under.length === 1) {
      const scope = under[0]!;
      // A Sub-scope comes with its Scope.
      if (scope.parentId && !ids.includes(scope.parentId)) ids.push(scope.parentId);
      if (!ids.includes(scope.id)) ids.push(scope.id);
    } else if (under.length > 1 || byName.length === 0) {
      unknown = true;
    } else if (tradeId !== null) {
      // The Trade's own reason says enough when the row has none.
      elsewhere = true;
    }
  }
  return { ids, reason: unknown ? "scope_unknown" : elsewhere ? "scope_not_under_trade" : null };
}

/** Whether a Scope's name, in either language, is `key`. */
const scopeNamed = (name: BilingualText, key: string) => registerMatchKey(name.en) === key || registerMatchKey(name.ar) === key;

/** The candidates a choice, Member or Participant field's cell may name. */
function fieldCandidates(field: AnswerField, context: RegisterContext): RegisterCandidate[] {
  if (field.type === "member") return context.members;
  if (field.type === "participant") return context.participants;
  return optionsOf(field, context.optionLists).map((o) => ({ id: o.value, names: [o.value, ...named(o.label)] }));
}

/** A Form field's cell as the field's answer: undefined when empty, null when it can't be one. */
function answerOf(field: AnswerField, text: string, context: RegisterContext, manual: Readonly<Record<string, string>>): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  switch (field.type) {
    case "number":
      // As stored in the register (RP-631, cells read as stored): "1200", never "1,200".
      return /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(trimmed) ? Number(trimmed) : null;
    case "date":
      // A date cell reads as yyyy-mm-dd (with its time when it has one); text in any other shape doesn't fit.
      return /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(trimmed) ? trimmed.slice(0, 10) : null;
    case "select":
    case "member":
    case "participant":
      return matchRegisterValue(trimmed, fieldCandidates(field, context), manual);
    case "multi_select":
    case "option_list": {
      if (field.type === "option_list" && !field.multiple) return matchRegisterValue(trimmed, fieldCandidates(field, context), manual);
      const chosen = splitRegisterValues(trimmed).map((piece) => matchRegisterValue(piece, fieldCandidates(field, context), manual));
      return chosen.includes(null) ? null : [...new Set(chosen)];
    }
    default:
      // Text as written.
      return text;
  }
}

/** Every row of the sheet as app.preview_register_import takes it: each mapped cell, what it matched, and the checked answers. */
export function mappedRows(table: SheetTable, mapping: RegisterImportMapping, context: RegisterContext): MappedRow[] {
  const manual = mapping.values ?? {};
  const assign = mapping.assign ?? {};
  const packageOf = packagesOf(table, mapping, context);
  return table.rows.map((row) => {
    const cell = (column: { column: number } | undefined) => cellOf(row.values, column);
    const typeText = "column" in mapping.type ? cell(mapping.type) : "";
    const typeCode = "column" in mapping.type ? matchRegisterValue(typeText, context.types, manual.type) : mapping.type.value;
    const tradeText = "column" in mapping.trade ? cell(mapping.trade) : "";
    const tradeId = "column" in mapping.trade ? matchRegisterValue(tradeText, context.trades, manual.trade) : mapping.trade.value;
    const locationText = cell(mapping.location);
    const locationId = matchRegisterValue(locationText, context.locations, manual.location);
    const scopesText = cell(mapping.scopes);
    const scopes = matchScopes(scopesText, tradeId, context, manual.scopes ?? {});

    // The Form fields of the row's Type, each checked by the Form's own validator.
    const draft = typeCode ? context.forms.get(typeCode) : undefined;
    const fields: Record<string, string> = {};
    const given: Record<string, unknown> = {};
    const invalid = new Set<string>();
    for (const mapped of mapping.fields ?? []) {
      const field = draft && answerFields(draft.form.schema).find((f) => f.key === mapped.key);
      const fillable = context.fillable.get(mapped.key);
      if (!draft || !field || !fillable || field.type !== fillable.field.type) continue;
      fields[mapped.key] = cell(mapped);
      const value = answerOf(field, cell(mapped), context, manual.fields?.[mapped.key] ?? {});
      if (value === null) invalid.add(mapped.key);
      else if (value !== undefined) given[mapped.key] = value;
    }
    let answers: Record<string, unknown> = {};
    if (draft && Object.keys(given).length > 0) {
      const builtIns = { ...(tradeId ? { trade: tradeId } : {}), ...(locationId ? { location: locationId } : {}), scopes: scopes.ids };
      const checked = validateAnswers(draft.form.schema, { ...builtIns, ...given }, "draft", draft.context);
      if (checked.ok) answers = JSON.parse(storedAnswers(checked.answers).data) as Record<string, unknown>;
      else for (const error of checked.errors) if (error.key in given) invalid.add(error.key);
    }

    // Who raises it (RP-640): the email in the "Assign to" column (ignoring case), else the
    // first rule naming its Trade or Type, else the default, else the importer (null).
    const email = cell(mapping.assignTo).trim();
    const rule = (assign.rules ?? []).find((r) => (r.by === "trade" ? r.value === tradeId : r.value === typeCode));
    const assigneeId = email !== "" ? matchRegisterValue(email, context.assignees) : (rule?.member ?? assign.default ?? null);
    return {
      row_no: row.rowNo,
      cells: row.values,
      subject: cell(mapping.subject),
      type: typeText,
      type_code: typeCode,
      trade: tradeText,
      trade_id: tradeId,
      location: locationText,
      location_id: locationId,
      scopes: scopesText,
      scope_ids: scopes.ids,
      scope_reason: scopes.reason,
      paper_ref: cell(mapping.paperRef).trim(),
      fields,
      invalid_fields: (mapping.fields ?? []).map((f) => f.key).filter((key) => invalid.has(key)),
      form_version_id: draft && Object.keys(answers).length > 0 ? draft.form.id : null,
      answers: invalid.size > 0 ? {} : answers,
      assignee: email,
      assignee_member_id: assigneeId,
      ...packageOf(row.values),
    };
  });
}

/** The candidates of a value field (registerValueFields, or a choice field's `field:<key>`). */
function valueCandidates(field: string, context: RegisterContext): RegisterCandidate[] {
  if (field === "type") return context.types;
  if (field === "trade") return context.trades;
  if (field === "location") return context.locations;
  if (field === "scopes") return context.scopes.map((s) => ({ id: s.id, names: named(s.name) }));
  if (field === "assignTo") return context.assignees;
  const key = registerFormFieldKey(field);
  const fillable = key === null ? undefined : context.fillable.get(key);
  return fillable ? fieldCandidates(fillable.field, context) : [];
}

/**
 * Map values (story 10): each mapped column of a value field, every different value in
 * it once (a Scopes cell's each Scope), with how many rows hold it and what it matches.
 */
export function registerValues(table: SheetTable, mapping: RegisterImportMapping, context: RegisterContext): RegisterValues {
  const manual = mapping.values ?? {};
  const columns: { field: string; column: number; manual: Readonly<Record<string, string>>; split: boolean; suggest?: false }[] = [];
  if ("column" in mapping.type) columns.push({ field: "type", column: mapping.type.column, manual: manual.type ?? {}, split: false });
  if ("column" in mapping.trade) columns.push({ field: "trade", column: mapping.trade.column, manual: manual.trade ?? {}, split: false });
  if (mapping.location) columns.push({ field: "location", column: mapping.location.column, manual: manual.location ?? {}, split: false });
  if (mapping.scopes) columns.push({ field: "scopes", column: mapping.scopes.column, manual: manual.scopes ?? {}, split: true });
  // The "Assign to" column's emails (RP-640): each matched to a Member exactly, never suggested.
  if (mapping.assignTo) columns.push({ field: "assignTo", column: mapping.assignTo.column, manual: {}, split: false, suggest: false });
  for (const mapped of mapping.fields ?? []) {
    const type = context.fillable.get(mapped.key)?.field.type;
    if (type === "select" || type === "multi_select" || type === "option_list") {
      columns.push({ field: registerFormFieldId(mapped.key), column: mapped.column, manual: manual.fields?.[mapped.key] ?? {}, split: type !== "select" });
    }
  }
  return {
    fields: [
      ...columns.map(({ field, column, manual: byHand, split, suggest }) => {
        const candidates = valueCandidates(field, context);
        return {
          field,
          column,
          values: distinctValues(table, column, split).map(({ key, text, rows }) => {
            const manualMatch = byHand[key] !== undefined ? matchRegisterValue(text, candidates, byHand) : null;
            const exact = manualMatch ?? matchRegisterValue(text, candidates);
            const suggested = exact === null && suggest !== false ? suggestRegisterValue(text, candidates) : null;
            return {
              key,
              text,
              rows,
              match: exact ?? suggested?.id ?? null,
              how: manualMatch !== null ? ("manual" as const) : exact !== null ? ("exact" as const) : suggested ? ("suggested" as const) : null,
              score: suggested?.score ?? null,
            };
          }),
        };
      }),
      // The Package column (RP-644): each name, and the Package it goes to: the one chosen by
      // hand (`new` for a new one), else the Participant's own it matches (never a suggestion),
      // else none: a new one.
      ...(mapping.package && !mapping.packages
        ? [
            {
              field: "package",
              column: mapping.package.column,
              values: distinctValues(table, mapping.package.column, false).map(({ key, text, rows }) => {
                const chosen = manual.package?.[key];
                const matched = chosen === undefined ? (matchRegisterPackage(text, context.packages)?.id ?? null) : null;
                return { key, text, rows, match: chosen ?? matched, how: chosen !== undefined ? ("manual" as const) : matched ? ("exact" as const) : null, score: null };
              }),
            },
          ]
        : []),
    ],
  };
}

/** Every different value of a column once (each of a Scopes cell's, with `split`) by registerMatchKey, as it first reads, with how many rows hold it. */
function distinctValues(table: SheetTable, column: number, split: boolean): { key: string; text: string; rows: number }[] {
  const seen = new Map<string, { text: string; rows: number }>();
  for (const row of table.rows) {
    const text = (row.values[column] ?? "").trim();
    const pieces = split ? splitRegisterValues(text) : text === "" ? [] : [text];
    for (const piece of new Set(pieces.map((p) => registerMatchKey(p)))) {
      const first = pieces.find((p) => registerMatchKey(p) === piece)!;
      const known = seen.get(piece);
      seen.set(piece, { text: known?.text ?? first, rows: (known?.rows ?? 0) + 1 });
    }
  }
  return [...seen.entries()].map(([key, { text, rows }]) => ({ key, text, rows }));
}
