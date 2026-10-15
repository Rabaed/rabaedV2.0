# Puck as Rabaed's Form builder: prototype verdict (RP-19)

PROTOTYPE, throwaway. Branch `prototype/puck-form-builder`, 2026-10-15. Puck `@puckeditor/core` 0.23.0 (MIT), pinned exactly.

**Question.** Does Puck work as Rabaed's Form builder in Arabic (RTL) with our own field components from `packages/ui` form-engine (text, select, a checklist), dragging fields within and between sections, and saving back to a `formSchema` that passes `formSchema.parse` and `publishProblems`?

**Verdict: works, with the gaps below.** None of the gaps is a reason to fall back to dnd-kit.

## How to run it

1. `pnpm install`
2. `pnpm prototype:puck` (Storybook on port 6116), then open *Prototypes / Puck form builder*. Use the toolbar's Language switch for EN/AR. In Puck's header, **Preview** switches only the canvas language, and **Save** runs the adapter and our checks. The panel under the editor shows the resulting `formSchema`, `formSchema.parse` and `publishProblems`, live and as last saved.
3. With Storybook running: `node packages/ui/scripts/puck-prototype-check.ts`. It drags with a real mouse (Playwright) in both languages, writes `report.json` and the screenshots in this folder.

## What was built

- `form-builder.prototype.tsx`: the Puck config, the adapter and the builder.
  - Blocks: a **Section** with a `fields` slot; **Text**, **Select** and **Checklist**; the Built-in **Trade**, **Location** and **Scopes**.
  - Root is a `sections` slot that allows Sections only. A Section's slot allows field blocks only.
  - Each field block's `render` is our `FormRenderer` for that one field, so the canvas shows what Members see.
  - Property editors are Puck fields. Our own custom fields: the bilingual (EN LTR / AR RTL) label editor and the key editor. Puck array fields: select options and checklist items.
  - Built-in Fields have `permissions: { delete: false, duplicate: false, insert: false }`.
  - Adapter: `toFormSchema(data)` and `fromFormSchema(schema)`. Puck's `Data` is never stored.
- `form-builder.prototype.stories.tsx`: a seeded Pour inspection Form.

## Results (real mouse, `report.json`)

Each language started from `general: trade, location, scopes, subject_note | inspection: concrete_grade, pour_check`.

| Step | EN | AR (RTL) |
|---|---|---|
| Within a section, up (Location above Trade) | ✅ | ✅ |
| Within a section, down (Trade below Scopes) | ✅ | ✅ |
| Between sections, down (Pour reference under the checklist) | ✅ | ✅ |
| Between sections, up (Concrete grade above Scopes) | ✅ | ✅ |
| Insert from the palette (Select above the checklist) | ✅ `select_ce120e` | ✅ `select_bccd7f` |
| Save: `formSchema.parse` | passes | passes |
| Save: `publishProblems` | none | none |

Also checked by hand in the browser pane:

- Round trip `formSchema → Puck → formSchema` is deep-equal for the seeded Form.
- A new block gets a valid, unique key from Puck's id (`resolveData` on insert).
- A Text dropped between sections lands in the nearest section, and a Section dropped inside a section lands at the top level. The slot `allow` rules keep the shape sections → fields; Puck moves the drop rather than refusing it.
- Editing a key to one already used shows `publishProblems: duplicate_key` at once. Clearing an Arabic label makes `formSchema.parse` fail at once (`…label.ar: Too small`). Our checks run on every change, not only on Save.
- The Built-in Trade's action bar has only "Select parent", with no Duplicate or Delete. It can still be dragged to another section.
- Editor in Arabic with the canvas in English (and the other way round) works. Puck's Dictionary API translates every editor string we saw.

## Screenshots

`en-1-builder.png`, `ar-1-builder.png`: the checklist is selected, with our bilingual editor and Puck's array editor for its items. `*-2-select-options.png`: the select's options. `*-3-preview-other-language.png`: the canvas in the other language. `*-4-state.png`: the saved schema and the checks.

In Arabic, Puck's chrome mirrors: navigation and palette on the right, properties on the left, header reversed, and Arabic strings throughout. The canvas is RTL, with our Arabic font and components.

## Gaps (for the spec)

1. **Some icons don't mirror in RTL.** The breadcrumb chevron (قسم › قائمة فحص) still points right, and Undo/Redo and "Select parent" keep their LTR arrows. Fix with CSS (`[dir=rtl] … { transform: scaleX(-1) }`) or Puck `overrides`.
2. **Drops are moved, not refused.** A drop that a slot's `allow` forbids goes to the nearest allowed zone instead. Acceptable, but say so in the spec.
3. **Error paths are schema paths** (`sections.0.fields.1.label.ar`). The real builder must map them back to the block (section and field index → Puck id) to highlight it, and must map `publishProblems` keys to blocks.
4. **Built-in Fields still show in the palette**, greyed out (`insert: false`). Hide them, or show them as "already in the Form".
5. **Words come from the prototype file.** The real builder takes Puck's Dictionary and our block and field labels from `apps/web` messages (lint `rabaed/no-ui-translations`).
6. **The bilingual editor needs care.** Its `onChange` builds `{en, ar}` from the props it last rendered with. Two changes in one tick lose one of them (seen only from a script; typing is fine). Use a functional update in the real one.
7. **An empty section passes `publishProblems`.** This is not a Puck question: decide whether publishing should refuse it.
8. **Tests need real pointer input.** `PointerEvent`s dispatched from page JavaScript drove Puck's drag (dnd-kit) unreliably: some moves did nothing, and one insert happened twice. Playwright's mouse (CDP) is exact and repeatable. Story tests that drag must use real input.

**Not tested here:**
- keyboard drag and screen-reader use of Puck's chrome (WCAG 2.2 AA is required);
- touch (phone/tablet);
- bundle size and load time on a Next.js route;
- a large Form (100+ fields);
- conditions, table columns and calculated formulas (our own editors whatever the library);
- Puck's own `Outline` panel drag in RTL.
