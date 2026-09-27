Surface-aware text field in three looks — pick by context, not taste.

```jsx
<Input label="Submittal title" placeholder="e.g. HVAC ducting — Level 3" required />              {/* outline */}
<Input variant="filled" label="Contract value" prefix="AED" optional hint="Excludes VAT" />
<Input variant="inset" label="Description" multiline maxLength={500} />
```

- **outline** (default): tables, filters, toolbars, dense screens. 34px — lines up with Compact utility buttons.
- **filled**: long forms on white cards. On `.surface-gray` it automatically turns white + hairline.
- **inset**: create/edit wizards; 48px with label inside. Don't use in toolbars.
- States: hover, focus (blue ring), `error` (bool or message), `success`, `disabled`, `readOnly`.
- Addons: `icon`, `prefix` ("AED"), `suffix`, `shortcut` ("/"), `maxLength` (counter), `multiline`.
- Surfaces: wrap a region in `.surface-gray` (board canvas) or `.theme-dark` — all fields adapt.
- Arabic: font + direction inherit from the page; prefix/icons sit at the reading start.
