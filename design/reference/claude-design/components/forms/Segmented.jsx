import React from 'react';

/** Segmented control — pick one of 2–4 options (Kanban / List / Timeline). Surface-aware. */
export function Segmented({ options = [], value, onChange = () => {}, size = 'md', style = {} }) {
  const h = size === 'sm' ? 24 : 28;
  return (
    <span role="radiogroup" style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 7, background: 'var(--fld-fill)', boxShadow: 'inset 0 0 0 1px var(--fld-bd)', fontFamily: 'inherit', ...style }}>
      {options.map((o) => {
        const v = o.value ?? o; const on = v === value;
        return (
          <button key={v} type="button" role="radio" aria-checked={on} onClick={() => onChange(v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, height: h, padding: '0 12px', border: 'none', borderRadius: 5, cursor: 'pointer',
              font: 'inherit', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
              background: on ? 'var(--fld-bg)' : 'transparent', color: on ? 'var(--fld-txt)' : 'var(--fld-mut)',
              boxShadow: on ? '0 1px 2px rgba(0,0,0,.08), inset 0 0 0 1px var(--fld-bd)' : 'none',
            }}>
            {o.icon && <i className={`ti ti-${o.icon}`} style={{ fontSize: 15 }} />}{o.label ?? o}
          </button>
        );
      })}
    </span>
  );
}

export default Segmented;
