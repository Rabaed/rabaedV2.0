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

## Storybook and story tests

- `pnpm storybook` opens Storybook; the **Language** toolbar switches EN (LTR) / AR (RTL).
- `pnpm test:stories` runs every story in Chromium, once per language: its play function (behaviour), direction, Latin digits, no deadline words, axe (WCAG 2.2 AA) and a screenshot comparison.
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
