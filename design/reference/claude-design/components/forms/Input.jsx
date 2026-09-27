import React from 'react';
import { Icon } from '../core/Icon.jsx';

/**
 * Rabaed text field — three looks, one API:
 *  - outline (default): white field + 1px border. Tables, filters, toolbars.
 *  - filled: soft gray fill, no border (white + hairline on .surface-gray). Long forms.
 *  - inset: 48px, label inside the box. Create / edit wizards.
 * Surface-aware via tokens/forms.css (.surface-gray, .theme-dark).
 * States: hover · focus (blue ring) · error · success · disabled · read-only.
 */
export function fieldBox({ variant, st, error, success, disabled, readOnly, multiline, size, rows = 3 }) {
  const inset = variant === 'inset';
  const h = inset ? 'var(--fld-h-inset)' : size === 'sm' ? 'var(--fld-h-sm)' : 'var(--fld-h)';
  let bg = variant === 'filled' ? (st.h ? 'var(--fld-fill-h)' : 'var(--fld-fill)') : 'var(--fld-bg)';
  let ring = variant === 'filled' ? 'var(--fld-fill-bd)' : st.h ? 'var(--fld-bd-h)' : 'var(--fld-bd)';
  let halo = null;
  if (st.f) { bg = 'var(--fld-bg)'; ring = 'var(--fld-ring)'; halo = 'var(--fld-ring-a)'; }
  if (error) { ring = 'var(--fld-err)'; if (st.f) halo = 'var(--fld-err-a)'; }
  let shadow = `inset 0 0 0 1px ${ring}` + (halo ? `, 0 0 0 3px ${halo}` : '');
  if (variant === 'filled' && error && !st.f) shadow = `inset 0 -2px 0 var(--fld-err), inset 0 0 0 1px var(--fld-fill-bd)`;
  if (disabled) { bg = 'var(--fld-dis)'; shadow = variant === 'filled' ? 'none' : 'inset 0 0 0 1px var(--fld-bd)'; }
  if (readOnly) { bg = 'transparent'; shadow = 'none'; }
  return {
    position: 'relative', display: 'flex', flexDirection: inset ? 'column' : 'row',
    alignItems: inset ? 'stretch' : multiline ? 'flex-start' : 'center', justifyContent: inset && !multiline ? 'center' : 'flex-start',
    gap: inset ? 2 : 8, minHeight: multiline ? (inset ? 88 : 76) : undefined, height: multiline ? 'auto' : h,
    padding: readOnly ? 0 : multiline ? (inset ? '8px 12px' : '8px 10px') : inset ? '0 12px' : '0 10px',
    borderRadius: inset ? 8 : 'var(--fld-r)', background: bg, boxShadow: shadow,
    color: disabled ? 'var(--fld-dis-txt)' : 'var(--fld-txt)', cursor: disabled ? 'not-allowed' : readOnly ? 'default' : 'text',
    transition: 'box-shadow 120ms, background 120ms', boxSizing: 'border-box',
  };
}

export function useFieldState() {
  const [st, set] = React.useState({ h: false, f: false });
  return [st, {
    onMouseEnter: () => set((s) => ({ ...s, h: true })),
    onMouseLeave: () => set((s) => ({ ...s, h: false })),
  }, {
    onFocus: () => set((s) => ({ ...s, f: true })),
    onBlur: () => set((s) => ({ ...s, f: false })),
  }];
}

export function fieldLabel({ label, required, optional, optionalText = 'Optional' }) {
  if (!label) return null;
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, fontSize: 13, fontWeight: 600, color: 'var(--fld-label)' }}>
      {label}{required && <span style={{ color: 'var(--fld-err)' }}>*</span>}
      {optional && <span style={{ marginInlineStart: 'auto', fontWeight: 400, fontSize: 12, color: 'var(--fld-mut)' }}>{optionalText}</span>}
    </span>
  );
}

export function fieldHelp({ hint, error, count }) {
  if (!hint && !error && count == null) return null;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: error ? 'var(--fld-err)' : 'var(--fld-mut)' }}>
      {error && <Icon name="alert-circle" size={14} />}
      <span>{error || hint}</span>
      {count != null && <span style={{ marginInlineStart: 'auto', fontFamily: 'var(--font-ui)' }}>{count}</span>}
    </span>
  );
}

const FieldLabel = fieldLabel;
const FieldHelp = fieldHelp;

export function Input({
  label, placeholder, value, defaultValue, onChange, type = 'text',
  variant = 'outline', size = 'md', icon = null, prefix, suffix, shortcut,
  hint, error, success = false, required = false, optional = false, optionalText,
  disabled = false, readOnly = false, multiline = false, rows = 3, maxLength,
  style = {}, inputStyle = {}, ...rest
}) {
  const [st, hov, foc] = useFieldState();
  const [inner, setInner] = React.useState(defaultValue ?? '');
  const val = value ?? inner;
  const inset = variant === 'inset';
  const Tag = multiline ? 'textarea' : 'input';
  const errMsg = typeof error === 'string' ? error : null;
  const control = (
    <Tag
      type={multiline ? undefined : type}
      value={val}
      onChange={(e) => { if (value === undefined) setInner(e.target.value); onChange && onChange(e); }}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readOnly}
      rows={multiline ? rows : undefined}
      maxLength={maxLength}
      aria-invalid={!!error || undefined}
      {...foc}
      style={{
        flex: 1, minWidth: 0, width: '100%', border: 'none', outline: 'none', background: 'transparent', padding: 0, margin: 0,
        font: 'inherit', fontSize: 13.5, lineHeight: multiline ? 1.5 : 1.2, color: 'inherit', resize: multiline ? 'vertical' : undefined,
        ...inputStyle,
      }}
      {...rest}
    />
  );
  const addons = (
    <>
      {icon && <Icon name={icon} size={16} color="var(--fld-mut)" />}
      {prefix && <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 600, color: 'var(--fld-mut)', paddingInlineEnd: 8, boxShadow: 'inset -1px 0 0 var(--fld-bd)', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>{prefix}</span>}
    </>
  );
  const tail = (
    <>
      {success && !error && <Icon name="check" size={16} color="var(--fld-ok)" />}
      {shortcut && <span style={{ font: '600 10.5px var(--font-ui)', color: 'var(--fld-mut)', boxShadow: 'inset 0 0 0 1px var(--fld-bd)', borderRadius: 4, padding: '1px 5px' }}>{shortcut}</span>}
      {suffix}
    </>
  );
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'inherit', ...style }}>
      {!inset && <FieldLabel label={label} required={required} optional={optional} optionalText={optionalText} />}
      <span {...hov} style={fieldBox({ variant, st, error, success, disabled, readOnly, multiline, size })}>
        {inset && label && (
          <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.2, color: error ? 'var(--fld-err)' : st.f ? 'var(--fld-ring)' : 'var(--fld-mut)' }}>
            {label}{required && <span style={{ color: 'var(--fld-err)' }}> *</span>}
          </span>
        )}
        {inset
          ? <span style={{ display: 'flex', alignItems: multiline ? 'flex-start' : 'center', gap: 8, minWidth: 0, flex: multiline ? 1 : undefined }}>{addons}{control}{tail}</span>
          : <>{addons}{control}{tail}</>}
      </span>
      <FieldHelp hint={hint} error={errMsg} count={maxLength ? `${String(val).length} / ${maxLength}` : null} />
    </label>
  );
}

export default Input;
