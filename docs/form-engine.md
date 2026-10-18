# Form engine design

How Forms are defined, filled, validated, versioned and printed. Terms follow [GLOSSARY.md](../GLOSSARY.md). Storage follows [ADR 0006](adr/0006-form-data-as-jsonb-against-versioned-schemas.md): answers are one JSONB document per Work Item, validated against the pinned, immutable `form_version.schema`.

One engine serves:
- every **Work Item Form**: submittals, Inspections, Snags, Site Reports, Packages;
- every **Action Form**: the pop-up on a Workflow Transition;
- **Checklist templates** in the library.

## Contents

Don't read this doc whole: find your heading with `grep -n '^#' docs/form-engine.md`, then Read from that line with offset and limit. `scripts/doc-index.test.ts` keeps this list in step with the headings.

- **1. Schema shape**: read when you change the JSON a Form Version is stored as.
  - **Common field properties**: read when you add or change a property every field has (key, required, visible_if …).
  - **System Fields and Built-in Fields (settled 2026-10-03)**: read when you work on Subject, Document Number, Attachments, Links or the Built-in Fields.
- **2. Field type catalogue (v1)**: read when you need the list of field types, or add one.
  - **2.1 Numbers and contact details (as built, RP-264)**: read when you touch number, currency, email or phone fields.
  - **2.2 Tables (as built, RP-280)**: read when you touch table fields and their columns.
  - **2.3 Option List fields (as built, RP-282)**: read when you touch `option_list` fields.
  - **2.4 Calculated fields (as built, RP-283)**: read when you touch formulas in `calculated` fields.
  - **2.5 The MAR Form Version 1 (as built, RP-272)**: read when you need the first MAR Form Version.
  - **2.6 The MAR Form Version 2 (as built, RP-286)**: read when you need what MAR Form Version 2 added.
  - **2.7 Free Links (as built, RP-291)**: read when you work on Links added by hand in the Links System Field.
  - **2.8 Linked from (as built, RP-292)**: read when you work on the items that link to this one.
  - **2.8a Links within a Revision chain (RP-311 review, `20261107000000_revision_links_follow_chain.sql`)**: read when Links meet Revisions of one chain.
  - **2.9 The link question (as built, RP-293)**: read when you touch `work_item_ref` fields.
  - **2.10 The MAR Form Version 3 (as built, RP-294)**: read when you need what MAR Form Version 3 added (References).
  - **2.11 The three Rabaed Default submittal Forms (as built, RP-591, spec RP-598)**: read when you work on the MAR, SAR or DAR Form.
  - **2.12 The `approved_supplier` field and the MAR Form Version 6 (as built, RP-595, spec RP-598)**: read when you touch the `approved_supplier` field.
  - **2.13 A link question's `accepts`, the WIR Form Version 2 and Required links (as built, RP-82, spec RP-649)**: read when a link question limits its items by Type or outcome, or a Project makes one required.
- **3. Checklists**: read when you work on `checklist` fields and their check items.
  - **3.1 As built (RP-285)**: read when you need the built rules for check items, answers, comments and photos.
  - **3.2 Project Checklist Templates and the Checklist Template choice (as built, RP-651, spec RP-649)**: read when you work on Checklist Templates, the `checklist_template` field or an item's copied checklist.
- **4. Who fills what: section editability**: read when you change which Participant fills a Form Section, and at which Step.
  - **Settled 2026-10-05 (part 3)**: read when you need the rule of one Participant per Form Section.
  - **Settled 2026-10-10: the Form belongs to the raiser (ADR 0019)**: read when you work on who may edit the raiser's Form.
- **5. Languages, dates, numbers**: read when you touch Arabic and English labels, dates or number formats.
- **6. PDF layout**: read when you work on the Documental Record's PDF.
  - **PDF Templates**: read when you meet an old mention of several PDF Templates per Form (retired, ADR 0023).
- **7. Versioning and data compatibility**: read when you change how Form Versions publish and stay compatible.
  - **Which Form a new item gets (as built, RP-554)**: read when you need which Form Version a new Work Item is pinned to.
  - **Publish-time validation**: read when a Form Version won't publish, or you add a publish rule.
- **8. Validation, drafts, reporting**: read when you touch `validateAnswers`, Save as draft, or reporting on answers.
- **9. Builder**: read when you work on the Form builder.
- **10. Option Lists, Saved Fields and Libraries (settled 2026-10-03)**: read when you work on Option Lists, Saved Fields or Libraries.
- **Delivery order (settled 2026-10-03)**: read when you need which part of the engine is built when.
- **Settled (2026-09-26)**: read when you hit an early decision: Hijri dates, no internal-only fields, and others.
- **Former open questions**: read when you need the questions those decisions answered, with their recommendations.

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

As built (RP-267): `evaluateCondition` in `packages/domain` (`condition.ts`). A comparison reads a Form `field` or an item `attr`.
- `=` and `!=` compare exactly. A multi-select equals a list holding the same options, in any order.
- `> >= < <=` order like with like: two numbers, or two ISO values of one kind (dates, times of day or UTC instants). Anything else, plain text included, has no order, so the rule doesn't hold.
- `in` and `not_in` take a list. A multi-select is `in` when any of its options is.
- `empty` matches nothing, empty text or no option; No is not empty.

A Form's conditions read its own fields only, for now. The item's attributes reach the Form with the Built-in Fields (RP-270), so until then a rule with `attr` is refused.

`visible_if` works on sections and fields. A hidden field reads as cleared, so a field that depends on it hides too. `formVisibility` works out what is shown, and `isRequired` evaluates `required` when it is a condition. The validator skips hidden fields and drops their answers. The API stores what it returns, and the web sends only shown answers.

### System Fields and Built-in Fields (settled 2026-10-03)

Every Work Item has the same frame around its Form:

```
System Fields   Subject · Document Number (with Rev)
Form            the Company's own fields, with the Built-in Fields placed among them
System Fields   Attachments · Links
```

- **System Fields** are outside the schema, and the engine renders them itself. The Form designer can't remove or move them, and only chooses where they appear on the PDF.
- **Built-in Fields** sit inside the Form: Trade, Location, Scopes / Sub-scopes (filtered by the chosen Trade), and any Visibility Dimension the Project marks as required on Work Items. The designer places and labels them but can't delete them, and Trade and Location are always required. Visibility and Consultant routing depend on them.
  - In the schema each is a field whose `key` is its `type` (`trade`, `location`, `scopes`). A schema without them, with one twice, or with Trade or Location optional can't be published (§7).
  - The validator requires Trade even in a Draft (no Work Item exists without one) and Location to leave Draft, whatever the schema says. It refuses Scopes outside the chosen Trade, and Sub-scopes whose Scope isn't chosen. Changing the Trade clears the Scopes that no longer fit.
  - Their answers are ids, stored where visibility reads them (`work_item_dimension_value`, `work_item_scope`), never in `data`. The API returns them among the answers.
  - **Fixed by the number (RP-581, ADR 0021):** once an item has its Document Number, a Trade the pattern holds, or a Location when the pattern holds a Location level, never changes: a save that changes it is refused `number_part_fixed`. The pattern is the Version the item was numbered under (`work_item.numbered_at`), not the Project's current one; a field the pattern doesn't use is unaffected. The item's detail carries `fixedByNumber` (`["trade"]`, `["location"]`, both or none; a Draft never numbered has none), and the Form shows such a field read-only with the notice "This is part of the Document Number. To change it, cancel this item and raise a new one.", linking to Cancel where the item may still be cancelled.
  - Custom Visibility Dimensions don't exist yet; their Built-in Fields come with them.
- For Revisions, the "previous revision" panel appears automatically.

---

## 2. Field type catalogue (v1)

| Group | Types | Notes |
|---|---|---|
| Text | `text`, `textarea`, `email`, `phone` | Plain text. `textarea` allows line breaks, not rich formatting. `email` and `phone` are format-checked (§2.1) and stored as typed, without the spaces around them. |
| Lists | `option_list` | Choices from an **Option List** with up to three levels, each level filtered by the one above. Settings: single or multiple, and how deep the filler must go. |
| Numbers | `number`, `currency`, `calculated` | Stored as JSON numbers. `number` has unit, min, max and decimals. `currency` defaults to SAR. `calculated` is a formula over other numeric fields (`+ − × ÷`, `sum(table.col)`) and is read-only. |
| Time | `date`, `datetime`, `time` | ISO values: `date` is a calendar date (`2026-10-03`), `datetime` an instant in UTC (`2026-10-03T06:30:00.000Z`) filled in and shown in the Project's time zone, `time` a time of day in the Project's time zone (`07:30`). Every Project is in Asia/Riyadh for now (`timeZone` in `packages/domain`). Gregorian only in part 1. Display follows §5. |
| Choice | `yes_no`, `select`, `multi_select` | `yes_no` stores `true` or `false` (No is an answer, not an empty field). `select` and `multi_select` have options `{value, label: {en, ar}}` and store the option `value`s (a list, in the order chosen, for `multi_select`); an unknown value is refused (`unknown_option`). |
| People and org | `member`, `participant` | Store a Project Member's or a Participant's id. The filler is offered only those they can see (V15), from the API's form choices: their own Participant's Project Members; their own Participant, the Host Company's and, on an item, the Companies on it. Never every Participant, not even for a Project Admin. The server refuses an id the filler couldn't have been offered with the same `unknown_option` as a made-up one. Another Company reads a `member` answer as the Member's Company name, never the person, and the item's answers leave out that Member's id (V14). There's no field for picking any Company on Rabaed, because that would expose the customer list (ADR 0009). A Company outside the Project is typed as text. |
| References | `work_item_ref` | A link question: each item chosen is a **Link** (`relies_on`), also listed in the Links System Field under the field's label. It takes any number of items, with no limit by Type or outcome (settled 2026-10-05) unless it says `accepts`, an opt-in since RP-82 (§2.13), from the Link search (Submitted items the filler can see, in the same Project). It can be `required` like any field, though no Rabaed Default Form makes it so; a Project can make one required on its items (Required links, §2.13). Another Company's reader who can't see a chosen item gets its Document Number and Subject, never its id (E1, ADR 0012). Custom choice lists are **Option Lists** (`option_list`); there's no separate `pick_list` type (settled 2026-10-03). A supplier from the Approved Supplier List is the `approved_supplier` type (§2.12). |
| Files | `attachments`, `photos` | Named file fields in the Form body (e.g. "Test certificate (PDF)", required), beside the always-present Attachments System Field. All become **Documents** and are frozen at the first Submit (ADR 0020, RP-515; before it, at the first Send). An `attachments` field (RP-281) sets `contentTypes` (e.g. `application/pdf`; any the Project takes when unset), `minFiles` and `maxFiles`. Its files are Documents with the field's key (`document.field_key`), never answers, and a condition can't read it. `required` and `minFiles` count confirmed files and are checked when the item leaves Draft (`required`, `too_few_files`); an upload of another type, or past `maxFiles`, is refused (`content_type_not_allowed`, `too_many_files`). A `photos` field (RP-284) is a file field that takes images only (JPEG, PNG, WebP, HEIC), several at once, with camera capture on phones; it sets `minFiles` and `maxFiles` as an `attachments` field does. Each photo's EXIF time and GPS are read by the api from the stored file when the upload is confirmed (never taken from the browser), kept on the Document, and shown with its thumbnail to everyone who sees the item (V13); a camera time without a time zone is taken as the Project's. A photo without them shows "no time/location recorded". An optional time/location stamp can be burned onto the image (part 4). |
| Structure | `table` | Repeating rows with typed columns and optional column totals, e.g. manpower (trade, count) or equipment (type, count, hours). |
| Checklists | `checklist` | Check items, each with an answer set and evidence on a negative answer (RP-285). See §3. |
| Plans | `pin` | Places the item's Pin on a plan Drawing of its Location. |
| Aggregates | `aggregate` | Pulls values from other Work Items of a named Type in a period, e.g. a Weekly report summing manpower from that week's issued Dailies. It writes a snapshot, then stays editable. It flags missing Dailies (Expected Frequency) with "add late" or "ignore". |
| Layout | `heading`, `instructions`, `divider` | Display only, with no answer. `heading` and `instructions` take `text` (`{en, ar}`), and all three take `visible_if`. |
| Future | `boq_quantities` | For WIRs, switched on with the Financial Module. |

