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
2. **Semantic roles** (`themes.ts`): `canvas`, `primary`, `stage-*`, `code-a..d-*`, `age-0..4`, `shadow-colour` (the tint of every shadow) and so on, mapped to palette colours. The only layer a new theme changes. Launch theme: cool light.
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
- **DocNo**: `<DocNo value="TWR-MAR-CCM-0001" />`, or with its revision `<DocNo value="TWR-MAR-CCM-0001" rev={2} locale={locale} />` ("Rev 2" in English, "مراجعة 2" in Arabic; `locale` is required with `rev`). The number is left-to-right and isolated, so it never scrambles inside Arabic text; with a revision, number and revision form one unit in the locale's direction, so the revision follows the number in reading order (on its left in Arabic). Always use it for Document Numbers.
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
| `CheckboxGroup` | Any number of choices from a short list | `group` |
| `Switch` | On/off that takes effect at once | `layout="inline"` |

- **Read-only** keeps the value, stays focusable and is announced read-only (for every control, not only text boxes).
- **Touch**: on a touch screen (`pointer: coarse`) every control and option is at least 44 × 44px. Small controls (checkbox, radio, switch) keep their size and get a larger hit area (`touchArea`); links and other inline controls grow to 44px (`touchBox`), both in `control-styles.ts`.
- **Direction**: wrap the app once in `<DirectionProvider dir={directionOf(locale)}>` so arrow keys and the Select menu follow Arabic (`apps/web` does this in its layout).
- Form control borders use `control-border` (3:1 against the background, WCAG 1.4.11); `border` is for decorative lines only.

## Overlays and feedback

| Component | Use for |
|---|---|
| `Dialog` | A focused task or confirmation over the page. Traps focus, closes on Escape, returns focus to its trigger. |
| `Sheet` | A side panel (filters, details) from the inline-end side: right in English, left in Arabic; `side="start"` for navigation. Same focus rules as Dialog. |
| `Popover` | A small non-modal panel anchored to a button, aligned to its start edge (mirrors in Arabic). Name it with `aria-label`. |
| `Tooltip` | A short hint on hover or keyboard focus, read as the trigger's description. Never the only place information lives (touch screens have no hover). `side`: `top` (default), `bottom`, or `start` / `end`, which mirror in Arabic. |
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

The package has no translations of its own: pass every label (`closeLabel`, the toast region `label`, …) from the app's messages. The exceptions are the fixed product wording of the status components below (Review Code meanings, and "N weeks at this step", which comes from `stepAgeLabel` in `@rabaed/domain` so emails and reports share it) and of `DocNo`'s revision word ("Rev"), which take a `locale` instead, so no module can word them differently, and the language names in `MemberMenu` and `NotificationSettings`, each written in its own language ("English", "العربية"). Copy never uses deadline language: the story tests check story copy, and the `json-no-deadline-words` lint rule checks the app's messages.

## Status

The components that carry Rabaed's product rules, so every module shows status the same way. Use them wherever a Stage, a Review Code, a Step Age or a holder appears.

| Component | Shows | Rule it keeps |
|---|---|---|
| `StagePill` | A Stage: `stage` (the colour category, one of `stageKeys`), its `label`, optional `count` (formatted for `locale`) | One colour per default Stage in every module; the name carries the meaning. |
| `CodeBadge` | A Review Code: `code` (`a`–`d`), `locale`, `size` (`sm`, `md`), `variant` (`full`, or `letter` with the meaning for screen readers only) | Icon + colour + text, never colour alone. B always has the comment icon. |
| `AgeDots` | Step Age: `weeks` (the week at the current Step, from 1), `locale` | 1–4 dots (4+), grey turning red, named "N weeks at this step". Age only: it takes nothing but weeks. |
| `WithChip` | Who holds the Step, a `WithChipHolder`: `kind` (`person`, `company`), `inViewerCompany`, `companyName`, `logoSrc`, and only for a person in the viewer's Company, `name` and `photoSrc` | Visibility V14: the props are a union, so another company's holder carries its company only; passing their person's name or photo fails the typecheck. A name forced through with a cast is still dropped, so it shows the company name only. |
| `WorkItemCard` | A Work Item on a Kanban board: `number` (null for a Draft, which has none yet, shown as `noNumberLabel`, e.g. "No number yet"), `rev`, `title`, `trade`, `location`, then `state`: `{ open: true, holder, stepAgeWeeks }` (`stepAgeWeeks` null for a Draft with no number: nobody sees when it was started, so no dots), `{ open: false, code }` (the Issued Code) or `{ open: false, badge }` (any other outcome, e.g. an Inspection Result or Cancelled, as a `Badge`); a closed item never shows a holder or Step Age; optional `photoSrc`; `density` (`comfortable`, `compact`); `href` (a link, with `linkAs={Link}` for Next.js) or `onClick` (a button) | One card on every board. One focus target, named by its number (or `noNumberLabel`) and title only; the rest is its description. The holder goes through `WithChip`, so another company shows as its name only. |

