# @rabaed/ui

The Rabaed design system: tokens, the Tailwind theme and components, in English (LTR) and Arabic (RTL). Spec: RP-197.

## Use it

```css
/* app CSS */
@import "tailwindcss";
@import "@rabaed/ui/styles.css";
```

```tsx
import { Button, SignButton } from "@rabaed/ui";
```

Next.js apps also list `@rabaed/ui` in `transpilePackages`.

## Tokens

Three layers, all in `src/tokens/`:

1. **Base palette** (`palette.ts`): raw colours such as `tomato-600`. Only themes read it.
2. **Semantic roles** (`themes.ts`): `canvas`, `primary`, `stage-*`, `code-a..d-*`, `age-0..4` and so on, mapped to palette colours. The only layer a new theme changes. Launch theme: cool light.
3. **Component usage**: components use Tailwind classes for semantic roles (`bg-primary`, `text-muted`). The Tailwind theme exposes semantic roles only, so the base palette is unreachable from a class.

`src/styles/tokens.css` is generated. After editing `src/tokens/`, run `pnpm --filter @rabaed/ui tokens`; a unit test fails if you forget. Another unit test keeps every text/background pair at WCAG AA contrast.

## Fonts

All fonts are self-hosted: bundled from npm (`@fontsource…`) onto our own origin, never loaded from a font CDN.

| Use | Font | Token |
|---|---|---|
| Latin UI | IBM Plex Sans | `font-ui` (the default) |
| Display | Montserrat | `font-display` |
| Arabic | Thmanyah Sans when its files are present at build time, otherwise IBM Plex Sans Arabic | `--font-arabic`, the second family in both stacks |

**Thmanyah Sans is licensed and never committed.** The switch happens at build time: put the `thmanyahsans-{Light,Regular,Medium,Bold,Black}.woff2` files in `packages/ui/fonts/thmanyah/` (git-ignored; for dev, the deploy workflow supplies them from the private build assets bucket, see "Thmanyah fonts" in the root README). `prepareArabicFont()` (`src/fonts/arabic-font.ts`, also exported as `@rabaed/ui/fonts`) then writes the git-ignored `src/styles/arabic-font.css`. Storybook, the story tests and `apps/web`'s `next.config.ts` call it on start, so no extra step is needed; without the files everything builds with IBM Plex Sans Arabic.

## Digits, dates and direction

- Numbers and dates: `formatNumber` and `formatDate` from `@rabaed/domain`. Latin digits in English and Arabic, the Gregorian calendar, Saudi time.
- **DocNo**: `<DocNo value="TWR-TMC-EL-MAR-041" rev={2} />`. A Document Number (with optional `Rev n`), left-to-right and isolated, so it never scrambles inside Arabic text. Always use it for Document Numbers.
- **Icon**: `<Icon name="chevron-right" />`, from the Tabler outline set, bundled as SVG (no icon font, no CDN). Decorative by default; pass `label` when the icon means something on its own. Arrows and chevrons that follow the reading direction flip in Arabic; override with `mirrorInRtl`. To add an icon, register it in `src/components/icon/icon.tsx`.

## Forms

Every control sits in a `Field`, which gives it a label, optional help text, the required marker and an error message, all tied to the control (`aria-describedby`, `aria-invalid`, `required`). The control takes `disabled` and `readOnly` from the Field too.

```tsx
<Field label={t("projectName")} help={t("asOnContract")} error={errors.name} required>
  <Input name="name" />
</Field>

<Field label={t("trade")}>
  <Select name="trade" options={trades} placeholder={t("chooseTrade")} />
</Field>

<Field label={t("notifyConsultant")} layout="inline">
  <Checkbox name="notify" />
</Field>

<Field label={t("reviewCode")} group>
  <RadioGroup name="code" options={codes} />
</Field>
```

| Control | Use for | Field |
|---|---|---|
| `Input`, `Textarea` | Text | stacked |
| `Select` | One choice from a longer list | stacked |
| `RadioGroup` | One choice, all options visible | `group` |
| `SegmentedControl` | Two to five short options side by side (a view switch) | `group` |
| `Checkbox` | Yes/no that takes effect on submit | `layout="inline"` |
| `Switch` | On/off that takes effect at once | `layout="inline"` |

