# Rabaed — Design System

**Rabaed** (رابط / "Rabaed Construction") is an Arabic-first, RTL **construction project-management platform** for owners, consultants and contractors in the Gulf (KSA). It runs the formal paper-trail of a project: companies and their teams, projects, **official correspondence** (المراسلات الرسمية), **submittals** (shop drawings, material approvals), **inspections**, and **NCRs** (non-conformance reports) — with role-aware views (Super Admin, Contractor PM, Contractor Engineer, Consultant, Owner) and a tamper-evident, timestamped delivery chain for every letter.

The product voice is **formal, bilingual, document-grade**: it reassures professionals that the record is official and defensible, while staying clean and modern. The brand pairs a confident **tomato-red** accent with **Delft-blue ink** on a **warm off-white** canvas.

---

## Sources

This system was reconstructed from a single design source. The reader is **not** assumed to have access; these are recorded for provenance.

- **Figma:** "Rabaed Beta.fig" (attached as a virtual filesystem; now disconnected). Pages covered the marketing site and the web app (company detail, correspondence, submittals, dashboards). All tokens, type, the component set, and the product imagery in `assets/` were extracted from it.
- No GitHub repo or live codebase was provided. UI-kit screens are faithful recompositions of the Figma frames using this system's own components.

> **Substitution flags — please confirm / supply originals:**
> - **Marker headline face:** marketing headlines use a hand-drawn marker font; **Caveat** (Google Fonts) substitutes it. If you have the real face, drop the files in and update `tokens/fonts.css`.
> - **Icon set:** the product uses a **Vuesax / Iconsax linear** set. **Tabler Icons** (same 1.5px rounded-outline look) substitutes it, self-hosted via `tokens/icons.css`. See ICONOGRAPHY.
> - **Arabic faces:** the source names "Montserrat-Arabic" and "IBM Plex Sans Arabic"; we map these to the genuine Google families **Montserrat** + **IBM Plex Sans Arabic**.

---

## CONTENT FUNDAMENTALS — how Rabaed writes

**Language & direction.** Primary language is **Modern Standard Arabic**, laid out **right-to-left**. Always set `dir="rtl"` and lead with Arabic; English (reference codes, file types, the product name) is interleaved where it occurs naturally. Numerals appear in **Arabic-Indic** form in the UI (٧, ٢٠٢٦, ٢.٢ م.ب) while system reference codes stay Latin (`RBD-2025-0142`, `RBD-0142-C-0051`, `RFI-0142-012`).

**Tone.** Formal, precise, institutional — the register of official engineering correspondence. Copy is **declarative and procedural**, never chatty or hype-y. Letters open with conventional formulae ("إلحاقًا بكتابكم…", "نأمل إفادتنا…") and state facts: what is attached, what is requested, by when.

**Person.** Addresses parties by **role and organisation**, not first names ("المالك", "الاستشاري", "مكتب دار الرياض للاستشارات الهندسية"). The app greets the signed-in user warmly and briefly ("مرحبًا، سارة المطيري" / "Hello, Mohamed"), then drops back to formal register inside the work.

**Casing.** Latin UI labels are **Title Case** ("Super Admin", "New Submittal"); document/section titles in Arabic carry no casing but are weighted with the display font. Eyebrow/label runs use wide letter-spacing (`--ls-wide`).

**Status language is fixed and color-coded.** Statuses read as short imperative or state phrases and always pair with a semantic tone: **يتطلب ردّك** (requires your reply — tomato), **بانتظار رد المالك** (awaiting owner — neutral/blue), **مغلقة** (closed — green), **مسودة** (draft — amber), **قيد التنفيذ** (in progress). Keep this vocabulary stable; users navigate by it.

**No emoji.** This is a professional records system — **emoji are never used** in product copy or marketing. Meaning is carried by the icon set and the status palette, not by emoji or decorative unicode.

**Examples (verbatim from the product):**
- Page intro: «تبادل موثّق للخطابات الرسمية بين أطراف المشروع — إثبات إرسال وتسليم وتسلسل زمني محايد لكل الأطراف.»
- Letter body: «إلحاقًا بكتابكم، نرفق طيّه البرنامج الزمني المحدّث موضّحًا عليه أثر التأخّر على المسار الحرج…»
- Action labels: «خطاب جديد» · «رد على المراسلة» · «ربط عنصر» · «مشاركة بالبريد».

---

## VISUAL FOUNDATIONS

