Underlined horizontal tab bar for the project workspace (Overview, Submittals, Inspections…). Active tab is tomato.

```jsx
<Tabs value={tab} onChange={setTab} items={[
  { label: 'Overview', icon: 'chart' },
  { label: 'Submittals', icon: 'document', count: 231 },
]} />
```

Each item: `{ label, value?, icon?, count? }`.
