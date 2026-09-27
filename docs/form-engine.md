# Form engine design

How Forms are defined, filled, validated, versioned and printed. Terms follow [CONTEXT.md](../CONTEXT.md). Storage follows [ADR 0006](adr/0006-form-data-as-jsonb-against-versioned-schemas.md): answers are one JSONB document per Work Item, validated against the pinned, immutable `form_version.schema`.

One engine serves:
- every **Work Item Form**: submittals, Inspections, Snags, Site Reports, Packages;
- every **Action Form**: the pop-up on a Workflow Transition;
- **Checklist templates** in the library.

---

## 1. Schema shape

```json
{
  "sections": [
    {
      "key": "material",
      "title": { "en": "Material details", "ar": "تفاصيل المادة" },
      "editable_at": ["draft", "contractor_pm_review"],
      "visible_if": null,
      "repeatable": false,
      "fields": [
        { "key": "manufacturer", "type": "pick_list", "source": "approved_suppliers",
          "label": { "en": "Manufacturer", "ar": "المصنّع" }, "required": true },
        { "key": "quantity", "type": "number", "unit": "m²", "decimals": 2,
          "label": { "en": "Quantity", "ar": "الكمية" } }
      ]
    }
  ],
  "pdf": { "columns": 2, "photo_grid": 3, "header_fields": ["manufacturer"] }
}
```

### Common field properties

| Property | Meaning |
|---|---|
| `key` | Stable identifier (`snake_case`). **It never changes across versions**, because answers are stored by key. |
| `type` | One of the catalogue types (§2). |
| `label`, `help` | i18n text. |
| `required` | `true`, `false`, or a condition. |
| `visible_if` | A condition. Hidden fields are not validated, and their stored values are cleared on save. |
| `default` | A static value, or a system value such as `today` or `current_member`. |
| `reportable` | Promotes the value into the reporting table, for filters and dashboards (§8). |
| `pdf` | `include`, `width` (full or half), `label_override`. |

Conditions use the **same JSON rule language as Workflow conditions** ([workflow-engine.md §4](workflow-engine.md)). One evaluator serves both, in the browser and on the server.

### System fields (not part of the schema)

These are always present, and the engine renders them itself:
- Title, Trade, Location, Scopes / Sub-scopes, Package, Links.
- For Revisions: the "previous revision" panel.

The Form designer can't remove them. It can only choose where they appear on the PDF.

---

## 2. Field type catalogue (v1)

| Group | Types | Notes |
|---|---|---|
| Text | `text`, `textarea` | Plain text. `textarea` allows line breaks, not rich formatting. |
| Numbers | `number`, `currency`, `calculated` | `number` has unit, min, max and decimals. `currency` defaults to SAR. `calculated` is a formula over other numeric fields (`+ − × ÷`, `sum(table.col)`) and is read-only. |
| Time | `date`, `datetime`, `time` | Stored as ISO values in UTC with the Project's time zone. Display follows §5. |
| Choice | `yes_no`, `select`, `multi_select` | Options are i18n. |
| People and org | `member`, `participant` | Limited to Project Members and Participants the filler can see. |
| References | `pick_list`, `work_item_ref` | `pick_list` sources: Approved Supplier List, Scopes, Locations, custom lists, and later BOQ items. `work_item_ref` creates a **Link**, and can be restricted to Types and outcomes (e.g. "approved MAR"). |
| Files | `attachments`, `photos` | Both become **Documents** and are frozen at the first Send or Submit. `photos` supports camera capture and keeps EXIF time and GPS. An optional time/location stamp can be burned onto the image. |
| Structure | `table` | Repeating rows with typed columns and optional column totals, e.g. manpower (trade, count) or equipment (type, count, hours). |
| Checklists | `checklist` | See §3. |
| Plans | `pin` | Places the item's Pin on a plan Drawing of its Location. |
| Aggregates | `aggregate` | Pulls values from other Work Items of a named Type in a period, e.g. a Weekly report summing manpower from that week's issued Dailies. It writes a snapshot, then stays editable. It flags missing Dailies (Expected Frequency) with "add late" or "ignore". |
| Layout | `heading`, `instructions`, `divider` | Display only. |
| Future | `boq_quantities` | For WIRs, switched on with the Financial Module. |

**Signatures are never Form fields.** They come only from signing Transitions ([ADR 0003](adr/0003-docusign-grade-signing-not-legally-qualified.md)).

---

## 3. Checklists

A `checklist` field holds a list of **check items**:

| Item property | Meaning |
|---|---|
| `key`, `text` (i18n) | The check, e.g. "Rebar cover as per drawing". |
| `answers` | An answer set, e.g. `Yes / No / N/A` or `Pass / Fail / N/A`. |
| `comment` | `off`, `optional`, or `required_on_negative`. |
| `photo` | `off`, `optional`, or `required_on_negative`. |
| `on_negative` | `none`, or `create_snag`. `create_snag` raises one Snag per failed item when the Form is submitted, `raised_from`-linked to the source item. |

- **Checklist templates** (e.g. "Concrete pour", "HSE weekly") live in the library at Rabaed, Company or Project level. Inserting one into a Form **copies** its items, following the same library pattern as everything else.
- **Checklist summary:** the PDF and list view show counts (e.g. 18 Pass / 2 Fail / 1 N/A). An Inspection Result can be proposed from it ("Failed" if any Fail), but the inspector confirms it in the Action Form.

---

## 4. Who fills what: section editability

A Work Item's Form is filled by different Participants at different times. For example, the Contractor fills in the Inspection request, and the Consultant fills in the checklist on site.