```tsx
<StagePill stage="internal" label={stage.name[locale]} count={12} locale={locale} />
<CodeBadge code="b" locale={locale} />
<AgeDots weeks={item.stepAgeWeeks} locale={locale} />
// On the server: another company's person never gets a name.
const chip: WithChipHolder =
  held.companyId === viewer.companyId
    ? { kind: "person", inViewerCompany: true, name: held.name, companyName: held.companyName }
    : { kind: "person", inViewerCompany: false, companyName: held.companyName };
<WithChip {...chip} />
```

- `AgeDots` takes Step Age as GLOSSARY.md defines it: **1 in the first week** at the Step, 2 in the second, and so on (`stepAgeWeeks` in `@rabaed/domain`). The whole rule lives in `@rabaed/domain`: the dots come from `stepAgeDots`, and `stepAgeLabel` gives the same words for places that aren't a component (an email, a report), without importing this package.
- `WithChip` is the last line of defence, not the first. Its types stop a caller from passing another company's person, but the API must still never send that person to the browser (V14): build the holder on the server from what the viewer may see, since props of a client component travel in the page payload.

## Shell

Every page sits in the same layout, in English and Arabic, on desktop and phone. Presentational only: the app passes the navigation targets, labels and data.

| Component | Use for |
|---|---|
| `AppShell` | The page layout: `Sidebar` on the inline-start side (the right in Arabic), `TopBar` and the page beside it. Below `md` the sidebar becomes a `Sheet` from the start side, opened by a menu button in the top bar; choosing a page closes it. |
| `Sidebar` / `SidebarNav` | The main navigation: sections of items (`key`, `label`, `icon`, `href`, optional `count`), the `current` one marked `aria-current="page"`. Collapses to icons with a button (mouse or keyboard); collapsed, each item shows its name in a tooltip and each section stays a named group. `brandCollapsed` (e.g. the logo mark) shows when collapsed; `defaultCollapsed` and `onCollapsedChange` let the app remember the choice. |
| `TopBar` | The banner landmark, with slots for `search`, `notifications` and `member`. |
| `MemberMenu` | The signed-in Member's avatar and name, opening a menu with the language switch (each language named in itself, the current one pressed) and any extra items, e.g. Sign out. |
| `PageHeader` | A page's one `h1`, with an optional `eyebrow`, `description`, `actions` and `tabs`. |
| `ProjectTabs` | A Project's tabs, always in the agreed order (`projectTabKeys`): Dashboard · Submittals · Inspections · Snag List · Site Reports · Drawings · Settings; a Module's tab key is its Module key (`snag_list`). Dashboard, Submittals and Settings always; another Module's tab only when the Project has a Work Item Type in it (`modules`, from the Project's summary; `visibleProjectTabs`). No empty tab and no placeholder for what isn't built. Page navigation, so links in a named `nav` (not ARIA tabs); `current` is optional. They scroll sideways on a phone. |

```tsx
<AppShell
  sidebar={{ brand: "Rabaed", label: t("main"), sections, current: "projects", collapseLabel: t("collapse"), expandLabel: t("expand"), linkAs: Link }}
  topBar={{ search: <SearchButton />, notifications: <NotificationsButton />, member: <MemberMenu … /> }}
  menuLabel={t("menu")}
  closeLabel={t("close")}
>
  <PageHeader
    title={project.name}
    tabs={<ProjectTabs label={t("project")} labels={tabLabels} modules={project.modules} href={(key) => pathOf(project.id, key)} current="submittals" linkAs={Link} />}
  />
  …
</AppShell>
```

The sidebar uses the light variant of the design (surface and brand tint); a dark sidebar would need its own theme roles first.

## Views

A Module's Work Items and the Member's Projects, as the API returns them. Presentational: the app passes the data, the URLs and every word (`labels`, from its messages; a label that takes a value is a function given the value already formatted for the locale). Each takes `linkAs` (e.g. Next.js `Link`) so navigation stays client-side.