### 2.1 Numbers and contact details (as built, RP-264)

- `number`: optional `unit` (plain text, e.g. `m²` or `طن`), `min`, `max` (inclusive) and `decimals` (0–6; no limit when unset). Out of range is `below_min` or `above_max`, too many decimal places `too_many_decimals`, and anything but a JSON number (text of digits included) `wrong_type`. 0 is an answer.
- `currency`: `currency` is an ISO 4217 code, `SAR` by default, with optional `min` and `max`. Amounts take the currency's own decimals (2 for SAR).
- `email`: one address, at most 254 characters (`isEmailAddress`).
- `phone` (`isPhoneNumber`): spaces, dashes, dots and brackets may group the digits. A KSA number as dialled at home (`05x xxx xxxx`, a landline `01x xxx xxxx`, `800 …`, `920 …`), or any number with its country code after `+` or `00` (E.164, at most 15 digits; after `+966`, a KSA mobile or landline, with or without its home 0). Arabic-Indic digits are refused; the phone box turns them into Latin ones as they are typed.
- On screen: numbers are grouped, in Latin digits, to the field's decimals, with the unit after them; amounts in the viewer's language (`SAR 1,250.75`, `1,250.75 ر.س.`). A number reads in the page's direction, so in Arabic its unit still follows it; email addresses and phone numbers read left to right. The number box takes text, turns Arabic-Indic digits into Latin ones as they are typed (`toLatinDigits`, `parseNumberInput`), takes commas only where they group thousands (`12,5` is refused, never read as 125), and passes text that isn't a number on for the validator to refuse.

**Signatures are never Form fields.** They come only from the Transitions Members take, every one of which signs ([ADR 0017](adr/0017-the-documental-record-names-everyone-who-acted.md)).

### 2.2 Tables (as built, RP-280)

- A `table` has `columns` (1–30, unique keys), `minRows` and `maxRows` (0–200). A column is `text`, `number`, `currency`, `date`, `yes_no`, `select` or `option_list` (§2.3), with the settings its field type has plus `required`. Files, people, checklists and nested tables are refused, so a row never holds a reference and the stripping function (ADR 0012) has nothing to strip from a table.
- The answer is a list of row objects keyed by column key, stored as given: `[{"fixture": "Downlight", "quantity": 12}]`. An empty cell is left out of its row (No is an answer), and a row with nothing in it is dropped and not counted.
- Each cell is checked by its column's type in draft and complete mode, with the same codes as a field (`wrong_type`, `below_min`, `too_many_decimals`, `unknown_option`, …); an error names the cell with `row` (from 0, as sent) and `column`. A column the table doesn't have is `unknown_field`. A row that isn't an object is `wrong_type` with its `row`.
- Complete mode (leaving Draft) also checks `required` cells, `too_few_rows` and `too_many_rows`; with no rows, a required table is `required`. A Draft takes any number of rows up to 200, so rows can be added before the limits are met. A hidden table is cleared like any hidden field.
- A `number` or `currency` column with `total` shows its sum under the table (`tableTotals`), rounded to the column's decimals. Totals are read-only and never stored; to store a total, use a `calculated` field over `sum(table.column)` (§2.4).
- On screen: in edit mode each row is a labelled group of fields (one column of fields on a phone, a grid on a desktop), with a remove button per row, "Add row" and the totals; adding a row focuses its first field. In read mode it is a table, scrolling inside its own region on a phone. The history shows a table's change as its row count.

### 2.3 Option List fields (as built, RP-282)

- An `option_list` field has `list` (the Option List's **id**: options are never copied into the Form, so the list stays live), `multiple` (false by default) and `depth` (1–3, default 1). As a table column it has `list` and `depth`, and is always a single choice.
- The answer is the `value` of the option reached, never its label: a string, or for `multiple` a list in the order chosen. The path to it follows from the list, because values are unique within a list; a shallower option can't be told apart from a deeper one by the answer alone, and doesn't need to be.
- **Depth** is how many levels the filler goes down. A new choice must be at the depth, or on a branch that ends sooner (nothing under it, or only retired options). Options below the depth aren't offered (`unknown_option`). A Draft may stop half way down; leaving Draft with an option that stops short, though options remain below it, is `too_shallow`.
- **Retired options**: refused for a new choice (`unknown_option`), at any level on the way. An option the saved answer already holds (for a table column: any saved row holds in that column, so a retired option kept in one row can also be picked in another row of the same column) stays valid and saves again unchanged, leaving Draft included; it can be changed away from, and once let go of can't be chosen again. A retired option can't be gone deeper into, so a kept one counts as deep enough.
- The validator takes the lists and the saved answers in its context (`optionLists`, `held`); the API reads the lists in the same transaction, so an option added in Rabaed Admin is accepted at once, with no new Form Version. Without lists (the browser before they load) an answer is only checked to be text.
- On screen: a single choice is one select per level, each offering the options under the one chosen above (choosing another above clears what was below); a retired choice stays selected, marked "retired". A multiple choice is a checkbox for every option that can be chosen, named by its path (`Cables › Copper › 2.5 mm²`). Read mode shows the same path, in the viewer's language, marked when an option on it is retired. The history shows a change the same way.
- Publish-time check: the list must exist (`unknown_option_list`, §7).

### 2.4 Calculated fields (as built, RP-283)

- A `calculated` field has a `formula`, `decimals` (0–6, 2 when unset) and an optional `unit`. A formula is numbers (Latin digits, a point for decimals), numeric field keys and `sum(table.column)`, joined by `+ − × ÷` (`-`, `*` and `/` too) and parentheses, with a leading minus. A schema whose formula doesn't parse is refused.
- One evaluator (`parseFormula`, `evaluateFormula` in `packages/domain`, `formula.ts`) works it out in the browser and on the server. `calculateAnswers` works out every calculated field of a schema, each after the calculated fields it reads, whatever their order in the Form; it reads their rounded results, as stored.
- The result is rounded to the field's decimals, halves away from zero (`roundTo`, which table totals use too). It is **empty** when an input is missing or isn't a number, a column it sums has no number in it, or it divides by zero. 0 is an input. A hidden input reads as cleared, so the result is empty, and a hidden calculated field is cleared like any other.
- **The server's result is the answer.** `formVisibility` and `validateAnswers` drop whatever the client sent for a calculated field (of any type, so it is never refused) and put the result in its place, so the API stores it with the answers and the answer hash covers it. An empty result is no answer: a required calculated field that is empty is `required` when the item leaves Draft.
- Conditions read calculated fields like any other number (e.g. show an approval field when a total is over 1,000).
- On screen: in edit mode the result is read-only, worked out from the answers as they are typed, in an `output` named by its label (a polite live region), with "Not worked out yet" while it is empty; its `required` error asks for the fields it is worked out from. In read mode it shows the stored result. It reads like a number: grouped, Latin digits, to its decimals, with its unit after it.

### 2.5 The MAR Form Version 1 (as built, RP-272)

The part-1 MAR is a Rabaed Default written as data (migration `mar_quantity` completes the Version the skeleton shipped): Manufacturer (text, required), Model (text), Quantity (`number`, unit `pcs`, 0 or more, two decimals), Specification section (text) and Description (textarea, required), with Trade, Location and Scopes as Built-in Fields among them, and the Attachments System Field below. Send for Review with the Form incomplete is refused with `form_incomplete`; the page marks each field and lists them by label. Version 2 (§2.6) replaced it for new MARs; MARs started on it keep it.

### 2.6 The MAR Form Version 2 (as built, RP-286)

- Published by migration `mar_form_version_2` as a Rabaed Default, written as data like Version 1, so every environment has it once migrated. `apps/api/test/mar-form-v2.test.ts` runs the part-1 publish checks (`publishProblems`, §7) on it against Version 1; published Versions never change, so it stays checked.
- Sections and fields: **Material details** (Manufacturer, text, required; Model; Specification section; Description, textarea, required), **Items** (`items`, a `table` of Fixture type (text, required), Description (text), Quantity (`number`, 0 or more, two decimals, required, with a total) and Unit (`select`: Pieces, Metres, Square metres, Sets; required)), **Documents** (Datasheet, `attachments`, PDF only, required; Test certificate, `attachments`, optional; Sample photo, `photos`, optional) and **Classification** (Trade, Location, Scopes).
- Version 1's `quantity` field is gone: the Items hold the quantities. The key is never reused for another type (§7).
- New MARs pinned Version 2 until Version 3 (§2.10). A MAR on Version 1 keeps showing and validating with Version 1, leaving Draft included, so it needs no Datasheet.
- Leaving Draft without the Datasheet is refused per field (`form_incomplete`, `datasheet: required`).
- The demo seeds its MARs through this Form: Items, the Datasheet (a generated PDF) and a Sample photo with EXIF time and GPS (README, "Demo: the MAR journey"). The supplier is chosen from the Approved Supplier List on Version 6 (§2.12).

### 2.7 Free Links (as built, RP-291)

- The Links System Field sits below Attachments. `GET /v1/work-items/:id/links` returns every Link (kind, field key, Document Number, Subject) and the linked item's id only when the viewer sees it; `canChange` follows Save draft. `POST /v1/work-items/:id/links {workItemId}` and `DELETE /v1/work-items/:id/links/:linkId` add and remove free (`related`) Links, until Submit.
- One Link by its own id (RP-521, visibility scenario RP-521-1): `GET /v1/work-items/:workItemId/links/:linkId` returns that Link as the Links read gives it, so a linked item the reader can't see is its Document Number and Subject, with `workItemId` null. A Link not of that item, an item the reader can't see, or a made-up or malformed id is the same 404. Its page, `/work-items/<item>/links/<Link>`, is where a Link to a hidden item opens, from the Links System Field and from a link question: the number, the Subject and only "You are not allowed to see the details of this item.", with a way back to the item. A Link whose item the reader sees redirects to that item.
- A target Link search couldn't have offered (hidden, never Submitted, another Project's, made up, the item itself) is refused alike as `target_not_found`; the same target twice is `already_linked`.
- After Draft, each change is an internal `answers_changed` event whose change names the field `$links`, its old and new free Links as Document Number and Subject, never an id. Nobody is notified.

