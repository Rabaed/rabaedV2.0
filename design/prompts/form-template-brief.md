# Brief: write a Rabaed Form template as JSON

Paste this whole file into Claude (Chat) before describing a form. It makes Claude answer with one JSON file that Rabaed can publish as it is, with no conversion. Checked against the schema in `packages/domain/src/form.ts` on 2026-10-15.

---

You are writing a **Form** for Rabaed, a bilingual (Arabic and English) construction management platform in Saudi Arabia. A Form is the middle part of a Work Item (for example a Material Approval Request): the fields the person raising it fills in. Answer with **one JSON object**, in exactly the format below, and nothing else except the "Not included" list at the end, when there is one. Name it after the Work Item Type's code, such as `MAR.json`.

## The rules that make a Form publishable

1. **Shape:** `{ "sections": [ { "key", "title", "fields": [ … ] } ] }`. At least one section; a section may have no fields.
2. **Keys** (`key` of sections, fields, options, checklist items, table columns): lowercase English, starting with a letter, then letters, digits and `_`, at most 64 characters, such as `supplier_name`. Every key is unique within the whole Form. Keys never change once published, so make them meaningful.
3. **Every text a person reads has both languages:** `{ "en": "…", "ar": "…" }`, each 1–200 characters (help and instructions up to 1000). Arabic is Modern Standard Arabic. Digits are always Latin (0–9), in Arabic text too.
4. **Built-in Fields: exactly once each, somewhere in the Form:** `{ "key": "trade", "type": "trade", "label": …, "required": true }`, the same for `location` (`"required": true`) and `scopes` (`"required": false` or `true`). Their `key` equals their `type`. They can't be hidden, so they never get `visible_if`.
5. **Don't add the System Fields:** Subject and Document Number sit above every Form, and Attachments and Links below it. Rabaed adds them; a Form that repeats them is wrong.
6. **No dates of obligation:** Rabaed shows no due dates, deadlines or SLAs. Never add a "due date", "required by" or "overdue" field.
7. `required` is `true`, `false` (the default) or a condition (below). It is checked when the item leaves Draft.

## Field types

Every field has `key`, `type`, `label` (both languages), and may have `help` (both languages), `required` and `visible_if`.

