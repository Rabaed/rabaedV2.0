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
