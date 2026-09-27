import React from 'react';
import { Icon } from './Icon.jsx';
import { useBtnState, btnStyle, btnSizes } from './Button.jsx';

/** Square icon-only button — same "Compact utility" look and states as Button. */
export function IconButton({
  icon = 'more-vertical',
  variant = 'tertiary',
  size = 'md',
  label = 'action',
  active = false,
  disabled = false,
  style = {},
  ...rest
}) {
  const map = { solid: 'primary', soft: 'secondary', outline: 'secondary', ghost: 'tertiary' };
  const vv = map[variant] || variant;
  const [st, handlers] = useBtnState(disabled);
  const s = btnSizes[size] || btnSizes.md;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      {...handlers}
      style={{
        ...btnStyle(vv, size, { ...st, h: st.h || active }, { disabled, square: true }),
        ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={s.ic + 2} />
    </button>
  );
}

export default IconButton;