| `type` | What it is | Extra properties |
|---|---|---|
| `text` | One line | `maxLength` (up to 2000; 500 when unset) |
| `textarea` | Several lines, no formatting | `maxLength` (up to 20000; 4000 when unset) |
| `number` | A number | `unit` (e.g. "m²"), `min`, `max`, `decimals` (0–6) |
| `currency` | An amount of money | `currency` (ISO code, `"SAR"` when unset), `min`, `max` |
| `calculated` | Worked out from other numbers, read-only | `formula`, `decimals` (2 when unset), `unit` |
| `email`, `phone` | Checked for format | none |
| `date`, `datetime`, `time` | A date, a moment, a time of day | none |
| `yes_no` | Yes or No | none |
| `select` | One choice | `options`: `[ { "value": "key", "label": {en, ar} } ]`, 1–200, values unique |
| `multi_select` | Several choices | `options`, as `select` |
| `member` | A person of the filler's own Company on the Project | none |
| `participant` | A Company on the Project | none |
| `approved_supplier` | A supplier from the Project's Approved Supplier List, for the item's Trade | none |
| `work_item_ref` | Links to other Work Items of the Project (e.g. the approved supplier's SAR) | none |
| `table` | Repeating rows | `columns` (1–30), `minRows`, `maxRows` (up to 200) |
| `attachments` | Named files, such as "Datasheet" | `contentTypes` (e.g. `["application/pdf"]`), `minFiles`, `maxFiles` (up to 50) |
| `photos` | Photos taken with the phone (time and place kept) | `minFiles`, `maxFiles` |
| `checklist` | Check items, each answered | `items` (1–100) |
| `heading` | A heading inside a section (no answer) | `text` (both languages); no `label` |
| `instructions` | A paragraph of guidance (no answer) | `text` (both languages, up to 1000); no `label` |
| `divider` | A line (no answer) | none; no `label` |

**Table columns:** each has `key`, `label`, `type` and `required`. The type is one of `text` (`maxLength`), `number` (`unit`, `min`, `max`, `decimals`, `"total": true` for a total row), `currency` (`currency`, `"total": true`), `date`, `yes_no`, `select` (`options`). No files, people or checklists in a table.

**Checklist items:** `{ "key", "text": {en, ar}, "answers": "pass_fail_na" | "yes_no_na", "comment": "off" | "optional" | "required_on_negative", "photo": "off" | "optional" | "required_on_negative" }`. The defaults are `pass_fail_na`, comment `optional`, photo `off`. "Negative" is Fail or No.

**Don't use `option_list`:** it needs the id of a list held in Rabaed. Use `select` with its options written out; Rabaed turns long shared lists into Option Lists later.

## Conditions (`visible_if`, conditional `required`)

A condition reads other fields of the same Form, by key:

- one comparison: `{ "field": "key", "op": "=", "value": "option_value" }`. The operators are `=`, `!=`, `>`, `>=`, `<`, `<=` (a number or a date text), `in`, `not_in` (a list of values), `empty`, `not_empty` (no `value`). A `yes_no` field compares with `true` or `false`;
- or combined: `{ "all": [ … ] }`, `{ "any": [ … ] }`, `{ "not": … }`.

A hidden field isn't checked, and its answer is cleared. Sections can have `visible_if` too. A field must never decide its own visibility, directly or through others.

## Formulas (`calculated`)

Numbers with Latin digits, keys of `number`, `currency` or `calculated` fields, and `sum(table_key.column_key)` over a table's number or currency column, joined by `+ - * /` and parentheses. Example: `"formula": "sum(items.quantity) * unit_rate"`.

## Example

```json
{
  "sections": [
    {
      "key": "supplier",
      "title": { "en": "Supplier", "ar": "المورد" },
      "fields": [
        { "key": "trade", "type": "trade", "label": { "en": "Trade", "ar": "التخصص" }, "required": true },
        { "key": "location", "type": "location", "label": { "en": "Location", "ar": "الموقع" }, "required": true },
        { "key": "scopes", "type": "scopes", "label": { "en": "Scopes", "ar": "نطاقات العمل" } },
        { "key": "supplier_name", "type": "text", "label": { "en": "Supplier name", "ar": "اسم المورد" }, "required": true, "maxLength": 200 },
        { "key": "is_local", "type": "yes_no", "label": { "en": "Made in Saudi Arabia", "ar": "صناعة سعودية" } },
        {
          "key": "origin_country", "type": "text",
          "label": { "en": "Country of origin", "ar": "بلد المنشأ" },
          "visible_if": { "field": "is_local", "op": "=", "value": false },
          "required": true
        }
      ]
    },
    {
      "key": "inspection",
      "title": { "en": "Sample check", "ar": "فحص العينة" },
      "fields": [
        {
          "key": "sample_checks", "type": "checklist",
          "label": { "en": "Sample checks", "ar": "فحوصات العينة" },
          "items": [
            { "key": "matches_spec", "text": { "en": "Matches the specification", "ar": "مطابق للمواصفات" }, "comment": "required_on_negative" },
            { "key": "certificate_valid", "text": { "en": "Certificate is valid", "ar": "الشهادة سارية" }, "answers": "yes_no_na" }
          ]
        },
        {
          "key": "items", "type": "table",
          "label": { "en": "Items", "ar": "البنود" },
          "minRows": 1,
          "columns": [
            { "key": "description", "type": "text", "label": { "en": "Description", "ar": "الوصف" }, "required": true },
            { "key": "quantity", "type": "number", "label": { "en": "Quantity", "ar": "الكمية" }, "total": true }
          ]
        }
      ]
    }
  ]
}
```

## Before you answer, check

- [ ] Only JSON, one object, valid (no comments, no trailing commas).
- [ ] `trade`, `location` and `scopes` each appear exactly once; `trade` and `location` are required.
- [ ] No Subject, Document Number, Attachments or Links field; no due date.
- [ ] Every key is unique and lowercase `snake_case`; every label, title, help and text has `en` and `ar`.
- [ ] Every `visible_if` and formula names keys that exist in this Form.
- [ ] No `option_list`; long choice lists are `select` options.

If the form you're given has something this format can't hold (a signature box, a stamp, a drawing to mark up, a due date), leave it out and list it after the JSON under "Not included", one line each.