| Component | Use for |
|---|---|
| `ProjectCards` | The Projects page (the home page): one card per Project, a link with its code (left to right), name, the viewer's Project Role, "Project Admin", a Closed badge, and its Need My Action count. `labels`: `list`, `needMyAction`, `closed`, `projectAdmin`. The cards stack on a phone. |
| `WorkItemList` | The List: the toolbar (search, filters, sort, the Need My Action and "Show all Revisions" switches), the Stage counts, one page of rows and the page links. Every choice is a new query (`onQueryChange`); `hrefFor` gives a query's URL. `labels`: `WorkItemListLabels` (`table` is the Module's name). Pass `board` to show the Kanban under the toolbar instead of the counts, table and pages. |
| `WorkItemBoard` | The Kanban: a column per Stage in the reading direction, inside each a swimlane per Step of the viewer's own Company and one per other Company by name only (V14), in the viewer's alphabetical order (`lanesInLocale`). A closed column holds the last 30 days with its total (none under a search, which counts only what it shows) and "Show all" (`listHrefFor`). With `onMove`, a card the viewer may act on can be dragged onto a Stage one of its Transitions alone leads to, or moved from its Move menu. `labels`: `WorkItemBoardLabels`. |
| `WorkItemViewSwitch` | List / Kanban, two links (`hrefFor`), the current one `aria-current="page"`. `labels`: `view`, `list`, `kanban`. |

```tsx
<WorkItemViewSwitch view={view} labels={switchLabels} hrefFor={(v) => hrefIn(v, query)} linkAs={Link} />
<WorkItemList
  list={list}
  query={query}
  locale={locale}
  labels={listLabels}
  hrefFor={hrefFor}
  itemHref={itemHref}
  onQueryChange={(q) => router.push(hrefFor(q))}
  board={view === "kanban" ? <WorkItemBoard board={board} query={query} locale={locale} labels={boardLabels} listHrefFor={listHrefFor} itemHref={itemHref} linkAs={Link} onMove={openActionForm} /> : undefined}
/>
```

### Components that take `labels`

These components have no words of their own: each takes a `labels` prop (a function label takes a value already formatted for the locale), passed from the app's messages (`apps/web/messages/{en,ar}.json`). The story copy is in `src/storybook/`.

