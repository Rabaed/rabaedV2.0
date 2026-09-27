import React from 'react';

/** Radio button — 16px ring, tomato 5px inner ring when selected. Use inside a group with the same `name`. Surface-aware. */
export function Radio({ checked = false, onChange = () => {}, label, name, value, disabled = false, size = 'md', style = {} }) {
  const [f, setF] = React.useState(false);
  const px = size === 'lg' ? 18 : 16;
  const ring = size === 'lg' ? 5.5 : 5;
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'inherit', fontSize: 13.5, color: disabled ? 'var(--fld-dis-txt)' : 'var(--fld-txt)', cursor: disabled ? 'not-allowed' : 'pointer', ...style }}>
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled}
        onChange={(e) => onChange(value ?? true, e)}
        onFocus={(e) => setF(e.target.matches(':focus-visible'))} onBlur={() => setF(false)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
      <span aria-hidden="true" style={{
        width: px, height: px, flex: 'none', borderRadius: '50%',
        background: disabled ? 'var(--fld-dis)' : 'var(--fld-bg)',
        boxShadow: (checked ? `inset 0 0 0 ${ring}px ${disabled ? 'var(--ctl-off)' : 'var(--ctl-on)'}` : `inset 0 0 0 1.5px ${disabled ? 'var(--fld-bd)' : 'var(--ctl-off)'}`) + (f ? ', 0 0 0 2px var(--ring-offset), 0 0 0 4px var(--fld-ring)' : ''),
        transition: 'box-shadow 120ms',
      }} />
      {label && <span>{label}</span>}
    </label>
  );
}

export default Radio;
