# Form builder libraries: research for RP-19

Researched 2026-10-15. Facts come from npm registry metadata (`registry.npmjs.org`, `api.npmjs.org` weekly downloads), the GitHub API (`pushed_at`, licence, stars), bundlephobia, and each vendor's official docs. Each claim links its source. Treat prices as list prices on that date.

## What we need

Rabaed runs on Next.js `^16.3.6` and React `^19.3.0` (`apps/web/package.json`). The builder has five jobs:

1. It edits our `formSchema` (`packages/domain/src/form.ts`). That schema has sections, then fields: about 30 field types, including `table` (typed columns), `checklist` (answers, comment and photo rules), `calculated`, `option_list` (a list UUID and a depth), built-in fields (`member`, `participant`, `approved_supplier`, `work_item_ref`), layout fields (`heading`, `instructions`, `divider`), bilingual text, and `visible_if` conditions on sections and fields.
2. Our engine stays the source of truth. The shared validator, publish checks, `visibleFields` and `FormRenderer` keep that job. The builder only produces a schema that we parse with zod.
3. The canvas and preview should use our own field components, so the preview matches what Members see.
4. Arabic and English, RTL, Latin digits.
5. Later, a PDF template is made from the Form and filled with a submittal's answers.

## Comparison

Columns: **Builder licence** is the licence of the drag-and-drop designer, which is the part we would ship. **Last release** is the npm `latest` publish date. **Size** is bundlephobia's min+gzip for the npm entry, with peer dependencies left out.

