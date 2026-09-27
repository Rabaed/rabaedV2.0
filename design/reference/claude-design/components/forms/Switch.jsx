import React from 'react';

/**
 * Toggle switch — 32×18 (md) or 36×20 (lg), tomato when on, surface-aware.
 * `labels` renders the two-sided variant (e.g. Submittal / Inspection).
 */
export function Switch({ checked = false, onChange = () => {}, label, labels = null, disabled = false, size = 'md', style = {}, ...rest }) {
  const [f, setF] = React.useState(false);
  const W = size === 'lg' ? 36 : 32, H = size === 'lg' ? 20 : 18, K = H - 4;
  const track = (
    <span
      role="switch" tabIndex={disabled ? -1 : 0} aria-checked={checked} aria-disabled={disabled || undefined}
      onClick={() => !disabled && onChange(!checked)}
      onKeyDown={(e) => { if (!disabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); onChange(!checked); } }}
      onFocus={(e) => setF(e.currentTarget.matches(':focus-visible'))} onBlur={() => setF(false)}
      style={{
        width: W, height: H, flex: 'none', borderRadius: H, position: 'relative', outline: 'none',
        background: checked ? 'var(--ctl-on)' : 'var(--ctl-off)', opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer', transition: 'background 160ms',
        boxShadow: f ? '0 0 0 2px var(--ring-offset), 0 0 0 4px var(--fld-ring)' : 'none',
      }}
      {...rest}
    >
      <span style={{
        position: 'absolute', top: 2, insetInlineStart: checked ? W - K - 2 : 2, width: K, height: K,
        borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: 'inset-inline-start 160ms',
      }} />
    </span>
  );
  const txt = (on) => ({ color: on ? 'var(--fld-txt)' : 'var(--fld-mut)', fontWeight: on ? 600 : 500 });
  if (labels) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontFamily: 'inherit', fontSize: 13.5, ...style }}>
        <span style={txt(!checked)}>{labels[0]}</span>{track}<span style={txt(checked)}>{labels[1]}</span>
      </span>
    );
  }
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'inherit', fontSize: 13.5, color: disabled ? 'var(--fld-dis-txt)' : 'var(--fld-txt)', ...style }}>
      {track}{label && <span>{label}</span>}
    </label>
  );
}

export default Switch;
