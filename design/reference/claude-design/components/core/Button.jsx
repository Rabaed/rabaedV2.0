import React from 'react';

/**
 * Rabaed Button — "Compact utility" direction.
 * 34px (md), radius 6, 13.5/600. Tomato primary, gray-fill secondary,
 * transparent tertiary, solid red danger. Blue focus ring (keyboard only).
 * States: default · hover · pressed · focus · loading · disabled.
 * Font inherits from the page, so Arabic (RTL) pages render in Thmanyah and
 * icon order mirrors automatically (logical flex order).
 */
export const btnVariants = {
  primary:   { bg: 'var(--btn-pri)', hov: 'var(--btn-pri-h)', prs: 'var(--btn-pri-p)', fg: 'var(--btn-pri-fg)', light: true },
  secondary: { bg: 'var(--btn-sec)', hov: 'var(--btn-sec-h)', prs: 'var(--btn-sec-p)', fg: 'var(--btn-sec-fg)' },
  tertiary:  { bg: 'var(--btn-ter)', hov: 'var(--btn-ter-h)', prs: 'var(--btn-ter-p)', fg: 'var(--btn-ter-fg)', dis: 'transparent' },
  danger:    { bg: 'var(--btn-dan)', hov: 'var(--btn-dan-h)', prs: 'var(--btn-dan-p)', fg: 'var(--btn-dan-fg)', light: true },
};
const ALIAS = { ghost: 'tertiary', subtle: 'secondary', outline: 'secondary' };
export const btnSizes = {
  sm: { h: 28, px: 10, fs: 12.5, gap: 5, ic: 15 },
  md: { h: 34, px: 12, fs: 13.5, gap: 6, ic: 16 },
  lg: { h: 40, px: 16, fs: 14, gap: 8, ic: 18 },
};

export function useBtnState(disabled) {
  const [st, set] = React.useState({ h: false, p: false, f: false });
  const on = (k, v) => () => !disabled && set((s) => ({ ...s, [k]: v }));
  return [st, {
    onMouseEnter: on('h', true),
    onMouseLeave: () => set((s) => ({ ...s, h: false, p: false })),
    onMouseDown: on('p', true),
    onMouseUp: on('p', false),
    onFocus: (e) => set((s) => ({ ...s, f: e.currentTarget.matches(':focus-visible') })),
    onBlur: () => set((s) => ({ ...s, f: false })),
  }];
}

export function btnStyle(variant, size, st, { disabled, loading, square } = {}) {
  const v = btnVariants[ALIAS[variant] || variant] || btnVariants.primary;
  const s = btnSizes[size] || btnSizes.md;
  const bg = disabled ? (v.dis ?? 'var(--btn-dis)') : st.p ? v.prs : st.h ? v.hov : v.bg;
  return {
    position: 'relative',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: s.gap, height: s.h, minWidth: square ? s.h : undefined, width: square ? s.h : undefined,
    padding: square ? 0 : `0 ${s.px}px`,
    border: 'none', outline: 'none', borderRadius: 6,
    fontFamily: 'inherit', fontSize: s.fs, fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap',
    background: bg,
    color: loading ? 'transparent' : disabled ? 'var(--btn-dis-fg)' : v.fg,
    boxShadow: st.f && !disabled ? '0 0 0 2px var(--focus-offset), 0 0 0 4px var(--focus-ring)' : 'none',
    transform: st.p && !disabled ? 'scale(0.98)' : 'none',
    cursor: disabled ? 'not-allowed' : loading ? 'progress' : 'pointer',
    transition: 'background 120ms, box-shadow 120ms, transform 80ms',
    pointerEvents: loading ? 'none' : undefined,
  };
}

function BtnSpinner({ color, size = 15 }) {
  return (
    <span aria-hidden="true" style={{
      position: 'absolute', insetInlineStart: '50%', top: '50%', width: size, height: size,
      marginInlineStart: -size / 2, marginTop: -size / 2, borderRadius: '50%',
      border: `2px solid ${color}`, borderRightColor: 'transparent',
      animation: 'rb-spin 0.7s linear infinite',
    }} />
  );
}

let injected = false;
export function ensureSpinKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.textContent = '@keyframes rb-spin{to{transform:rotate(360deg)}}';
  document.head.appendChild(el);
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  iconLeft = null,
  iconRight = null,
  fullWidth = false,
  disabled = false,
  loading = false,
  type = 'button',
  style = {},
  ...rest
}) {
  ensureSpinKeyframes();
  const [st, handlers] = useBtnState(disabled || loading);
  const v = btnVariants[ALIAS[variant] || variant] || btnVariants.primary;
  return (
    <button
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      data-variant={variant}
      {...handlers}
      style={{ ...btnStyle(variant, size, st, { disabled, loading }), ...(fullWidth ? { display: 'flex', width: '100%' } : {}), ...style }}
      {...rest}
    >
      {loading && <BtnSpinner color={v.light ? '#ffffff' : v.fg} />}
      {iconLeft && <span style={{ display: 'inline-flex', opacity: loading ? 0 : 1 }}>{iconLeft}</span>}
      {children != null && <span>{children}</span>}
      {iconRight && <span style={{ display: 'inline-flex', opacity: loading ? 0 : 1 }}>{iconRight}</span>}
    </button>
  );
}

export default Button;
