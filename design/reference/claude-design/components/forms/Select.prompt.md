Dropdown select with a menu of options.

```jsx
<Select label="Submittal type" placeholder="Choose type" value={v} onChange={setV}
  options={[{label:'MAR — Material Approval', value:'mar'}, 'SAR', 'DAS']} />
```

Options may be `{label,value}` objects or plain strings. Sizes `sm | md`.