- **Read-only** keeps the value, stays focusable and is announced read-only (for every control, not only text boxes).
- **Touch**: on a touch screen (`pointer: coarse`) every control and option is at least 44 × 44px. Small controls (checkbox, radio, switch) keep their size and get a larger hit area.
- **Direction**: wrap the app once in `<DirectionProvider dir={directionOf(locale)}>` so arrow keys and the Select menu follow Arabic (`apps/web` does this in its layout).
- Form control borders use `control-border` (3:1 against the background, WCAG 1.4.11); `border` is for decorative lines only.

## Overlays and feedback

| Component | Use for |
|---|---|
| `Dialog` | A focused task or confirmation over the page. Traps focus, closes on Escape, returns focus to its trigger. |
| `Sheet` | A side panel (filters, details) from the inline-end side: right in English, left in Arabic; `side="start"` for navigation. Same focus rules as Dialog. |
| `Popover` | A small non-modal panel anchored to a button, aligned to its start edge (mirrors in Arabic). Name it with `aria-label`. |
| `Tooltip` | A short hint on hover or keyboard focus, read as the trigger's description. Never the only place information lives (touch screens have no hover). |
| `ToastProvider` + `useToast()` | Brief feedback after an action, at the bottom inline-end corner. Announced politely, or at once for `tone: "danger"`. |
| `EmptyState`, `ErrorState` | A list or page with nothing yet, or that failed to load: icon, heading, a sentence, optional action. ErrorState is announced. |
| `Loading` + `Skeleton` | Placeholders in the shape of the content; screen readers hear the `Loading` label instead. |

```tsx
<Dialog>
  <DialogTrigger asChild><Button>{t("rename")}</Button></DialogTrigger>
  <DialogContent title={t("renameProject")} description={t("everyoneSees")} closeLabel={t("close")}>
    …
    <DialogFooter>
      <DialogClose asChild><Button variant="ghost">{t("cancel")}</Button></DialogClose>
      <Button>{t("save")}</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

## Data display

| Component | Use for |
|---|---|
| `Table` + `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `TableEmpty` | Lists of records. Real table roles, in a named region that scrolls (and takes keyboard focus) when the table doesn't fit. |
| `Tabs` + `TabsList`, `TabsTrigger`, `TabsContent` | Switching between views of one area. The ARIA tabs pattern; arrow keys follow the reading direction. |
| `Badge` | A short label in a tint: `neutral` (default), `brand`, `info`, `success`, `warning`, `danger`; optional `dot`. Not for Stages or Review Codes, which have their own components. |
| `Avatar` | A person's photo or initials (a circle), or with `kind="company"` a company's logo or initials (a rounded square). Named after them; `decorative` when the name is beside it. |
| `CompanyChip` | Another company as one block: its mark and name in a pill. Takes no person, so it can't show another company's people. |