### 2.8 Linked from (as built, RP-292)

- In the Links System Field, below the item's Links. `GET /v1/work-items/:id/linked-from` returns `{items}`: every item that has been Submitted and links to it, free Links and link questions alike, once each, by Document Number. Each is its Document Number and Subject, with its id only when the viewer sees it (E3); nothing else.
- An item that has never left its raiser (Draft or internal review) is never listed, whoever asks; it appears at its first Submit. From then on it stays listed, also while it is Sent Back to its raiser, with its Links as they were at the Send Back until it is Submitted again (settled 2026-10-06, RP-295; as built, RP-309: `app.work_item_linked_from` reads each linking item's Links by the same rule, `app.item_row_as_arrived`, since it names linking items the viewer can't see (E3); `app.item_row_seen` adds the viewer's own access check). An item the viewer can't see is 404, like its other reads.
- Served by `app.work_item_linked_from` (security definer), never the table: the app role can't read a Link's target.

### 2.8a Links within a Revision chain (RP-311 review, `20261107000000_revision_links_follow_chain.sql`)

- Settled with the user (2026-10-05): the Links agree with the Revision drop-down (workflow-engine.md §5.4). Every Link read leaves out an item of the reading item's **own chain** that the reader can't see, instead of showing its Document Number and Subject (E1, E3 still apply to items of other chains). `app.chain_item_hidden(item, other)` is the test (same `root_id`, not the item itself, `app.sees_work_item` false).
- `app.work_item_links` (the Links System Field and the link questions' Links) and `app.work_item_linked_from` use it; Linked from also leaves out a discarded Revision. So the original's `related` Link to a Rev 1 moved to a Location the reader doesn't cover is not shown, nor the original in that Rev 1's Linked from (visibility.md scenario 62).
- `app.work_item_answers` reads each link question through `app.link_choices_as_seen(item, project, ids)`, which leaves such an item out of the answer (the two-argument version is dropped). `app.resolve_link_answers` keeps it where the stored answer held it when a saver who couldn't read it saves the answer back.
- A discarded Revision is seen by nobody, so its Links, Linked from and copied Documents answer 404, and its link-question Links never reach the Linked from of the items it named (it never left Draft).

### 2.9 The link question (as built, RP-293)

- A `work_item_ref` answer is a list of item ids in the order chosen, no duplicates (`wrong_type` otherwise); `required` wants at least one when leaving Draft. Each new id must be one Link search could offer the filler, else `unknown_option` (hidden, never Submitted, another Project's, made up, the item itself alike); an id the field already holds stays acceptable on re-save while the filler still sees it.
- Every save, and a create, makes the field's `relies_on` Links equal to the answer in the same transaction (`app.save_work_item_answers`); the database refuses anything else as `target_not_found`, whatever the API sends.
- `app.work_item_answers` gives a chosen item the reader can't see as `{document_number, subject}`; the API carries it as `{documentNumber, subject}`. Saved back as read, it keeps that item (matched by Document Number among those already chosen); left out, it is removed. Its id never reaches that reader, so it can't be chosen anew.
- After Draft, a change is recorded under the field's key, its old and new items as Document Number and Subject, never ids.

### 2.10 The MAR Form Version 3 (as built, RP-294)

- Published by migration `mar_form_version_3` as a Rabaed Default, like Version 2. `apps/api/test/mar-form-v3.test.ts` runs the part-1 publish checks on it against Versions 1 and 2.
- Version 2 unchanged, plus a **References** section (before Classification) with one field: **Related submittals** (`related_submittals`, `work_item_ref`, optional; "الاعتمادات ذات الصلة"). No Rabaed Default makes a link question required.
- New MARs pin Version 3. MARs on Version 1 or 2 keep showing and validating with theirs, leaving Draft included; Version 2 knows no `related_submittals`.
- The demo (README, "Demo: the MAR journey") seeds an approved MAR in Tower 1 and a Submitted MAR on Version 3 in Tower 2 that links it under Related submittals and as a free Link, plus a TMC engineer (Omar) who covers Tower 2 only, so he reads the approved MAR as its Document Number and Subject (E1). The walkthrough's steps 10–12 show the Links, the hidden Link and Linked from (E3), and `apps/api/test/demo-seed.test.ts` follows them through the API.

### 2.11 The three Rabaed Default submittal Forms (as built, RP-591, spec RP-598)

- One Form per Submittal Type: the MAR's (above), the SAR's and the DAR's. Migration `20270404000000_sar_dar_forms.sql` gave the SAR and DAR Types a Form definition each (they pointed at the MAR's until then); `apps/admin/forms/SAR.json` and `DAR.json` are published into them by `pnpm defaults:publish` as Version 1 (`rabaed-defaults.ts`). Items already raised keep the MAR Form Version they were pinned to (ADR 0006). The Forms are drafted from typical KSA practice for the owner's review; the owner rebuilds them later in the form builder (RP-19). Every label is in English and Arabic.
- **SAR** (Supplier Approval Request), sections: **Supplier details** (`supplier_name_en` and `supplier_name_ar`, text, both required: the name that becomes the Approved Supplier List entry, so **these two keys are the ones "a SAR adds its supplier" (RP-594) reads**; `commercial_registration_number`, required; `country_of_origin`; `contact_person`; `contact_email` (`email`); `contact_phone` (`phone`)), **Proposal** (`proposed_supply`, textarea, required; `additional_information`), **Experience** (`past_projects`, a `table` of project name (required), client, city, year, what was supplied), **Documents** (`company_profile`, PDF, required; `iso_certificates`; `saso_certificates`) and **Classification** (Trade, Location, Scopes: the Scopes are the ones the supplier is proposed for).
- **DAR** (Document Approval Request), sections: **Document details** (`document_type`, `select` of Report, Calculation, Plan, Procedure, Other, required; `document_title`, required; `document_revision`, the document's own revision; `specification_section`), **Documents** (`document`, `attachments`, one file, required; `supporting_files`) and **Classification** (Trade, Location, Scopes).
- Seam 1: `apps/api/test/sar-dar-forms.test.ts` runs the publish checks on both files, and raises a SAR and a DAR on a Project on their own Form Version (a MAR's answers are refused on either).

### 2.12 The `approved_supplier` field and the MAR Form Version 6 (as built, RP-595, spec RP-598)

Settled with the owner (2026-10-15): a MAR's supplier must be approved. It is a new field type, not an Option List (the list is the Project's register, kept in Project Settings, RP-592, not an Option List of Rabaed Admin).

- **Schema:** `{"key": "supplier", "type": "approved_supplier", "required": true}`; no settings. Not a table column and not in an Action Form (`not_in_action_form`).
- **The answer** is the supplier's id (`approved_supplier.id`), stored in `data` like any answer. It reads as the supplier's **name only**, in the viewer's language (`formatFormValue`, from the list the page loads); never the SAR that approved it (V10), which the app role can't read anyway. Every Participant reads the same name. The id is Project-wide: every Project Member of every Participant reads the list's entries by id (V10), so `app.work_item_answers` strips no `approved_supplier` answer (ADR 0012's strip rules are for references the reader may not see), and another Company reading the MAR gets the id and the name only (visibility.md scenario RP-598-2).
- **Choices:** the suppliers of the Project's Approved Supplier List that are `approved` for the item's **Trade**. `validateAnswers` takes the list as `context.suppliers` (`id`, `tradeId`, `status`; the API reads it in the same transaction, so a supplier added a moment ago is offered at once). A new choice that is withdrawn, of another Trade or made up is refused `unknown_option`.
- **Kept:** a supplier the item already holds (`context.held`) stays valid while the Trade is the same, withdrawn or not, so it saves again and the item leaves Draft with it. Changing the Trade to another than the held supplier's **clears** it (`validateAnswers` drops it; the renderer clears it with the Trade); leaving Draft then needs a new one. A supplier of the old Trade given anew with the new Trade is refused, not cleared.
- **Required** to leave Draft like any required field (`form_incomplete`, `supplier: required`); a Draft saves without one.
- **On screen:** a select of the Trade's approved suppliers, sorted in the viewer's alphabet; a held withdrawn supplier is listed marked "(withdrawn)"; a Trade with none shows "No approved supplier for this Trade yet" in place of the select (the MAR can't leave Draft until a Project Admin adds one). Read mode shows the name.
- **MAR Form Version 6** (`apps/admin/forms/MAR.json`, published by `pnpm defaults:publish`) is Version 5 plus `supplier` ("Approved supplier", "المورّد المعتمد") in Material details, after Manufacturer; Manufacturer stays free text (the maker, not the one who supplies). It is Version 6 wherever the earlier document was published as Version 5 (every deployed environment); a database seeded fresh numbers the same document 5, since Versions 1 to 4 come from migrations. New MARs pin it; MARs on an earlier Version keep theirs and need no supplier. The demo's Project has one fictional Electrical supplier so its MARs leave Draft.
- Seam 1: `apps/api/test/mar-form-v6.test.ts`; seam 3: `packages/domain/src/form-approved-supplier.test.ts`.

### 2.13 A link question's `accepts`, the WIR Form Version 2 and Required links (as built, RP-82, spec RP-649)

Settled with the owner (2026-10-16, spec RP-649): an Inspection links the approved submittals it relies on, offered only from items closed with Code A or B. This reverses, as an opt-in, the 2026-10-05 rule that a link question takes any Type or outcome: a link question without `accepts` behaves as before.

- **Schema:** `"accepts": {"types": ["MAR"], "outcomes": ["A", "B"]}`, both lists optional, at least one given, each non-empty with no repeats (`form.ts` `linkAcceptsSchema`). `types` are Work Item Type codes; `outcomes` are outcome codes (a reserved code such as `cancelled` is refused).
- **What it takes** (`linkAccepts`): with `types`, only items of one of them, open or closed; with `outcomes`, only closed items with one of them. Always within what Link search offers anyone: Submitted items the filler sees, in the same Project.
- **Link search** takes the field's `accepts` as `types` and `outcomes` (comma-separated) and offers only those items (`searchLinkTargets`); the link question passes them on (`FormLinks.search`). A free Link passes none.
- **Saving:** `validateAnswers` takes `linkable` per field key, so each link question has its own. A new id its `accepts` doesn't take is `unknown_option`, like any item Link search couldn't offer. An id the field already holds stays while the filler still sees it, even if it no longer fits.
- **Publish checks:** `unknown_link_type` and `unknown_link_outcome` (§7, Publish-time validation).
- **WIR Form Version 2** (`apps/admin/forms/WIR.json`, published by `pnpm defaults:publish`): Version 1 plus **Requested for** (`requested_for`, `datetime`, required; "الموعد المطلوب") at the end of "Work to inspect", and a **References** section before Classification with **Approved submittals** (`approved_submittals`, `work_item_ref`, `accepts` outcomes A and B, optional; "الاعتمادات الموافق عليها"). New WIRs pin it; WIRs on Version 1 keep theirs. It is Version 2 wherever Version 1 was published (every deployed environment); a database seeded fresh numbers the same document 1. Seam 1: `apps/api/test/wir-form-v2.test.ts`.
- **Requested for is a value only.** It is shown and printed as answered, in the Project's time zone, like any `datetime`; no list column, filter, sort, Step Age, notification or colour compares it with the current time (CLAUDE.md: no due dates).
- **Required links** (Project Settings → Required links; `project_required_field`): a Project Admin makes a link question of one of the Project's Types required on their Project, such as the WIR's Approved submittals ("Approved submittals required"). The page lists every link question of the Form a new item of each Type gets there. The API reads the Form of the Project's items of that Type with the field required (`requiredByProject`), whatever Version they are pinned to, so an item can't leave Draft without one (`form_incomplete`, `approved_submittals: required`), and the renderer shows it required; a Draft still saves without one. Off, the Form decides. Every Project Member reads the page (V20); only Project Admins change it (`PUT /v1/projects/{id}/required-fields`; anyone else gets 404). Seam 2: `packages/db/test/wir-approved-submittals-rls.test.ts` (scenarios RP-82-1, RP-82-2).

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

- **Checklist templates** (e.g. "Concrete pour", "HSE weekly") live in the library at Rabaed, Company or Project level. Inserting one into a Form **copies** its items, following the same library pattern as everything else. The Project level, and an Inspection's pick copied onto the item, are built (§3.2, RP-651).
- **Checklist summary:** the PDF and list view show counts (e.g. 18 Pass / 2 Fail / 1 N/A). An Inspection Result can be proposed from it ("Failed" if any Fail), but the inspector confirms it in the Action Form.

### 3.1 As built (RP-285)

- A `checklist` field has `items` (1–100, unique keys). An item has `key`, `text` (`{en, ar}`), `answers` (`yes_no_na` or `pass_fail_na`, the default), `comment` (`off`, `optional` (the default) or `required_on_negative`) and `photo` (the same rules; `off` by default). `on_negative` (`create_snag`) is not in the schema yet: it comes with the Snag List module. `required` on the field asks every item for an answer when the item leaves Draft; a checklist that isn't required may leave items unanswered.
- **Answers are stored per item**, by item key, as `{"rebar_cover": {"answer": "fail", "comment": "Cover is 15 mm"}}`. The answers are `yes`, `no`, `na` or `pass`, `fail`, `na`; the one that isn't in the item's set is `unknown_option`. `no` and `fail` are the **negative** answers. A comment is text of at most 1,000 characters, taken only where the item has comments (otherwise `wrong_type`); a blank comment and an entry with nothing in it are dropped. A comment typed before the answer is kept in a Draft. A key that isn't an item is `unknown_field`. Errors name the item (`item`), not a row or column. A condition can't read a checklist, and a hidden one is cleared like any field.
- **Photos are Documents** tied to the field and the item (`document.field_key` and `document.item_key`), never answers. They are images only, at most 10 to an item (`too_many_files`), and only for an item whose `photo` isn't `off` (`field_not_found` otherwise); they keep EXIF time and place as a `photos` field's do (V13), and freeze at the first Submit (ADR 0020, RP-515).
- **Leaving Draft** checks, per item: `required` (the checklist is required and the item has no answer), and, for an item answered negatively, `comment_required` and `photo_required` when its rule is `required_on_negative` and the comment is blank or the item has no confirmed photo (the validator counts them from `context.files`, keyed `field.item`; the api reads the counts in the same transaction). A Draft saves any of them missing. An item answered Pass, Yes or N/A needs nothing; an optional comment or photo is never required.
- **The summary** is derived, never stored (`checklistSummary`, `checklistSummaryText` in `packages/domain`): how many items were answered each way, Pass, Fail, Yes, No, then N/A, for the answers the items offer, left out when none, then the items not answered yet: `18 Pass / 2 Fail / 1 N/A`, `1 Pass / 3 not answered`, or "Not answered". It shows above the items, in the Form and on read-only views, and the history and `formatFormValue` read a checklist as it.
- **On screen:** each item is a card with its text and a segmented answer (touch-sized on a phone), then the comment and photos it takes: an item whose comment or photo is `required_on_negative` shows it once the answer is negative, marked "(required)", and keeps showing what it already holds. A missing piece is said under its item. Read mode lists each item's answer, comment and photos.

### 3.2 Project Checklist Templates and the Checklist Template choice (as built, RP-651, spec RP-649)

Settled with the owner (2026-10-16, spec RP-649): on an Inspection the Contractor picks the official Checklist Template for the work, filtered by the item's Trade, and its items are copied onto the item, fixed once it is Submitted. The Rabaed and Company levels of the library, and inserting a template into a Form at design time, stay with RP-42.

- **Templates** (Project Settings → Checklist Templates; data-model.md `checklist_template`): a Project Admin creates one with a name (EN/AR), one of the Project's Trades and 1 to 100 check items in the §3.1 item shape plus `on_negative` (`none` or `create_snag`, the default; RP-577 raises the Snags), `checklistTemplateItems` in `packages/domain`. Each edit is the template's next Version; a Version never changes. Retire offers it to no new pick. Each command is audited. Every Project Member of every Participant reads them (V20); anyone else, and anyone but a Project Admin who tries to change one, gets the plain 404. The page lists them per Trade with their items, Version and availability; the editor shows the items as a WIR shows them beside it.
- **Schema:** `{"key": "checklist_template", "type": "checklist_template", "required": true}`; no settings. Not a table column and not in an Action Form (`not_in_action_form`).
- **The answer** is the id of the template Version picked (`checklist_template_version.id`), so the answers' hash names exactly the Version copied. It reads as the template's name (`formatFormValue`, from the choices the page loads). Every Project Member reads the templates, so `app.work_item_answers` strips none.
- **Choices** (`ValidationContext.checklistTemplates`, `checklistTemplateChoices`): the latest Version of each active template of the item's Trade is offered; anything else is `unknown_option`. **Kept:** the Version the item already holds stays valid while the Trade is the same, edited or retired since, so it saves again and leaves Draft with it. Changing the Trade clears it, as for `approved_supplier` (§2.12). A Duplicate keeps the pick only while it is still offered.
- **The copy:** each create and Save draft copies the picked Version's name and items onto the item (`work_item_checklist`, `app.sync_work_item_checklists`), the definition of the item's checklist, never in the Form; the item read carries it (`checklistCopies`), and whoever sees the item reads it. A later edit or retirement of the template never changes it. A new pick before the first Submit replaces it; taking the pick back deletes it. The database takes only the latest Version of an active template for a new copy, under a share lock on the template, so a retirement committing meanwhile is never missed. **After the first Submit** the pick and the copy are fixed: a save that changes or clears it is `not_editable`, after a Send Back that lets the raiser edit the Form too.
- **Required** to leave Draft like any required field (`form_incomplete`, `checklist_template: required`); a Draft saves without one.
- **On screen:** a select of the Trade's active templates, sorted in the viewer's alphabet, the held one marked "(as picked)" once it is no longer offered; "Choose a Trade first." before a Trade, "No Checklist Template for this Trade yet" when it has none. Below it, the picked Version's items read-only: each item's text, its answers, what a negative answer asks for and whether it raises a Snag, "answered by the Consultant on site". Read mode shows the name and the items.
- **WIR Form Version 3** (`apps/admin/forms/WIR.json`, published by `pnpm defaults:publish`): Version 2 plus a **Checklist** section, after Classification so the Trade is chosen first, with **Checklist Template** (`checklist_template`, required; "قالب قائمة التحقق") in the raiser's section, with the copied items shown read-only below it; the Form has no section another Participant fills (ADR 0019). The Consultant Engineer answers the copied items on site in a reply Screen (INSP-4, RP-86). New WIRs pin it; WIRs on Versions 1 and 2 keep theirs and need no template. It is Version 3 wherever Version 2 was published; a database seeded fresh numbers the same document 1.
- **Revisions:** `app.fill_revision` carries the pick in the Revision's answers, and the api copies it when it creates the Revision: the Version the revised item holds, edited or retired since (the Revision's re-inspection keeps the same checklist, spec RP-649). A copy still missing is filled in before the item moves on, and after its first Submit too, since that is no change of the pick.
- Seam 1: `apps/api/test/checklist-templates.test.ts`; seam 2: `packages/db/test/checklist-template-rls.test.ts` (scenarios RP-651-1, RP-651-2); seam 3: `packages/domain/src/form-checklist-template.test.ts`.

---

## 4. Who fills what: section editability

A Work Item's Form is filled by different Participants at different times. For example, the Contractor fills in the Inspection request, and the Consultant fills in the checklist on site.

- Each Form Section has `editable_at`: the list of Workflow Step keys where its fields can be changed. The default is the raiser's Draft and internal Steps.
- Outside those Steps the section is read-only. Once an item is Submitted, the Contractor's sections are locked, which matches the Documents being frozen.
- The Workflow builder checks that every `editable_at` key exists in the Workflow attached to the Type.
- Each change to a section after Draft is recorded in the event trail as a field-level diff, with an internal or shared audience following the rule in [workflow-engine.md §5.1](workflow-engine.md).

Action Forms remain the place for per-Transition input: Review Code, comments, "assign to", reasons. The Form holds the content of the Work Item itself.

### Settled 2026-10-05 (part 3)

- **One Participant per Form Section.** Every Step in a section's `editable_at` is held by the same Participant role. Publishing refuses a section that mixes roles, or names a Step key the Type's Workflow doesn't have. After Submit, nobody edits the raiser's sections: a reviewer never changes what it reviews.
- **Who edits:** any Member of the Participant holding the current Step who can see the item, not only the holder of the assignment (the same as the raiser's rule today). For the raiser's Form, changed 2026-10-10 (ADR 0019, below): only the Member holding the Step.
- **Required** fields of a section are checked on any forward Transition out of a Step it names, as when leaving Draft. A Return, a Send Back or a cancel isn't checked.
- **In-progress answers stay with the Participant holding the Step** (V19, ADR 0013). Its saved answers and their `answers_changed` events reach only its Members until the item leaves it (Submit, Code, close). Everyone else reads the answers as they were when the item arrived. **A Send Back discards the in-progress answers** (settled 2026-10-05, RP-299 review; called a Return until ADR 0014): a Send Back out of a Step of a Participant other than the raiser puts every section another Participant fills back to its answers as they arrived, their field times too, and the Transition event's hash covers those answers; that Participant's `answers_changed` events stay its own. When the item comes back, it starts again from the answers as they arrived.
- **Before it is filled,** the raiser sees a section filled by another Participant empty and read-only, marked "Filled in by the Consultant" (by that Participant's Project Role).
- **Revisions** (`create_revision`) clear every section filled by another Participant. The closed item keeps its answers. As built (RP-316, RP-305): `app.create_revision` fills the new Revision with `app.fill_revision`, now executable by nobody else (revoked from the app role), and keeping only the answers whose field the Revision's Form Version has with the same type (§7). Scenario 49 runs in `revision-sections.test.ts` (test-only Form) and `revisions.test.ts` (the MAR Form Version 4).
- **Action Forms built from Forms.** Each Transition's Action Form is a Form schema on `workflow_transition`, rendered and validated by the same engine. Its answers go in the Transition event's payload. Since RP-516 a Transition may instead name a **Screen**, whose pinned Version's schema is copied there at publish, and whose internal fields' answers go in an event of their own (workflow-engine.md §5.7).
  - `reason` is an ordinary required textarea on the Return and Send Back Transitions.
  - The **Internal Note** is not a schema field. It is a fixed element under every Action Form, as System Fields frame a Form, and stays its own `internal` event (V5).
  - **Remarks** (textarea) on the Code Transitions: optional with A, required with C. On MAR Workflow Version 3 (RP-437, product owner 2026-10-11) the Code Screens ask them optional with A only, required with B, C and D. Shared, shown in the item's history, printed in the Documental Record (part 4).
  - **Items to create** (as built, RP-434, WF-11): a close whose outcome creates items (Code B's Comments) has a `table` keyed `items_to_create`; each row becomes one item of the outcome's Type, its cells that Type's answers under the same keys and its first text column the item's Subject (workflow-engine.md §6). Publishing asks for the table (`items_table_missing`).
  - MAR Workflow Version 1's Transitions get schemas equal to today's fixed fields (no change in behaviour, because dev has no real data), and the fixed code goes. Remarks arrive in MAR Workflow Version 2.
  - As built (RP-300): `workflow_transition.action_form` holds the schema (null: none, only the Internal Note). The API lists it with each Transition the viewer may take (`actions.transitions[].actionForm`) and takes the answers as `answers` on the Transition request, checked by `validateAnswers` in complete mode; a refusal is `invalid_action_form` with `fields`, as for the Form. The answers sit at the top level of the Transition event's payload, beside `document_number` and `outcome`. `actionFormProblems` (`action-form.ts`) runs the §7 publish checks less the Built-in Fields', plus `not_in_action_form` (Built-in Fields, `member`, `participant`, `work_item_ref`, files, and checklists whose items ask photos: the payload is read unstripped by everyone who sees a shared event; a checklist with no photos is taken since RP-516, for Screens) and `reserved_key` (`document_number`, `outcome`, `internal_note`). The database refuses keys the schema lacks and missing always-required answers (`app.action_form_fits`).
- **As built (RP-301):** `packages/domain` (`form-sections.ts`) works out a section's Steps (`sectionSteps`: `editable_at`, or the Steps held by the Draft Step's role), which sections the acting Member may change now (`editableSections`, only when `app.can_save_answers` lets them save at all), and which another Participant fills (`sectionsFilledBy`). The api serves the Form as `FormToFill`: with `editableSections` and `filledBy` (the filling Participant's Project Role name). Create and Save draft refuse, with `not_editable` and nothing written, answers that change a section not editable now (`changedOutside`; a calculated field is never counted). The web renders such a section read-only, and one another Participant fills, while it holds no answers, as "Filled in by the Consultant". This check is the api's; the database still decides only who may save and when, which is still the raiser alone while its answers are open.
- **As built (RP-304):** the database now decides into which sections too. `app.can_save_answers` lets, after Submit, any active Member who sees the item, of the Participant holding its current Step, save when a Form Section names that Step (`app.answers_held`); the raiser never does. `app.save_work_item_answers` refuses (`not_editable`) a save that changes a field of a section not editable now (`app.editable_section_keys`, as `editableSections`), keeps those fields as stored, and writes each `answers_changed` event internal to the saver's Participant. The first save after the item arrives keeps the answers as they were in `work_item.data_as_arrived` (never granted); `app.work_item_answers` and `app.work_item_named_answers` serve those to everyone but the holding Participant, and a trigger clears it when the item leaves that Participant or closes. A forward Transition by a Member who may save needs the checked hash (`app.answers_sha256`, now given to whoever may save); the API checks the required fields of the sections naming the Step being left only (`errorsInSections`). A file for a field of a section not editable now is refused (`app.start_document_upload`). A link question, a file field or a checklist in another Participant's section is refused at publish (`not_for_other_participant`, §7): its Links would appear on save, and Documents change in Draft only.
- **As built (RP-309):** the raiser holding an item Sent Back to it (ADR 0014) is held to the same rule for everything it can change there. Its answers already were (`data_as_arrived`). Its Documents (file-field uploads, photos and checklist photos included) and Links (free and `relies_on`) now are too: `work_item.arrivals` counts the item's arrivals at a Participant (and its close), each `document` and `work_item_link` row records the arrival it was added in (`arrival`), and a Link removed during the current arrival is marked (`removed_at`) and deleted when the item leaves. `app.item_row_seen` gives the holding Participant the rows as they are now, and everyone else the rows the item had when it arrived; the RLS on both tables, `app.work_item_links` and `app.work_item_linked_from` apply it. A Link removed and added again during one arrival is the same Link. `app.work_item_submitted` and `app.work_item_linked_from` ask for a Submission Date (Submitted at least once), so a Sent Back item stays in Link search and Linked from (RP-295), and `app.sees_work_item` keeps it visible at the raiser's Steps (visibility.md V1, V19).
- **As built (RP-299 review, `20261102000000_review_fixes.sql`):** a Return out of another Participant's Step discards its answers in `app.take_transition`, from `data_as_arrived` and `work_item.field_times_as_arrived` (kept by the first `app.record_field_times` after the item arrived; never granted). `app.record_field_times` stamps only for a Member who may save (`'recorded'` or `'not_editable'`), and the field-times functions run only as `rabaed_app`. `app.fill_revision` syncs the Revision's link-question Links. `app.action_form_fits` counts an empty object as an answer, as `validateAnswers` does.
- **MAR Form Version 4** adds the **Consultant verification** section, `editable_at: ["consultant_review"]`: Sample checked (yes/no, required), Matches specification (yes/no, required), Verification note (textarea, required when Matches specification is No). The demo: the Contractor sees it empty; the Consultant fills it while the Contractor still sees it empty; the Code C with Remarks; both companies then see the answers.
  - As built (RP-306): migration `20261101000000_mar_form_version_4.sql` publishes Version 4 as Version 3 plus the section `consultant_verification` (before Classification; fields `sample_checked`, `matches_specification`, `verification_note` with `required: { matches_specification = false }`). New MARs pin it; Versions 1 to 3 keep theirs. Its required fields are checked only on a forward Transition out of `consultant_review` (the Code), so the Contractor leaves Draft without them and a Return needs none. `mar-form-v4.test.ts` runs the publish checks against Versions 1 to 3 and the MAR Workflow's Steps (`editable_at`). The demo seed ends one MAR with Code C and Remarks after the Consultant's verification; the Code A MAR has its verification too. Not in the demo: the Revision (`create_revision` is RP-103). Free Links stay the raiser's (`20261101000100_links_raiser_only.sql`, `app.can_change_links`): `can_save_answers` now also lets the Consultant save, which would have let it add a free Link to the Contractor's item.

### Settled 2026-10-10: the Form belongs to the raiser (ADR 0019)

- **Only the holder edits the raiser's Form.** It is edited only by the Member holding the current Step, at the raiser's Steps the Workflow lets edit it, before the item's first Submit. While a Step is pooled, nobody edits it until someone picks it up (workflow-engine.md §5.2). Other Members of the raiser's Company read the Form, with no Save; only a Handover passes it to another Member.
- **Which Steps edit it** is the Workflow's: a Step's `editsForm` (workflow-engine.md §1). Left out, the default is a Step of the Draft Step's Participant role held with the Draft Step's Function Permission: the Draft Step, and the Contractor Engineer Step in Internal Review after a Return (ADR 0020), never the internal reviewer's (the Contractor PM). A Company's own Workflow may set it on its PM Step too.
- **Nobody edits the Form after the first Submit.** Publishing refuses a Workflow that lets it be edited at or after a Submit (`form_edited_after_submit`, workflow-engine.md §1). A change needs a Revision (Code C). **One exception: a Send Back** (ADR 0014), **when the Workflow says so** (ADR 0021). An item Sent Back to its raiser is edited at the raiser's Steps that edit the Form, by their holder, until it is Submitted again, only when the Step the Send Back led to says **After a Send Back: Edit the Form** (workflow-engine.md §1), as a Site Report's "Return for Comment" does. At **Comment only**, the default of every Version saved since, its fields, Documents, attachments, checklist, Links, Trade, Location and Scopes stay as Submitted: the raiser replies with the Transition's comment or an Internal Note and Submits again.
- **As built (RP-580, `20270210000000_after_send_back.sql`; review fixes `20270327000000_after_send_back_review_fixes.sql`):** `app.after_send_back_setting` gives, while a Send Back has the item back at its raiser (Submitted, its current holder the raiser's Participant, the last Transition another Participant took a `send_back`), the `workflow_step.after_send_back` of the Step that Send Back led to, null read as `edit_form` (Versions published before RP-580 keep editing). `app.can_save_answers` lets the raiser's holder save after a Send Back only where it says `edit_form`, so `app.can_change_draft_documents`, `app.can_change_documents`, `app.can_change_links` and the checklist (answers and photos) follow; a refused save, upload or Link is `not_editable`. It holds until the next Submit wherever the raiser moves the item inside its Participant (a Return to the Draft included). Before the first Submit nothing changed. The item page shows the Form, Documents and checklist read-only with no Save, and the raiser's Members a note, "Sent back for comment: reply and Submit it again." (`sentBackForComment`, from `app.sent_back_for_comment`; false for everyone else). Seam 1: `after-send-back.test.ts`.
- **Drafts visible to** is a setting of the Draft Step (visibility.md V1): the author's whole Company (the default) or the author only.
- **As built (RP-514, `20270114000000_holder_edits_form.sql`):** `app.can_save_answers` lets the raiser's answers be saved only by the Member whose assignment is the current one, picked up (never pooled or vacant), at a Step `app.step_edits_form` says edits the Form (`workflow_step.edits_form`, null for the default above; `stepEditsForm` in `workflow-checks.ts` says the same), while the item has no Submission Date or, after a Send Back, while its current assignment is the raiser's. `app.editable_section_keys` gives the raiser's sections wherever it may save, so a Send Back to a raiser Step other than the Draft reopens them too. The item page shows the Form read-only, with no Save, to everyone else (`actions.saveAnswers`). Seam 1: `holder-edits-form.test.ts`.
- **As built (RP-525 review, `20270117000000_raisers_form_review_fixes.sql`):** the "never after the first Submit" holds at run time too, not only through the publish check (Workflow Versions published before RP-514 never had it): once the item has a Submission Date, `app.can_save_answers` lets the raiser's holder save only while the last Transition another Participant took is a `send_back`. **Every Submit checks the Form, whoever takes it**: the PM at Internal Review may not save, yet their Submit is refused `form_incomplete` while a required answer of the sections naming the Step is missing, and the database takes it only with the hash of the answers the api checked (`app.answers_sha256` gives it to the holder of the raiser's current Step as well as to whoever may save; the api reads "may save" from `app.can_save_answers`). **Answer times** (`fieldTimes`, "Saved <time>") are read by every Member of the raiser's Participant, not only the one who may save; another Company never reads them (`app.work_item_field_times`; visibility.md "Creation Date"). `app.step_edits_form` is plpgsql, and it and `stepEditsForm` are tested over the same cases (`packages/domain/src/step-edits-form-cases.json`). Documents and free Links follow the same rule, since `app.can_change_draft_documents` and `app.can_change_links` start from `app.can_save_answers` (Documents still change at the Draft Step only, until RP-515 moves their freeze to the first Submit).
- **The Screens editor** (RP-441, Project → Settings → Screens; ADR 0019): a Project Admin creates a Screen (key, English and Arabic labels), copies a Rabaed Default Screen into the Project (its published Version, published again as Version 1, in one call and one transaction: `createScreen` with `publish`, a refused publish creates nothing), edits an ordered list of fields (text, long text, choice, date, number, checklist without photos, and the named Remarks, Cover Note and "items to create" table), marks each shared or internal and required or not, saves the draft and publishes the next Version. The server's `screenProblems` is the only judge of what may be published; the editor's edits are pure functions on the schema (`apps/web/src/lib/screen-editor.ts`). The page shows which Workflow Versions pin which Screen Version (`GET /v1/projects/:id/screen-pins`), so a published Version is never edited under a running item. Every Project Member reads a published Screen; its draft only Project Admins (V20). The "items to create" table shows its **target Type** and a Project Admin picks it there (decided 2026-10-11): for each outcome of the Project's Types whose follow-up action creates items from the rows, the Type they become, saved as that outcome's `create_items` action on the Project's copy of the set (`PATCH /v1/projects/:id/work-item-types/:code/outcomes/:outcome`, audited as any outcome change), so the Outcomes page and item creation (WF-11) read the same Type. RP-441's field list named Document and Internal Note too; both are left out on purpose: a Document (file) field, because an Action Form holds no files (`not_in_action_form`: its answers sit unstripped in the Transition event every viewer of the item reads); the Internal Note, because it is a fixed element under every Screen (its own `internal` event, V5), not a field a Screen may drop or move. Copying from a Company Library waits for the Library screen (RP-442).
- **Every other Participant answers in its reply Screen** (the Action Form of the Transition it takes), never in the Form; a Screen's fields are each shared or internal to the acting Participant (workflow-engine.md §5.7, visibility.md V5). As built (RP-516): Screens, their Versions, the Workflow Version's pins and internal answers are built; a Transition's Action Form comes from the Screen it names, or still from its own schema (`action_form`, below).
- **Form Sections filled by another Participant are retired** (as built, RP-437, `20270118100000_retire_other_participant_sections.sql`). The MAR Form Version 5 (`apps/admin/forms/MAR.json`, published by `pnpm defaults:publish`) is Version 4 without the Consultant verification, which is now the Consultant Engineer's reply ("Consultant review" Screen, internal) and the Manager's Code ("final verification", shared, pre-filled from the reply; workflow-engine.md §5.7); the Comment's Form Version 2 drops its Resolution section, which is now the Contractor's reply on Resolve (Screen `comment_resolution`). Publishing a Form refuses a section whose `editable_at` names a Step of another Participant (`other_participant_section`, §7; `editable_at` still narrows a raiser's section to some of its own Steps). `app.can_save_answers` lets only the raiser's Member holding the Step save, so a Form Version published before with such a section (MAR Form Version 4, the Comment's Version 1) is read-only there to everyone, its section as it arrived; a Send Back out of another Participant's Step puts nothing back (`app.transition_effects`). The api's `FormToFill` has no `filledBy` any more, and the web no "Filled in by" mark. What the bullets above say of the other Participant's sections (part 3, RP-304, RP-299 review, MAR Form Version 4) is history; V19 now holds for the raiser after a Send Back only (visibility.md).

---

## 5. Languages, dates, numbers

- **Labels** are `{en, ar}`. Rabaed Defaults must have both. Customer Forms need at least one, and the builder warns if the other is missing. More languages can be added to the same map later.
- **Values** are stored as typed (email addresses and phone numbers without the spaces around them; §2.1). They are never translated.
- **The UI** follows the viewer's language and direction (RTL for Arabic), and the Form layout mirrors automatically.
- **Dates** follow the viewer's locale on screen. On the PDF they follow the Project's record language (`ar`, `en` or `bilingual`). Numbers use Western digits unless the Project selects Arabic-Indic digits for Arabic output.

---

## 6. PDF layout

Settled in the RP-23 grilling (2026-10-16, ADR 0023), from the product owner's sample records (MAR, DAR and DAS, A4, Arabic first with English labels): **one Rabaed layout** prints every Documental Record and every Working Copy. What differs between an MAR and a SAR is the Form's fields, never the layout; there are no per-Form or per-Project templates and no paper-matching layouts. Where a sample clashed with visibility.md or the glossary, those won (the Draft-started time, a Revision after Code D, an internal reviewer's own Code). The record is printed from its Record Data only (workflow-engine.md §7).

Every Form Version carries a `pdf` block: its sections' `include`, `width` and `label_override` (§1), `header_fields`, its **Disclaimer** (`disclaimer {en, ar}`, from the Rabaed Default, which a Company may change in its own Forms) and `show_review_duration` (a Form's choice; information, never an SLA, ADR 0023). The record lays out, in order:

**Page 1**
1. **Companies:** the logo, name and Project Role of the Owner and of every Company whose Member acted. A Company without a logo shows its name.
2. **Title block:** the Work Item Type's code and name (ar, en), the Subject, the Document Number with its Revision (always left-to-right); a Revision adds "Revision of ‹number›, closed at Code C on ‹date›".
3. **Parties:** the Project, then the Companies on the item by Project Role (Owner, Consultant, Main Contractor…).
4. **Classification:** the item's Trade among the Project's Trades, then the Built-in and Form fields the Form places here (Scope, sub-scope, hard copy…).
5. **Final decision:** the outcome in large type, its chips (A B C D; for an Inspection Passed, Passed with Comments, Failed; Cancelled has its own), who issued it (name, Position, Company; with the Owner's review, ADR 0022, the Consultant's PM, the Owner's confirmation on its own card), the Submission Date and the reply date, the review duration in days if the Form shows it, the number of Review Comments and the page they start on, and the QR with its **Verification Code**. A Cancelled item shows who cancelled it and the reason; when Rabaed cancelled it because a Company left the Project, "Cancelled by Rabaed: ‹Company› left the Project", with no card for that step.
6. **Reply:** the first lines of the issued Code's Remarks, with "full text, page n".
7. **Approval flow:** every Transition on the path to the outcome, in order: its label, the Member's name, their Company's role, the date and time, and a mark (done, returned for revision, rejected). The first entry, "Prepared", is dated at the raiser's first Transition, never when the Draft was started (visibility.md, Creation Date). Returns and the work around them, Internal Notes, Recommended Codes and a Code the Owner sent back stay out (V7).
8. **The Form:** its sections in Form Version order, plain fields as a label and value grid, tables (a Drawing Register, Items) as tables, checklists as tables with their summary, photos in a grid (`photo_grid`) with captions and when they were taken.
9. **Documents:** the shared Documents with their page counts; their pages follow in the appendix.

**Pages after**
10. **Running header:** the Type badge, Subject, Document Number and Revision, outcome badge.
11. **Review Comments:** the issued reply's comments, each author's card (initials, name, Position, Company, date), numbered, under their headings. An internal reviewer's card says "Reviewed" and shows no Code of their own (RP-615 decides whether it may).
12. **Signatures:** one card per Transition on the path: its number and verb (prepared, submitted, reviewed, approved, confirmed), its label or Code, the Member's name, Position and Company, their Signature as it was then, the date and time, and what they wrote in the Transition's shared Action Form (Remarks, recommendations, a Code B's actions as a numbered list). With Code C, a **Next step** card: "Revision ‹n+1›, by ‹raiser's Company›"; with Code D: "A new submittal replaces this one".
13. **Stamps:** the Stamp of every Company whose Member acted.
14. **Disclaimer:** the Form Version's, in Arabic and English.
15. **Appendix:** every shared PDF and image Document as pages, in Form order and then in the order they were added; other files (DWG, Excel…) attached inside the PDF; above 100 MB in all, files are listed with their fingerprints and stay in Rabaed.

**Every page:** the footer "Issued electronically through Rabaed · Verification Code · page X of Y".

**Languages:** with record language `bilingual` (the default), headings are Arabic with their English label beside them, as in the samples; `ar` prints Arabic only, `en` English only. Dates are Gregorian, with the Hijri date beside them when the Project turns it on (off by default). A **Working Copy** prints the same layout from the shared read, with Companies by name only, no names, Signatures, Stamps or Verification Code, and the Project's watermark on every page.

### PDF Templates

Retired (2026-10-16, ADR 0023): a Form no longer has several PDF Templates, and there are no paper-matching templates. The term now names the one Rabaed layout above (GLOSSARY.md).

---

## 7. Versioning and data compatibility

- A draft `form_version` is edited freely. Publishing freezes it, and new Work Items use the latest published version.
- **Keys are forever.** A key can't be reused for a field of a different type, and the builder enforces this across all versions of the definition.
- **Dropping a field** in a new version doesn't touch items pinned to older versions: they keep rendering with their own schema.
- **A Revision onto a newer Form version** copies values by matching key and type. Values for fields that no longer exist stay visible in the previous revision only. The new revision shows a notice listing them.
  - As built (RP-316, RP-311 review): `app.revision_dropped_fields(item)` (security definer, granted to the app role) returns, for a Revision the caller sees, the fields (key and label) of the revised item's Form Version that the Revision's Version doesn't have with the same type, in schema order, layout fields aside; nothing for an original or an unchanged Version. It reads the two schemas only, never the revised item's answers. `WorkItemDetail.droppedFields` carries them, and the item page lists them under the `versionsChanged` notice, in English and Arabic.

### Which Form a new item gets (as built, RP-554)

- A new item of a Type on a Project is pinned to the latest published Version of **the Project's own Form for that Type**, if the Project has one, else of the Type's **Rabaed Default Form**. A Project gets its own Form when the Company that creates it has a default Form for the Type (RP-517, workflow-engine.md "Company defaults"): it is copied as the Project's Version 1.
- Every new item takes it, whoever raises it: a Company that joins the Project raises on the Project's Form too (nothing of its own is copied in, ADR 0016). So does every command that starts a new item: creating one (and Duplicate), a Revision, a replacement of a rejected item, and the items an outcome creates (Code B Comments).
- Items already raised keep the Version they are pinned to (ADR 0006): a Form the Project gains later, or a newer Version of it, reaches new items only.
- `app.new_item_form_version(project, type)` answers it, and `app.create_work_item` refuses any other Version (`form_version_not_latest`); the api's new-item Form reads the same function. It is security definer, and names the Project's own Form only to a Member on that Project; anyone else gets the Rabaed Default's, never another Project's Form (V13, V18). Who reads a Form is unchanged.
- A Project has one Form of its own per Type today (the copy). Nothing in the schema stops a second; if one appears, new items take the newest Form that has a published Version.

### Publish-time validation

- Keys are unique, and conditions and formulas reference existing keys with no circular references.
- Required fields are not inside sections that can never be visible.
- Every checklist has items.
- `editable_at` Step keys exist in the attached Workflow (§4).
- `pick_list` sources exist in the Project, or will be created when a library Form is copied into it.

As built (RP-271): `publishProblems(schema, earlierVersions)` in `packages/domain` (`form-publish.ts`) runs the checks of part 1. Each problem names a section or field key and a code:
- `duplicate_key`: a key used twice. Sections and fields share one set of keys, layout fields included.
- `unknown_reference`: a `visible_if` or conditional `required` reads a key that holds no answer (missing, a layout field or a section).
- `unknown_reference` also covers a formula that reads a key holding no number: one that isn't a `number`, `currency` or `calculated` field, or a `sum` over a column that isn't a table's `number` or `currency` column (RP-283).
- `condition_cycle`: whether a section or field shows depends, in the end, on its own answer, through rules and the formulas of the calculated fields they read. A conditional `required` hides nothing, so it can't make a cycle.
- `formula_cycle`: a calculated field whose formula reads itself, directly or through other calculated fields (RP-283).
- `required_never_shown`: a required field that no answers can ever show, because its section's rule or its own can never hold. A rule never holds when no combination of the Yes/No and choice answers it reads makes it hold, and a field that never shows reads as cleared. A rule over free text, numbers or dates is taken to be able to hold.
- `built_in_missing`, `built_in_repeated`, `built_in_optional`, `built_in_hidden`: the Built-in Fields (§1).
- `key_type_changed`: an earlier published Version used the key for another type, even if a later one dropped it.
- `unknown_option_list` (RP-282): an `option_list` field, or a table column, names an Option List that doesn't exist. `publishFormVersion` passes the ids of the lists that exist; `publishProblems` without them doesn't look.
- `unknown_step` and `mixed_roles` (RP-301): a section's `editable_at` names a Step key the Workflow doesn't have, or Steps held by two different Participant roles. `publishFormVersion` passes the Steps of the latest published Workflow Version of every Type that uses the Form; `publishProblems` without them doesn't look.
- `unknown_link_type` and `unknown_link_outcome` (RP-82, §2.13): a link question's `accepts` names a Type that doesn't exist, or an outcome none of the Types it names has (no Type at all, when it names none). `publishFormVersion` passes the Rabaed Default Types and their outcomes; `publishProblems` without them doesn't look.
- `other_participant_section` (RP-437, ADR 0019; it replaced `not_for_other_participant`, RP-299 review, which refused only some field types there): a section whose `editable_at` names a Step of a Participant other than the raiser. Before RP-437: a section filled by a Participant other than the raiser (its `editable_at` Steps are held by another role) holds a link question (`work_item_ref`), attachments, photos or a checklist. A link question creates Links on every save, which everyone sees at once, and files, photos and checklist evidence change in Draft only. Checked with the Workflows, like `unknown_step`.

`formSchemaProblems(schema)` runs the same checks for a first Version. In this part Rabaed publishes its Default Forms as data. `pnpm form:publish --type MAR --schema file.json` (Rabaed Admin's `publishFormVersion`, run with the migrator connection) checks the schema against the Form's published Versions, then publishes the next Version. A refused schema is listed problem by problem, and nothing is published. The database can't run these checks, so it is the only way to publish: a Version written or published by plain SQL (as the MAR Form Version 1 migration did) skips them. The MAR Form Version 2 is published by migration too, so that every environment has it; a seam test runs the checks on it instead (§2.6).

---

## 8. Validation, drafts, reporting

- **One validator**, generated from the schema, runs in the browser (instant feedback) and on the server (authoritative). Save as draft skips "required" checks but not type checks.
  - It lives in `packages/domain` (`validateAnswers`, modes `draft` and `complete`), so the server runs it in the api. The database keeps who may write answers and when, and `take_transition` lets an item move on while its answers are open (leaving Draft, and the Submit; not a cancel or a Return) only with the hash of the answers the api found complete. Answers changed in between are refused with `form_not_checked` (RP-262, RP-268).
- **Autosave** runs every few seconds while editing a Draft. Each save records the values plus `updated_at` per field, so the offline mobile app (ADR 0004) can later merge field by field.
  - Settled 2026-10-05 (part 3): autosave runs **in Draft only**, where saves write no diff events. When two Members edit at once, the later save of a field wins, and the other editor sees "changed by X just now" on it. The "Save" button stays, showing when the item was last saved. After Draft, only the button saves, so each `answers_changed` event is one deliberate save.
  - The button's words (RP-518, RP-511 decision 10; `apps/web/src/lib/save-button.ts`): **"Save Draft"** only on the create form, before the item exists. On a saved Draft (no Document Number yet, a Revision Draft included) it is **"Save and close"**, the primary button: always enabled (only while a save is out it waits), it saves anything pending, then goes to the Project's Submittals list; a refused save stays on the page. Everywhere else it is **"Save"**, enabled once something has changed. It sits at the end of the Form, right-aligned above a top border.
  - Answer times and the Creation Date (RP-392, visibility scenarios RP-392-1 and RP-392-2): `app.work_item_field_times` is the one read that hands out answer times, to the API's `fieldTimes` and so to "Saved <time>" and the autosave merge. Once the item is numbered it returns any time earlier than the item's own `numbered_at` as `numbered_at`, so a Draft's start time never reaches anyone after the Document Number is issued, after a Send Back too; a Revision is judged by its own `numbered_at`. In Draft it returns the stored times. The stored `work_item.field_times` are unchanged, for audit, and the app role can't read the column.
- **Reporting** (moved out of part 3 on 2026-10-05: built with the first feature that filters or charts by a Form field, such as RP-25 or RP-33): `reportable` fields are copied on each save into `work_item_field_value (work_item_id, field_key, value_text, value_num, value_date)`. Dashboards and filters query this table, which is under the same row-level security as `work_item`. A GIN index on `work_item.data` covers ad-hoc search.

---

## 9. Builder

- A palette of field types. Drag sections and fields, and edit the selected element in the properties panel: key, labels in both languages, validation, conditions, `editable_at`, PDF options.
- **Previews:** English, Arabic (RTL), phone width, and the **PDF preview** rendered with sample data.
- "Insert checklist template…" and "Insert section from library…" copy from the library.
- "Validate" runs the §7 checks live, and "Publish" runs them again server-side.

---

## 10. Option Lists, Saved Fields and Libraries (settled 2026-10-03)

- **Option Lists** hold choices with up to three levels. Their contents are **live**: adding or renaming an option changes the choices in every Form that uses the list, with no new Form Version. A removed option disappears from new choices, but stays on Work Items that already chose it, marked as retired.
  - As built (RP-279): `option_list` and `option` (`packages/db`), Rabaed Defaults. Each option has a stable `value` (lower-case letters, digits, `_`, `-`; unique in its list), EN/AR labels and a `retired` flag; its list, parent and value never change, and nothing is ever deleted. Only Rabaed Admin's role writes them: create a list, add an option at any level, rename, retire, restore, each with a reason in `admin_action` (`create_option_list`, `add_option`, `rename_option`, `retire_option`, `restore_option`). The customer api only reads them (`GET /v1/option-lists`, every Member); `option_list` fields and table columns read them live (§2.3).
- **Saved Fields** live in the **Field Library**. Inserting one **copies** its settings (labels, type, rules, Option List) into the Form, because published Form Versions never change. "Update to the latest Saved Field" in the builder publishes new Form Versions.
- **Libraries.** Rabaed Defaults are visible to every Company. Each Company's Library (Forms, Saved Fields, Option Lists, Trade and Scope lists) is private (visibility V18). A Project takes its Forms from the Rabaed Defaults or from any Participant's Library, once that Participant's Authorized Person has agreed to offer them. Taking or copying always makes an independent copy that records where it came from.
- **Trades and Scopes.** A Project copies the Company's Trade → Scope → Sub-scope lists when it's set up. Later changes reach the Project only when its Project Admin pulls them in, because Visibility grants hang on those values. Locations stay per Project.

## Delivery order (settled 2026-10-03)

The full engine is built in five parts. Each part is merged and usable before the next starts.

1. **Core:** the schema and the shared validator (browser and server), Versions (draft, publish, pinned), the System Fields frame (Subject, Document Number, Attachments; Links come in part 2) and the Built-in Fields, and the field types `text`, `textarea`, `email`, `phone`, `number`, `currency`, `date`, `datetime`, `time`, `yes_no`, `select`, `multi_select`, `member`, `participant`, plus the layout types. Field rules: required and `visible_if`.
   - Every Project uses Rabaed Default Forms. The first one is the **MAR Form Version 1**, which replaces today's hard-coded description.
   - Answers are edited by the raiser's Company in Draft and its internal Steps, and are read-only from Submit onwards. Changes after Draft are recorded as field-level diffs.
   - An explicit "Save draft" button. "Required" is checked only when the item leaves Draft.
   - The demo is re-seeded: dev has no real data to migrate.
2. **Rich fields**, in two specs (settled 2026-10-03):
   - **2a, fields inside one item:** Option Lists and the `option_list` type, `table`, `calculated`, named `attachments` and `photos` fields, and `checklist` without "create Snag". Publishes the MAR Form Version 2.
     - **Option Lists** are Rabaed Defaults until part 5. Rabaed Engineers edit them in Rabaed Admin, each edit logged in `admin_action` with a reason. Their contents are live in every Form that uses them (§10).
     - **Table columns** can be `text`, `number`, `currency`, `date`, `yes_no`, `select` or `option_list`. They can't hold files, people, checklists or tables. A table can set minimum and maximum rows, and a number or currency column can show a total.
     - **`calculated`**: the result is shown live, recalculated by the server on every save, and stored with the answers (so it's in the hash). Operations are `+ − × ÷` and `sum(table.column)`, rounded to the field's decimals. A division by zero or a missing input leaves it empty, so a required calculated field then blocks leaving Draft.
     - **`photos`**: camera capture on phones, several per field. EXIF time and GPS are kept and shown to everyone who sees the item (V13). The burned-in stamp comes with part 4.
     - **`checklist`**: items written in the Form (checklist templates come with Libraries in part 5); answer sets `Yes / No / N/A` or `Pass / Fail / N/A`; comment and photo off, optional or required on a negative answer; a summary such as "18 Pass / 2 Fail / 1 N/A".
     - **MAR Form Version 2:**
       - manufacturer (text), model, specification section, description
       - an **Items** table (fixture type, description, quantity, unit, with a total quantity)
       - **Datasheet** (PDF, required), **Test certificate** (optional), **Sample photo** (`photos`, optional)
       - Trade, Location, Scopes
   - **2b, between items:** Links and `work_item_ref`, with the E1 visibility rule, right after 2a. Until part 4, a link to an item the viewer can't see shows only its Document Number and Subject. The "open its Documental Record" action is added with part 4. Settled 2026-10-05:
     - **One Link, two ways in:** free Links (`related`) in the Links System Field, and the items chosen in a `work_item_ref` field (`relies_on`). Both are `work_item_link` rows and both show in the Links System Field. `raised_from` comes with the Snag List.
     - **What can be linked:** any number of items in the same Project that the linker can see and that have been Submitted at least once, also while Sent Back to the raiser (settled 2026-10-06, RP-295). No item that has never left its raiser, no limits by Type or outcome.
     - **How a Link looks:** the Document Number and Subject, the same everywhere. Opening it shows the item, or, for an item the viewer can't see, only that they may not see its details.
     - **Linked from:** the linked item lists every item that has been Submitted and links to it, with number and Subject even when the viewer can't see it (E3).
     - **Who changes Links:** the raiser's Company, while it can still edit the answers (until Submit, and again while the item is Sent Back to it); then they are frozen with the answers. Adding a Link notifies nobody.
     - **No required Links on the Type:** `required_links` is dropped. A Form can make a `work_item_ref` field required instead; no Rabaed Default Form does.
     - **MAR Form Version 3** adds an optional **Related submittals** `work_item_ref` field. The demo shows a MAR linking an approved MAR, and a Contractor who sees only its number and Subject.
   - Before 2b, answers are read only through the stripping function (ADR 0012, RP-275).
3. **Who fills what:** `editable_at` per Form Section, Action Forms built from Forms, and autosave with per-field timestamps (settled 2026-10-05, §4 and §8). Publishes MAR Form Version 4 and MAR Workflow Version 2. The reporting table moved to its first reader.
4. **PDF output:** the Documental Record's one layout (§6, ADR 0023), the Form's Disclaimer and review-duration settings, and optional Hijri dates per Project (part 1 shows Gregorian only). Built in the Signing epic (RP-23).
5. **The builder and Libraries:** the Form builder, the Field Library (Saved Fields), Company Libraries with "Copy to my Library" and offering to a Project (V18 tests), and the Company Trade/Scope lists with "pull updates".

Later, with their own modules:
- Package, which isn't a System Field, comes with the Package feature (RP-26).
- A checklist's "create Snag on a failed item" comes with the Snag List module.
- Custom Visibility Dimensions and their Built-in Fields are parked (RP-274) until a Project needs one.

## Settled (2026-09-26)

1. **Hijri dates:** optional per Project, shown beside the Gregorian date and never replacing it.
2. **No internal-only fields.** Everyone with access to a Work Item sees its whole Form. Only Internal Communication (notes and back-and-forth inside one Participant) is hidden.
3. **PDF Templates:** several per Form, with Rabaed Defaults plus paper-matching templates built by Rabaed Engineers. Superseded 2026-10-16 (ADR 0023): one Rabaed layout for every record (§6).

## Former open questions

1. **Hijri dates:** should date fields and the PDF also show the Hijri date alongside the Gregorian one? Government Owners often expect it. *Recommended: optional per Project, shown beside the Gregorian date and never replacing it.*
2. **Internal-only fields:** do some fields need to be visible only to the raising Participant, even after Submit? An example is a cost or supplier price the Contractor keeps for itself. *Recommended: yes, as a section-level `internal` flag. Those values stay out of every other Participant's view and out of the Documental Record.*
3. **PDF matching existing paper forms:** will customers insist their PDF looks exactly like their current paper template (their own layout and logo positions)? *Recommended: v1 configuration as in §6, and a visual PDF template designer later if customers demand it.*