| Component | `labels` type |
| --- | --- |
| `FormRenderer` | `FormRendererLabels`: its own words, and one group per field type (`builtIn`, `attachments`, `photos`, `checklist`, `table`, `optionList`, `linkQuestion`), each the `labels` of that field's component. A number is given as text, with the count itself (`(n, count)`) where a plural needs it |
| `ActionForm` | `ActionFormLabels` (`internalNote`, `internalNoteHelp`, and `form`: the `FormRendererLabels`) |
| `LinksSection` | `LinksSectionLabels` (`title`, `none`, `remove`, `item`, `search`) |
| `LinkedFromList` | `LinkedFromLabels` (`title`, `none`, `item`) |
| `LinkSearch` | `LinkSearchLabels` (`count` takes the number as text, the count, and whether more are below) |
| `WatchButton` | `WatchButtonLabels` (`watch`, `watching`, `refusals`) |
| `ProjectDashboard` | `ProjectDashboardLabels` (`items` takes the count as text; `buckets` and `codeCStates` are the List's). `chainBucketLabel` is gone: the app names buckets from its messages |
| `ActivityFeedPanel` | `ActivityFeedPanelLabels` (the panel, and what happened for events that are not a Transition) |
| `NumberingPatternBuilder`, `NumberingPatternView` | `NumberingPatternLabels` (a segment's number is given as text) |
| `NumberingCounters` | `NumberingCountersLabels` (`startsAt` and `used` take the number as text) |
| `RevisionActions` | `RevisionActionsLabels` (the section, both questions, `refusals`) |
| `RevisionPicker` | `RevisionPickerLabels` (`label`); `revisionNoNumber` stays its own prop |
| `NotificationSettingsForm` | `NotificationSettingsLabels`. The outcomes' names come from `watchOutcomeNames` in `@rabaed/domain`; the language names stay in the component |

## Storybook and story tests

- `pnpm storybook` opens Storybook; the **Language** toolbar switches EN (LTR) / AR (RTL).
- `pnpm test:stories` runs every story in Chromium, once per language: its play function (behaviour), direction, Latin digits, no deadline words, no requests to another origin, axe (WCAG 2.2 AA) and a screenshot comparison.
- Stories with `parameters: overlay` (from `src/storybook/overlay.ts`) leave a dialog, sheet, popover, tooltip or toast open; the harness checks and screenshots the whole 1024 × 768 page, portals included. Motion is reduced in story tests, so animations never reach a screenshot.
- Stories with `parameters: phone` (from `src/storybook/form.ts`) render 390px wide on an emulated touch screen, so they can check 44px touch targets with `expectTouchTarget`. The harness also checks every interactive element of a phone story for a 44 x 44px hit area and names each offender; links inside a run of text are exempt (a link beside a badge or icon is not), content is measured inside the app's 24px page gutter, a control on the screen edge by its own box, anything else needs `parameters: { touchTargets: { exempt: [{ selector, reason }] } }` (see `src/storybook/touch-target.ts`).
- Screenshot baselines are Linux renders in `test/__screenshots__/`, compared on Linux only (CI).
  - **A new story** needs no step from you. When the only story test failures are missing baselines, CI uploads the new PNGs, and once CI finishes, the **Update screenshots** workflow commits them to your branch as one bot commit and runs CI again. It does this only for an open PR from a branch in this repository, never for a fork's PR or on `main`. Review the new PNGs in the PR.
  - **A changed story** still fails CI. When your PR touches a story or `packages/ui/src`, the **Update screenshots** workflow re-renders every baseline on each push and commits the changed ones to the PR for review. For any other PR, add the `update-screenshots` label (or run `gh workflow run update-screenshots.yml --ref <branch>`).
  - Any other story test failure (behaviour, axe, direction, digits) blocks both: nothing is committed until it is fixed.

### Story tests on Linux, on your machine

`pnpm test:stories:linux` runs the same suite in the Linux Playwright image CI uses, with the screenshot comparison on. The image is derived from `pnpm-lock.yaml` (the Playwright version, so the same Chromium) and the `stories` job's Ubuntu release in `.github/workflows/ci.yml`; nothing is pinned a second time. It needs Docker Desktop running. Extra arguments go to vitest.

Reach for it when you change:

- the harness (`test/stories.test.tsx`) or anything it does per story (emulation, touch-target checks, the screenshot step): behaviour can differ between the harness on Linux, which screenshots, and on Windows or macOS, which does not (RP-332's touch-target check passed on Windows and failed only on CI);
- screenshots, or a story whose render you want to see as CI renders it; or
- anything CI's story job fails that your own `pnpm test:stories` doesn't.

```
pnpm test:stories:linux                  # compare, as CI does
pnpm test:stories:linux --update         # re-render every baseline into test/__screenshots__
pnpm test:stories:linux --update=new     # write only the missing ones
pnpm test:stories:linux -t "Button"      # one story file or name
```

The first run installs Linux `node_modules` into Docker volumes (`rabaed-stories-…`, one per workspace package and worktree) laid over the host's folders, so your Windows `node_modules` are never touched; later runs reuse them. Remove them with `docker volume rm $(docker volume ls -q -f name=rabaed-stories-)`. The script also adds the `fonts-dejavu-core` package, a fallback font the CI runner has and the image lacks. Without it ✍ in the Button stories renders as a colour emoji and fails against the baselines.

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
| `rabaed/no-ui-translations` | An object with exactly the keys `en` and `ar` in `src/components` (stories are exempt): the package has no translations of its own. The exceptions listed under Data display, and older labels still to move, carry an `eslint-disable` with the reason | Take the label as a prop and pass it from the app's messages |
| `rabaed/use-client-directive` | A `.tsx` file in `packages/ui/src` or `apps/web/src` that calls a hook (`useState`, `useTranslations`, a custom `use…`; `useId` and `use` also run on the server) or passes an `on…={…}` handler, without `"use client"` at the top (stories are exempt). Only `next build` would catch it otherwise (RP-362) | Start the file with `"use client";` |

Raw colours may appear only in the token sources: `src/tokens/palette.ts`, `src/tokens/scales.ts`, their tests, and the generated `src/styles/tokens.css`. Vertical properties (`top`, `margin-top`, `height`) are fine: they don't change with direction.

Known limits: class lists are recognised in `className` and the class functions above, not in plain variables (`const cls = "ml-2"`); physical shorthands such as `margin: 0 4px 0 8px` are not checked. Prefer Tailwind classes, which avoid both.