**Palette.** Brand **Tomato `#F95738`** is the single dominant accent — CTAs, active states, the selection rail, links. **Delft Blue `#3D405B`** is the secondary/ink, and the default body-text color. **Naples Yellow `#F4D35E`** and **Orange `#EE964B`** are warm accents (the logo gradient runs Orange→Tomato). The canvas is a **warm off-white `#FDF9F5`**, never pure white or cool gray — warmth is a brand signature. Full ramps + semantic aliases live in `tokens/colors.css`; **always reference the semantic aliases** (`--color-primary`, `--text-body`, `--surface-card`…), not raw ramp steps.

**Surface & elevation.** Cards are **white** on the warm canvas, separated by a **hairline border + a soft, warm low-contrast shadow** (shadows are tinted with Delft blue, not black — see `--shadow-sm…xl`). Intended ladder: **L0 warm canvas → L1 white panel/card → L2 tinted inset** for nested rows. (Note: the canvas/card value-gap is currently subtle; a deeper-canvas surface layer is under discussion — see `ui_kits/app/correspondence-surfaces.html`.)

**Type.** Display/brand → **Montserrat** (bold, tight tracking) for titles and marketing. UI/product → **IBM Plex Sans** / **IBM Plex Sans Arabic** for everything functional. Marker accent → **Caveat** (substitute) for hand-written marketing flourishes. Scale runs Display 64 → H1 48 → … → body 14 → notes 11 (`tokens/typography.css`). Body copy is Delft blue, headings near-black `#292D32`.

**Spacing & radii.** 4px base grid (`--space-*`). Radii: chips/inputs/buttons **8px**, cards/dropdowns **12px**, large/KPI surfaces **16px**, pills **999px**. Generous internal card padding (20–24px) keeps the document feel calm.

**Workflow chips.** Disciplines and submittal types use a **dedicated pastel chip palette** (`--chip-*`): CV neutral, AR violet, EL cyan, SU orange, SAR amber, DAS teal, MAR blue, NPD green. These are deterministic and meaningful — same code, same color, everywhere.

**Imagery.** Product screenshots and warm, on-site construction photography (engineers, tablets, sites) — natural warm light, not cool/corporate. Marketing pairs photography with the marker font and tomato underlines/arrows. See `assets/img/` and the `guidelines/brand-imagery` card.

**Motion.** Restrained and functional. Standard ease `cubic-bezier(.4,0,.2,1)`, soft ease-out for entrances; durations 120/200/320ms (`--dur-*`). Fades and short slides; **no bounces, no infinite decorative loops.** Hover = subtle background/opacity shift; active/press = slight darken (tomato → `--tomato-700`) and a 1–2px settle, never a big shrink. Focus = `--shadow-focus-ring` (tomato at 20%).

**Borders & dividers.** Hairlines only — `--border-subtle` for in-card dividers, `--border-default` for card edges, `--border-strong` sparingly. Tomato is the focus/active border.

---

## ICONOGRAPHY

- **System:** the product's icons are a **Vuesax / Iconsax linear** family — single-weight ~1.5px rounded-outline strokes. We substitute **Tabler Icons 3.19.0** (visually equivalent) and **self-host the per-icon rules** in `tokens/icons.css` (the font binary still streams from the jsDelivr CDN). Self-hosting is required: a cross-origin `@import` of Tabler's CSS registers the `@font-face` but its per-icon `content:` rules don't apply.
- **Usage:** render through the **`<Icon name="…">`** component (maps friendly names → `ti ti-*` classes). ~150 curated glyphs are included (navigation, files, status, construction-specific: `crane`, `hammer`, `ruler`, `shovel`, `road`, `building-factory`). To add one, copy its `.ti-<name>:before{content:"\xxxx"}` rule into `tokens/icons.css`.
- **No emoji, no ad-hoc SVG icons, no unicode-as-icon.** Status meaning comes from the icon + the semantic color, never emoji.
- **Logo:** `assets/brand/rabaed-logo-full.svg` (wordmark + mark) and `assets/brand/rabaed-mark.svg` (mark only, for the rail). The mark uses the Orange→Tomato gradient.

---

## INDEX — what's in this folder

**Global entry**
- `styles.css` — the one file consumers link; `@import`s every token + font file below.

**Tokens** (`tokens/`)
- `colors.css` · `typography.css` · `spacing.css` (spacing/radii/shadows/motion/layout) · `fonts.css` (webfont imports) · `icons.css` (Tabler subset) · `base.css` (element resets).