```tsx
<Table label={t("submittals")} stickyHeader containerClassName="max-h-[60vh]">
  <TableHeader>
    <TableRow>
      <TableHead sort={sortOf("number")} onSort={() => sortBy("number")}>{t("number")}</TableHead>
      <TableHead align="end">{t("sheets")}</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {rows.length === 0 && (
      <TableEmpty colSpan={2}>
        <EmptyState title={t("noSubmittals")} />
      </TableEmpty>
    )}
    {rows.map((row) => (
      <TableRow key={row.id} selected={selected.has(row.id)}>
        <TableCell><DocNo value={row.number} /></TableCell>
        <TableCell align="end">{formatNumber(row.sheets, locale)}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

- **Sorting**: a column with `sort` (`ascending`, `descending` or `none`) and `onSort` gets a sort button, and `aria-sort` on the column header, which screen readers read with the header (the WAI-ARIA sortable table pattern). The app sorts the rows and decides the next order.
- **Selection**: put a `Checkbox` named after the row (e.g. its Document Number) in the first cell and mark the row `selected`; a header checkbox selects all (`"indeterminate"` when some are).
- **Alignment**: `align="end"` for numbers, so they line up with tabular digits; columns and alignment mirror in Arabic.
- **Tabs**: name the list (`<TabsList aria-label={t("project")}>`); a trigger takes an `icon` and a `count` (pass it formatted with `formatNumber`).

The package has no translations of its own: pass every label (`closeLabel`, the toast region `label`, …) from the app's messages. The exceptions are the fixed product wording of the status components below (Review Code meanings, "N weeks at this step"), which take a `locale` instead, so no module can word them differently, and the language names in `MemberMenu`, each written in its own language ("English", "العربية"). Copy never uses deadline language: the story tests check story copy, and the `json-no-deadline-words` lint rule checks the app's messages.

## Status

The components that carry Rabaed's product rules, so every module shows status the same way. Use them wherever a Stage, a Review Code, a Step Age or a holder appears.

| Component | Shows | Rule it keeps |
|---|---|---|
| `StagePill` | A Stage: `stage` (the colour category, one of `stageKeys`), its `label`, optional `count` (formatted for `locale`) | One colour per default Stage in every module; the name carries the meaning. |
| `CodeBadge` | A Review Code: `code` (`a`–`d`), `locale`, `size` (`sm`, `md`), `variant` (`full`, or `letter` with the meaning for screen readers only) | Icon + colour + text, never colour alone. B always has the comment icon. |
| `AgeDots` | Step Age: `weeks` (the week at the current Step, from 1), `locale` | 1–4 dots (4+), grey turning red, named "N weeks at this step". Age only: it takes nothing but weeks. |
| `WithChip` | Who holds the Step: `kind` (`person`, `company`), `name`, `photoSrc`, `companyName`, `logoSrc`, `inViewerCompany` | Visibility V14: when `inViewerCompany` is false it shows the company name only, whatever else is passed. |
| `WorkItemCard` | A Work Item on a Kanban board: `number`, `rev`, `title`, `trade`, `location`, then `state`: `{ open: true, holder, stepAgeWeeks }` or `{ open: false, code }` (a closed item shows its Issued Code, never a holder or Step Age), optional `photoSrc`; `density` (`comfortable`, `compact`); `href` (a link, with `linkAs={Link}` for Next.js) or `onClick` (a button) | One card on every board. Closed items with an Inspection Result, or Cancelled ones, will need their own outcome here when those Modules come. One focus target, named by its number and title only; the rest is its description. The holder goes through `WithChip`, so another company shows as its name only. |

```tsx
<StagePill stage="internal" label={stage.name[locale]} count={12} locale={locale} />
<CodeBadge code="b" locale={locale} />
<AgeDots weeks={item.stepAgeWeeks} locale={locale} />
<WithChip kind="person" name={holder.name} companyName={holder.companyName} inViewerCompany={holder.companyId === viewer.companyId} />
```

- `AgeDots` takes Step Age as CONTEXT.md defines it: **1 in the first week** at the Step, 2 in the second, and so on (`stepAgeWeeks` in `@rabaed/domain`). The dots come from the domain's `stepAgeDots`; `stepAgeLabel` gives the same words for places that aren't a component (an email, a report).
- `WithChip` is the last line of defence, not the first: the API should still never send another company's person to the browser (V14), since props of a client component travel in the page payload.

## Shell

Every page sits in the same layout, in English and Arabic, on desktop and phone. Presentational only: the app passes the navigation targets, labels and data.

| Component | Use for |
|---|---|
| `AppShell` | The page layout: `Sidebar` on the inline-start side (the right in Arabic), `TopBar` and the page beside it. Below `md` the sidebar becomes a `Sheet` from the start side, opened by a menu button in the top bar; choosing a page closes it. |
| `Sidebar` / `SidebarNav` | The main navigation: sections of items (`key`, `label`, `icon`, `href`, optional `count`), the `current` one marked `aria-current="page"`. Collapses to icons with a button (mouse or keyboard); collapsed, each item shows its name in a tooltip and each section stays a named group. `brandCollapsed` (e.g. the logo mark) shows when collapsed; `defaultCollapsed` and `onCollapsedChange` let the app remember the choice. |
| `TopBar` | The banner landmark, with slots for `search`, `notifications` and `member`. |
| `MemberMenu` | The signed-in Member's avatar and name, opening a menu with the language switch (each language named in itself, the current one pressed) and any extra items, e.g. Sign out. |
| `PageHeader` | A page's one `h1`, with an optional `eyebrow`, `description`, `actions` and `tabs`. |
| `ProjectTabs` | A Project's tabs, always in the agreed order (`projectTabKeys`): Dashboard · Submittals · Inspections · Snag List · Site Reports · Drawings · Files · Views · Schedule · Settings. Page navigation, so links in a named `nav` (not ARIA tabs). Schedule isn't built yet: greyed out, `aria-disabled`, described by `comingSoonLabel`. They scroll sideways on a phone. |

```tsx
<AppShell
  sidebar={{ brand: "Rabaed", label: t("main"), sections, current: "projects", collapseLabel: t("collapse"), expandLabel: t("expand"), linkAs: Link }}
  topBar={{ search: <SearchButton />, notifications: <NotificationsButton />, member: <MemberMenu … /> }}
  menuLabel={t("menu")}
  closeLabel={t("close")}
