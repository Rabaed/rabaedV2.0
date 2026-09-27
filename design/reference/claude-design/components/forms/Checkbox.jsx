import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** Checkbox — 16px, r4, tomato when checked. Supports indeterminate, disabled, keyboard focus ring. Surface-aware. */
export function Checkbox({ checked = false, indeterminate = false, onChange = () => {}, label, disabled = false, size = 'md', style = {} }) {
  const [f, setF] = React.useState(false);
  const px = size === 'lg' ? 18 : 16;
  const on = checked || indeterminate;
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'inherit', fontSize: 13.5, color: disabled ? 'var(--fld-dis-txt)' : 'var(--fld-txt)', cursor: disabled ? 'not-allowed' : 'pointer', ...style }}>
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked, e)}
        onFocus={(e) => setF(e.target.matches(':focus-visible'))} onBlur={() => setF(false)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
      <span aria-hidden="true" style={{
        width: px, height: px, flex: 'none', borderRadius: size === 'lg' ? 5 : 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
        background: disabled ? (on ? 'var(--ctl-off)' : 'var(--fld-dis)') : on ? 'var(--ctl-on)' : 'var(--fld-bg)',
        boxShadow: (on && !disabled ? 'none' : `inset 0 0 0 1.5px ${disabled ? 'var(--fld-bd)' : 'var(--ctl-off)'}`) + (f ? ', 0 0 0 2px var(--ring-offset), 0 0 0 4px var(--fld-ring)' : ''),
        transition: 'background 120ms',
      }}>
        {indeterminate ? <Icon name="minus" size={12} /> : checked ? <i className="ti ti-check" style={{ fontSize: 12, lineHeight: 1 }} /> : null}
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

export default Checkbox;
