Compact utility action button (34px, r6); use `primary` for the one main action per view, `secondary`/`tertiary` for the rest, `danger` for destructive actions.

```jsx
<Button iconLeft={<Icon name="add" size={16} />}>Add Submittal</Button>
<Button variant="secondary">Save draft</Button>
<Button variant="tertiary">Cancel</Button>
<Button variant="danger" loading>Reject</Button>
```

- Variants: `primary` tomato · `secondary` gray fill · `tertiary` transparent · `danger` solid red. Legacy `ghost`→tertiary, `subtle`→secondary.
- Sizes: `sm` 28 · `md` 34 · `lg` 40.
- States built in: hover, pressed (scale .98), keyboard focus (blue 2px ring), `loading` (centered spinner, width kept), `disabled` (gray, no pointer).
- Arabic: font inherits from the page (`dir="rtl"` + Thmanyah); `iconLeft` sits at the reading start, so it flips to the right automatically.
- Icon-only: use `IconButton` with the same variants.
