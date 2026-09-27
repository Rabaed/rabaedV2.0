import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { fieldBox, useFieldState, fieldLabel as FieldLabel, fieldHelp as FieldHelp } from './Input.jsx';

/** Select / dropdown — same three looks as Input. Options may carry a `code` badge (MAR, SAR…). */
export function Select({
  label, placeholder = 'Select…', value, options = [], onChange = () => {},
  variant = 'outline', size = 'md', icon, hint, error, required, optional, optionalText, disabled = false,
  defaultOpen = false, style = {},
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [st, hov] = useFieldState();
  const [hi, setHi] = React.useState(null);
  const inset = variant === 'inset';
  const current = options.find((o) => (o.value ?? o) === value);
  const text = current ? (current.label ?? current) : placeholder;
  const code = current && current.code;
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const badge = (c) => <span style={{ font: '700 10.5px var(--font-ui)', letterSpacing: '.03em', color: 'var(--fld-mut)', boxShadow: 'inset 0 0 0 1px var(--fld-bd)', borderRadius: 4, padding: '1px 5px' }}>{c}</span>;
  const row = (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: inset ? undefined : 1 }}>
      {icon && <Icon name={icon} size={16} color="var(--fld-mut)" />}
      {code && badge(code)}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13.5, color: current ? 'inherit' : 'var(--fld-ph)' }}>{text}</span>
      <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color="var(--fld-mut)" />
    </span>
  );
  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'inherit', ...style }}>
      {!inset && <FieldLabel label={label} required={required} optional={optional} optionalText={optionalText} />}
      <button
        type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} {...hov}
        style={{ ...fieldBox({ variant, st: { ...st, f: open }, error, disabled, size }), font: 'inherit', textAlign: 'start', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', width: '100%' }}
      >
        {inset && label && <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.2, color: error ? 'var(--fld-err)' : open ? 'var(--fld-ring)' : 'var(--fld-mut)' }}>{label}{required && <span style={{ color: 'var(--fld-err)' }}> *</span>}</span>}
        {row}
      </button>
      {open && options.length > 0 && (
        <div role="listbox" style={{
          position: 'absolute', top: 'calc(100% + 4px)', insetInline: 0, zIndex: 30,
          background: 'var(--menu-bg)', borderRadius: 8, padding: 4,
          boxShadow: '0 0 0 1px var(--menu-bd), 0 10px 24px rgba(10,15,30,.16)',
        }}>
          {options.map((o) => {
            const val = o.value ?? o; const lbl = o.label ?? o; const sel = val === value;
            return (
              <button key={val} type="button" role="option" aria-selected={sel}
                onClick={() => { onChange(val); setOpen(false); }}
                onMouseEnter={() => setHi(val)} onMouseLeave={() => setHi(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 8px', border: 'none', borderRadius: 5,
                  background: hi === val ? 'var(--menu-hov)' : 'transparent', color: 'var(--fld-txt)', cursor: 'pointer',
                  font: 'inherit', fontSize: 13, fontWeight: sel ? 600 : 400, textAlign: 'start',
                }}>
                {o.code && badge(o.code)}<span style={{ flex: 1 }}>{lbl}</span>{sel && <Icon name="check" size={15} color="var(--fld-ring)" />}
              </button>
            );
          })}
        </div>
      )}
      <FieldHelp hint={hint} error={typeof error === 'string' ? error : null} />
    </div>
  );
}

export default Select;