| Candidate | Builder licence | Last release / activity | React 19 / App Router | RTL / Arabic | Size (gzip) | Our components on canvas? | Output format, and mapping to `formSchema` | PDF |
|---|---|---|---|---|---|---|---|---|
| **SurveyJS** Form Library + **Survey Creator** | Form Library is MIT. **Survey Creator is commercial**: Basic tier, **$589 per developer one-time**, plus $239 a year for updates [[pricing]](https://surveyjs.io/pricing). Licences are perpetual and per developer, with no limit on end users. Redistributing the products or building a competing product is not allowed [[licensing]](https://surveyjs.io/licensing). npm licence field: `SEE LICENSE IN LICENSE`. | 3.2.1, 2026-10-13. Repo pushed 2026-10-15; 124k downloads a week [[npm]](https://www.npmjs.com/package/survey-creator-react) | Peer `react ^16.5 \|\| … \|\| ^19.0.0`. Client-only, so it needs a `"use client"` wrapper. | Creator UI comes in 30+ languages, RTL ones included, and the locale has an `rtl` flag [[FAQ]](https://surveyjs.io/faq/localization). Some RTL bugs were fixed in 2024–25 (e.g. [#6793](https://github.com/surveyjs/survey-creator/issues/6793)). One is still open: [#6566](https://github.com/surveyjs/survey-creator/issues/6566), the Translations tab layout. | Creator wrapper is 17 kB, but `survey-creator-core` (very large) and `survey-core` come on top. In practice it is the heaviest of these options. | **Partly.** You register custom question types and React renderers (`ReactQuestionFactory`) [[docs]](https://surveyjs.io/form-library/documentation/customize-question-types/third-party-component-integration-react). The canvas otherwise draws SurveyJS questions. | Survey JSON: `pages → elements` (`panel`, `matrixdynamic`, `checkbox`…). `visibleIf` is a **string expression**, so we would need a parser into our condition model. Bilingual strings use `{default, ar}`. This is the closest model to ours, but it is a second form model running beside our engine. | **PDF Generator is commercial**, PRO tier, $1,059 per developer [[pricing]](https://surveyjs.io/pricing) |
| **Form.io** (`@formio/js` + `@formio/react`) | `@formio/js` is **MIT and includes `Formio.builder`** [[repo]](https://github.com/formio/formio.js). The **Enterprise Form Builder Module**, premium components (File, Signature, Nested Form) and others each need a paid library licence [[library licences]](https://help.form.io/admin/licensing/library-licenses). | `@formio/js` 5.7.0, 2026-10-09; `@formio/react` 6.2.2, 2026-10-09 | `@formio/react` peer `react >=17`. The help site's version table is inconsistent [[frameworks]](https://help.form.io/dev/javascript-development/frameworks). | The RTL request [#4495](https://github.com/formio/formio.js/issues/4495) was closed **not planned** (2024). RTL needs our own CSS. | **436 kB**. Bootstrap-styled DOM, not React. | **No.** Components are formio.js classes that render their own DOM, not React components. | Form.io JSON: nested `components[]` (`panel`, `datagrid`, `select`…), with `conditional` blocks or JavaScript logic. Mapping is hard, and the JS conditions cannot be expressed in our model. | PDF needs the commercial platform's PDF server and counts against licence limits [[help.form.io]](https://help.form.io/llms-full.txt) |
| **FormEngine** (Optimajet, `@react-form-builder/*`) | Core renderer is MIT. **Designer is commercial** (EULA): **$5,999 Enterprise for a public SaaS**; StartUp ($1,299) and Business ($2,999) are for internal use only. Embedding the Designer for our customers may need **Custom/OEM** terms [[pricing]](https://formengine.io/pricing). | 11.1.0, 2026-10-09; 247 stars; about 1.6k Designer downloads a week | Peer `react … \|\| ^19` | Vendor says there is an RTL toggle [[ComponentSource]](https://www.componentsource.com/product/optimajet-formengine/features). No developer docs found. | Designer 28 kB plus core 54 kB, with its UI kit on top | **Yes.** It is built around registering your own React components. | FormEngine JSON tree. The mapping is moderate. | None documented |
| **react-form-builder2** | MIT | 0.20.3, **2025-05-30** (16 months ago); 502 stars | Peer `react >=18.3.1` | Nothing documented | **340 kB** | Limited | Flat list of elements; no sections or conditions | No |
| **Puck** (`@puckeditor/core`, formerly `@measured/puck`) | **MIT**, all of it [[repo]](https://github.com/puckeditor/puck). Hosted extras (AI plugin, cloud client) are separate optional packages. | 0.23.0, 2026-08-07; repo pushed 2026-10-15; 13.5k stars; 327k downloads a week. Still pre-1.0. | Peer `react ^18 \|\| ^19`; has an official Next.js App Router recipe | RTL issue [#595](https://github.com/puckeditor/puck/issues/595) closed as completed (2025-01). **v0.23 added a Dictionary API to translate the editor UI** [[releases]](https://github.com/puckeditor/puck/releases). | **165 kB** | **Yes, by design.** Each block is `{fields, render}` using our React components. Custom fields can replace the property editors. | `Data = {root, content: ComponentData[], zones}`; each component is `{type, props:{id,…}}`, and slots nest children [[data model]](https://puckeditor.com/docs/api-reference/data-model/data). Section blocks with a field slot map **1:1 to sections → fields**. Conditions, table columns and checklist settings would be **our own custom property-panel fields**. | No |
| **Formily + Designable** (Alibaba) | MIT | `@designable/react` 1.0.0-**beta.45, 2022-02-28**; repo last pushed 2025-04. Formily repo last pushed 2025-06. | Designable peer `react 16.x \|\| 17.x`, so **no React 19** | Ant Design RTL only. Docs are mostly Chinese. | Formily 37 kB, plus Designable and antd | Yes, in theory | JSON Schema with `x-component`, `x-reactions` | No |
| **JSON Forms** (EclipseSource) | MIT. There is **no maintained builder**: [`jsonforms-editor`](https://github.com/eclipsesource/jsonforms-editor) is **archived**. | `@jsonforms/react` 3.8.0, 2026-06-16 | Peer includes `^19` | Depends on the renderer set we pick | 9 kB (core renderer only) | Yes (custom renderers) | JSON Schema plus UI Schema with `rule` (SHOW/HIDE). Mapping is moderate, and tables and checklists don't fit well. | No |
| **react-jsonschema-form** + builder | RJSF is Apache-2.0 (6.11.0, 2026-09-29; 16k stars). The most-used builder, [`ginkgobioworks/react-json-schema-form-builder`](https://github.com/ginkgobioworks/react-json-schema-form-builder), is Apache-2.0 and active (pushed 2026-10-12, 376 stars). | Active | RJSF peer `react >=18` | Nothing documented in the builder | RJSF 52 kB, plus builder (Bootstrap/reactstrap) | Through RJSF widgets, though the builder's own UI is fixed | JSON Schema plus uiSchema; conditions via `dependencies`/`if-then`. The mapping is lossy. | No |
| **Formbricks** | **AGPLv3**, plus an enterprise `ee/` folder that needs a licence key. They **do not license taking out parts "like the survey editor"** [[repo]](https://github.com/formbricks/formbricks). | Active | Not a library | n/a | n/a | No. It is a whole app. | n/a | No |
| **Own canvas on dnd-kit** (baseline) | MIT | `@dnd-kit/react` 0.5.1, 2026-10-15 (new API, pre-1.0); `@dnd-kit/core` 6.3.1, 2024-12 (stable, 28.7M downloads a week) | Peer `^18 \|\| ^19` | Drag direction works with logical CSS. We write the RTL ourselves, as we already do. | 14–33 kB | Yes, it is our renderer | **None needed**: we edit `formSchema` directly | No |

**Not usable for Rabaed:**
- **Formbricks**: AGPL, and its editor cannot be licensed separately.
- **Formily/Designable**: stalled beta, React 16/17 only.
- **react-form-builder2**: no sections or conditions, and unmaintained since 2025-05.
- **JSON Forms**: no builder.
- **Form.io**: the canvas cannot use our React components, it is the largest bundle, RTL is "not planned", and PDF needs the paid platform.

## Recommendation

**Build the builder on Puck (MIT). Use our own field components as its blocks, and write a two-way adapter between `formSchema` and Puck `Data`.**

How it would work:
- Puck config has a **Section** block with a `fields` slot, and one block per field type. Each block's `render` is the same component `FormRenderer` uses, so the canvas *is* the live preview. Switching `dir` and locale on the canvas gives the EN/AR preview.
- The properties panel is Puck `fields`. The complex ones are our own custom fields: the bilingual label editor, options, option-list picker, **table column editor**, **checklist item editor**, **calculated-formula editor** and the **`visible_if` condition builder**. These are the parts no library has for our model anyway.
- On save: Puck `Data` goes through `toFormSchema()`, then `formSchema.parse()`, then our publish checks. Puck JSON is never stored; `formSchema` is. On open: `fromFormSchema()`. Built-in fields can be locked in place with Puck's permissions.

Why:
1. **Licence.** MIT for everything we ship. No per-developer or per-domain fees, and no OEM question about end users designing forms. The repo is public (CLAUDE.md), so this matters.
2. **Our components.** The canvas renders our `FormRenderer` field components. Puck is the only maintained, popular, React-19-ready option built around that. FormEngine is the other, but its Designer costs $5,999+ and may need OEM terms.
3. **One source of truth.** Puck has no validation or condition engine of its own to compete with ours. Its data shape (blocks with slots) maps directly to sections → fields.
4. **Health.** 13.5k stars, 327k downloads a week, a release every few weeks, Next.js App Router recipe, React 19 peer, editor UI translation since v0.23, and its RTL issue is closed as completed.

**Second choice: SurveyJS Survey Creator (commercial, $589 per developer one-time, plus $239 a year).** It is the most complete *form* builder: a logic tab, a translations tab, and a matrix (table) type. Its model is the closest to ours, and a paid PDF Generator ($1,059 per developer, PRO) is available. We would choose it only if we want a ready-made form UX and accept these costs:
- a second form model beside ours, with string `visibleIf` expressions to parse;
- a heavy bundle;
- a canvas that draws SurveyJS questions rather than our components;
- a per-developer fee for every agent and human working on the builder.

**Fallback:** if Puck's page-builder chrome does not fit, write our own canvas on dnd-kit (`@dnd-kit/core` for stability). Puck's drag-and-drop canvas is the part we would most likely give up; the custom property editors and the adapter carry over unchanged.

### Risks

- **Puck is pre-1.0** (0.23). APIs have changed between minors: zones are being replaced by slots, and the package moved to `@puckeditor`. Pin the exact version and keep all Puck code in one `packages/ui` form-builder module behind the adapter.
- **Puck is a page builder, not a form builder.** There is no built-in "logic" or "translations" tab. We build the condition builder and the bilingual editors ourselves. That is most of the work whichever option we pick, apart from SurveyJS.
- **Bundle.** Puck is about 165 kB gzip. Load it only on the builder route (`next/dynamic`, client-only).
- **RTL inside the editor chrome** (side panels, outline, drag direction) needs a hands-on spike with `dir="rtl"`. The Dictionary API covers strings, not layout. Do this spike before committing.
- **Visibility** (`docs/visibility.md`): the builder only edits a company's own Form schema. Puck has no server part. Its optional AI and cloud packages must **not** be installed, so no Form content leaves our backend.

### PDF

**None of the MIT options export PDF.** SurveyJS's PDF Generator and Form.io's PDF server are both paid add-ons, and both work from their own models. Because `formSchema` stays the source of truth, generate the PDF template from `formSchema` plus the answers ourselves, on the server. For example, render a print view of `FormRenderer` with headless Chromium, or use a PDF library. Pick the tool in its own ticket, and test Arabic shaping, RTL and left-to-right Document Numbers first.