- Each section has `editable_at`: the list of Workflow Step keys where its fields can be changed. The default is the raiser's Draft and internal Steps.
- Outside those Steps the section is read-only. Once an item is Submitted, the Contractor's sections are locked, which matches the Documents being frozen.
- The Workflow builder checks that every `editable_at` key exists in the Workflow attached to the Type.
- Each change to a section after Draft is recorded in the event trail as a field-level diff, with an internal or shared audience following the rule in [workflow-engine.md §5.1](workflow-engine.md).

Action Forms remain the place for per-Transition input: Review Code, comments, "assign to", reasons. The Form holds the content of the Work Item itself.

---

## 5. Languages, dates, numbers

- **Labels** are `{en, ar}`. Rabaed Defaults must have both. Customer Forms need at least one, and the builder warns if the other is missing. More languages can be added to the same map later.
- **Values** are stored exactly as typed. They are never translated.
- **The UI** follows the viewer's language and direction (RTL for Arabic), and the Form layout mirrors automatically.
- **Dates** follow the viewer's locale on screen. On the PDF they follow the Project's record language (`ar`, `en` or `bilingual`). Numbers use Western digits unless the Project selects Arabic-Indic digits for Arabic output.

---

## 6. PDF layout

Every Form version carries a `pdf` block. The Documental Record renderer lays out, in order:

1. **Header:** Project name and code, Participants' logos (raiser, reviewer, Owner), Work Item Type, Document Number with revision, outcome badge, dates. `header_fields` adds chosen Form fields here.
2. **System fields**, then the **sections** in order. A layout of 1 or 2 columns sets how fields sit per row. Tables and checklists are rendered as tables. Photos go in a grid (`photo_grid` per row) with captions and time stamps.
3. **Signing trail:** every signing event with Signature image, name, Position, Company, time and content hash. There is no Internal Communication and no Chat.
4. **Appended Documents:** PDFs and images are appended. Other file types are listed with their hashes.
5. **Verification footer:** a QR code to the verification page, and page X of Y on every page.

With record language `bilingual`, each label prints as `English / العربية`, with the Arabic side laid out right-to-left.

### PDF Templates

Layout is not fixed to the Form: a Form can have **several PDF Templates**, and each Project picks which one a Work Item Type uses.

- **Rabaed Default templates** come ready-made, e.g. "Portal style" (the layout above) and "Classic paper style".
- **Paper-matching templates** reproduce a customer's existing paper form (their layout, boxes, logo positions). In v1 they are authored by Rabaed Engineers in Rabaed Admin ("make a new template") and published to that customer's Company library. A customer-facing visual designer comes later.
- A template is an HTML/CSS layout with placeholders bound to Form field keys, system fields, the checklist and photo blocks, and the signing trail. It is versioned and immutable once published, like Forms.
- The signing-trail page and the verification QR code are always added by the engine, whatever the template. Templates can't remove them.
- The template version used is recorded on the `documental_record`, so a sealed PDF can always be explained.

---

## 7. Versioning and data compatibility

- A draft `form_version` is edited freely. Publishing freezes it, and new Work Items use the latest published version.
- **Keys are forever.** A key can't be reused for a field of a different type, and the builder enforces this across all versions of the definition.
- **Dropping a field** in a new version doesn't touch items pinned to older versions: they keep rendering with their own schema.
- **A Revision onto a newer Form version** copies values by matching key and type. Values for fields that no longer exist stay visible in the previous revision only. The new revision shows a notice listing them.

### Publish-time validation

- Keys are unique, and conditions and formulas reference existing keys with no circular references.
- Required fields are not inside sections that can never be visible.
- Every checklist has items.
- `editable_at` Step keys exist in the attached Workflow (§4).
- `pick_list` sources exist in the Project, or will be created when a library Form is copied into it.

---

## 8. Validation, drafts, reporting

- **One validator**, generated from the schema, runs in the browser (instant feedback) and on the server (authoritative, inside `take_transition`). Save as draft skips "required" checks but not type checks.
- **Autosave** runs every few seconds while editing a Draft. Each save records the values plus `updated_at` per field, so the offline mobile app (ADR 0004) can later merge field by field.
- **Reporting:** `reportable` fields are copied on each save into `work_item_field_value (work_item_id, field_key, value_text, value_num, value_date)`. Dashboards and filters query this table, which is under the same row-level security as `work_item`. A GIN index on `work_item.data` covers ad-hoc search.

---

## 9. Builder

- A palette of field types. Drag sections and fields, and edit the selected element in the properties panel: key, labels in both languages, validation, conditions, `editable_at`, PDF options.
- **Previews:** English, Arabic (RTL), phone width, and the **PDF preview** rendered with sample data.
- "Insert checklist template…" and "Insert section from library…" copy from the library.
- "Validate" runs the §7 checks live, and "Publish" runs them again server-side.

---

## Settled (2026-09-26)

1. **Hijri dates:** optional per Project, shown beside the Gregorian date and never replacing it.
2. **No internal-only fields.** Everyone with access to a Work Item sees its whole Form. Only Internal Communication (notes and back-and-forth inside one Participant) is hidden.
3. **PDF Templates:** several per Form, with Rabaed Defaults plus paper-matching templates built by Rabaed Engineers (see §6).

## Former open questions

1. **Hijri dates:** should date fields and the PDF also show the Hijri date alongside the Gregorian one? Government Owners often expect it. *Recommended: optional per Project, shown beside the Gregorian date and never replacing it.*
2. **Internal-only fields:** do some fields need to be visible only to the raising Participant, even after Submit? An example is a cost or supplier price the Contractor keeps for itself. *Recommended: yes, as a section-level `internal` flag. Those values stay out of every other Participant's view and out of the Documental Record.*
3. **PDF matching existing paper forms:** will customers insist their PDF looks exactly like their current paper template (their own layout and logo positions)? *Recommended: v1 configuration as in §6, and a visual PDF template designer later if customers demand it.*
