---
name: rabaed-design
description: Use this skill to generate well-branded interfaces and assets for Rabaed, the Arabic-first construction project-management platform, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

# Rabaed Design System

Read `readme.md` in this skill for the full design guide (product context, content voice, visual foundations, iconography, and a file index), then explore the other files.

**Rabaed** is an Arabic-first, **RTL** construction project-management platform (KSA/Gulf): companies, projects, official correspondence, submittals, inspections, and NCRs, with role-aware views. Voice is formal and document-grade; brand is **tomato-red + delft-blue ink on a warm off-white canvas**.

## Where things live
- **`styles.css`** — the one global entry point. Link it and every token + webfont comes with it.
- **`tokens/`** — `colors.css`, `typography.css`, `spacing.css`, `fonts.css`, `icons.css` (Tabler subset), `base.css`. Always reference semantic aliases (`--color-primary`, `--text-body`, `--surface-card`, `--surface-board`, `--success-600`, `--chip-*`, `--status-*`), not raw ramp steps.
- **`components/`** — 13 React primitives on namespace `window.RabaedDesignSystem_a8093d`: Button, IconButton, Icon, Badge, Tag, Avatar, Card, Input, Select, Checkbox, Switch, StatCard, Tabs. Each has a `.prompt.md` with usage.
- **`ui_kits/app/`** — interactive web-app recreations: `index.html` (shell + screens) and `submittals-kanban.html` (full Kanban board + detail drawer).
- **`guidelines/`** — specimen cards (colors, type, spacing, workflow palette, brand imagery).
- **`assets/`** — `brand/` logos and `img/` product + marketing imagery.

## How to use
- **Visual artifacts** (slides, mocks, throwaway prototypes): copy assets out and produce static HTML files for the user to view. Link `styles.css`, mount components from the bundle, use the icon webfont via `<i class="ti ti-…">` or the `Icon` component.
- **Production code**: copy assets and read the rules here to design accurately for the brand.
- Lay Arabic UI out **RTL** (`dir="rtl"`); never use emoji; carry status meaning through the semantic color palette + icons.

If invoked without guidance, ask the user what they want to build, ask a few focused questions, then act as an expert Rabaed designer who outputs HTML artifacts **or** production code, depending on the need.

## Substitutions to confirm
- Marker headline face → **Caveat** (Google Fonts).
- Icon set (Vuesax/Iconsax linear) → **Tabler Icons**, self-hosted in `tokens/icons.css`.
- Arabic faces → **Montserrat** + **IBM Plex Sans Arabic**.