**Components** (`components/`, namespace `window.RabaedDesignSystem_a8093d`) — 15 primitives:
- **core/** — `Button`, `IconButton`, `Icon`, `Badge`, `Tag`, `Avatar`, `Card`
- **forms/** — `Input` (outline · filled · inset, textarea), `Select`, `Checkbox`, `Radio`, `Switch`, `Segmented` — surface-aware via `tokens/forms.css` (`.surface-gray`, `.theme-dark`)
- **data/** — `StatCard`
- **navigation/** — `Tabs`
- Each has a `.jsx`, `.d.ts`, `.prompt.md`, and a per-directory `*.card.html` specimen.

**UI kit** (`ui_kits/app/`)
- `saas-shell.html` — clickable SaaS prototype: dark/light sidebar (Modules + My Company), collapse with tooltips/flyouts, ⌘K search, user menu (language + theme), 8 pages + project tabs. Code in `shell/`.
- `submittals-kanban.html` — Submittals Kanban board with the new card anatomy.
- `submittals-list.html` — Submittals List view (drag columns, column settings, group by, export).
- `settings-numbering.html` — Project Settings → Document Numbering.
- `settings-workflows.html` — **Settings → Workflows**: library tabs (project / company / Rabaed), detail with version selector, versions timeline, used-by, activity; visual builder (stage bands, steps, labelled transitions, drag + snap, palette, templates, side-panel editor with who-holds-it, conditions, action-form preview, notifications, live validation, test run, undo/redo), publish modal with impact note, version compare; Work Item Types → workflow picker. Code in `wf/`.
- `workflow-view.html` — Submittal detail with **View workflow** drawer: pinned version + "updated to v3" banner, current step pulse + age, path with signatures, next actions, revisions chain, other companies' internal steps collapsed per viewer (Contractor / Consultant / Owner Rep), phone timeline.
- `reports.html` — **Reports** tab (renamed from Daily Site Report): templates grouped Daily / Weekly / Monthly, 3 home options (A Calendar · B Register · C Feed), missing-day gaps, create-from-template modal (section nav, steppers, copy from yesterday, autosave), workflow Engineer → Contractor PM (Return / Submit ✍) → Consultant (Ask a question / Affirm ✍, no codes), Weekly report built from dailies with charts + missing-day banner, sealed PDF preview. Code in `reports/`.
- `snag-list.html` — **Snag List** tab: Snags · Comments · Questions (type chips), filters (trade, location, company, stage, assigned to me, raised from), list grouped by stage + bulk reassign/move/export, Kanban, detail drawer (raised-from card with Code B quote or failed checklist item, mini plan pin, before/after, chat, internal notes, history), role-aware actions (contractor Resolve with after photos → consultant Close / Re-open with note), create drawer, submittal "Comments 3 of 5 closed" panel, empty state. Code in `snag/`. Activity & Approved Suppliers moved into Settings.
- `snag-list-mobile.html` — Snag List on a phone: photo-first cards, swipe Resolve/Hold, filter sheet, camera → pin → title → assign flow with draft autosave, detail.
- `plan-view.html` — **Multiple View → Plan View**: CAD sheet with typed pins (circle snag · diamond inspection · square comment, colour = status), clusters when zoomed out, pin popover (number, stage, trade, assignee, age dots, photo, Open), add-pin flow (drop → type → form with Location prefilled), filters, synced list, drawing revisions (pins stay on their sheet), Plans panel with elevation picker, visibility by company. Code in `plan/`.
- `plan-view-mobile.html` — Plan View on a phone: full-screen plan, bottom sheet (list · filters · floors · pin detail), thumb-zone "+" with drop-pin reticle and camera-first capture.
- `floor-view.html` — **Multiple View → Floor View**: building stack (Roof → B1) or card list, status tiles per space, counts, trade popover, left filters (week, trade, type, company, stage), Issues-only mode, Spotlights (Open/Resolved, expand, export), empty building, EN/AR, tablet drawer. Code in `floor/`.
- `map-view.html` — Project tab **Multiple View → Map View** (Floor / Map / Plan). Site map with status-coloured zone polygons, pan/zoom, zone panel, filters, visibility by role, executive dark variant, admin draw/edit + Location link, empty state. Code in `map/`. Map View is no longer in the sidebar.

**Specimen cards** (`guidelines/`) — Colors, Type, Spacing, Brand cards that populate the Design System tab.

**Assets** (`assets/`) — `brand/` logos · `img/` product + marketing imagery.

**Skill** — `SKILL.md` makes this folder usable as a downloadable Agent Skill.

---

*Open questions for the team:* (1) confirm the marker-font and icon-set substitutions above;css`.