>
  <PageHeader
    title={project.name}
    tabs={<ProjectTabs label={t("project")} labels={tabLabels} href={(key) => `/projects/${project.id}/${key}`} current="submittals" comingSoonLabel={t("comingSoon")} linkAs={Link} />}
  />
  …
</AppShell>
```

The sidebar uses the light variant of the design (surface and brand tint); a dark sidebar would need its own theme roles first.

## Storybook and story tests

- `pnpm storybook` opens Storybook; the **Language** toolbar switches EN (LTR) / AR (RTL).
- `pnpm test:stories` runs every story in Chromium, once per language: its play function (behaviour), direction, Latin digits, no deadline words, no requests to another origin, axe (WCAG 2.2 AA) and a screenshot comparison.
- Stories with `parameters: overlay` (from `src/storybook/overlay.ts`) leave a dialog, sheet, popover, tooltip or toast open; the harness checks and screenshots the whole 1024 × 768 page, portals included. Motion is reduced in story tests, so animations never reach a screenshot.
- Stories with `parameters: phone` (from `src/storybook/form.ts`) render 390px wide on an emulated touch screen, so they can check 44px touch targets with `expectTouchTarget`.
- Screenshot baselines are Linux renders in `test/__screenshots__/`, compared on Linux only (CI). When you change the UI on purpose, add the `update-screenshots` label to your PR (or run `gh workflow run update-screenshots.yml --ref <branch>`); the **Update screenshots** workflow commits the new baselines to the PR for review.

## Lint guard rails

`pnpm lint` (run in CI on every PR) enforces the design rules in `packages/ui` and `apps/web`. The rules live in `packages/eslint-plugin` and are wired up in the root `eslint.config.js`.

| Rule | Catches | Fix |
|---|---|---|
| `rabaed/no-hardcoded-colour` | Colour functions (`rgb(…)`, `oklch(…)`), hex colours in colour-like strings (`"#fff"`, `"1px solid #ddd"`, not `"RFI #1234"` or `href="#id"`), base palette variables (`--palette-*`), Tailwind arbitrary colours (`bg-[#fff]`, `fill-[red]`, `[color:…]`, `bg-(--palette-…)`), and named colours in `style` (`color: "red"`) | A semantic token: a class such as `bg-primary` / `text-muted`, or `var(--primary)` in a style |
| `rabaed/css-no-hardcoded-colour` | The same in `.css` files, including `@apply` class lists and named colours (`color: red`) | `var(--role)` |
| `rabaed/no-physical-direction` | Physical Tailwind classes in `className`, `cn()`, `cva()`, `clsx()`, `twMerge()` and `*Variants()`: `ml-/mr-/pl-/pr-`, `left-/right-`, `border-l/r`, `rounded-l/r/tl/tr/bl/br`, `text-left/right`, `float-/clear-left/right`, `[margin-left:…]`; and `style={{ marginLeft, left, textAlign: "right" … }}` | The logical twin the message names: `ms-/me-/ps-/pe-`, `start-/end-`, `border-s/e`, `rounded-s/e/ss/se/es/ee`, `text-start/end`; `marginInlineStart`, `insetInlineStart`, `textAlign: "start"` |
| `rabaed/css-no-physical-direction` | `margin-left`, `padding-right`, `left`, `border-left…`, `border-top-left-radius`, `text-align: left`, `float: right` and physical `@apply` classes in `.css` | `margin-inline-start`, `padding-inline-end`, `inset-inline-start`, `border-inline-start…`, `border-start-start-radius`, `text-align: start`, `float: inline-end` |
| `rabaed/no-deadline-words` | Props, variables, fields and `t("…")` / `t.rich("…")` keys named with overdue / due date / deadline / SLA (tests are exempt) | Rabaed shows Step Age only: name it for weeks at step, e.g. `weeksAtStep` |
| `rabaed/json-no-deadline-words` | The same words (English and Arabic) in `apps/web/messages/*.json` keys and text | Step Age wording, e.g. "4+ weeks at this step" |

Raw colours may appear only in the token sources: `src/tokens/palette.ts`, `src/tokens/scales.ts`, their tests, and the generated `src/styles/tokens.css`. Vertical properties (`top`, `margin-top`, `height`) are fine: they don't change with direction.

Known limits: class lists are recognised in `className` and the class functions above, not in plain variables (`const cls = "ml-2"`); physical shorthands such as `margin: 0 4px 0 8px` are not checked. Prefer Tailwind classes, which avoid both.
